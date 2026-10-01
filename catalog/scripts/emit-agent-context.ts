// Writes the service context documents to public/agent-context/, where the built site serves them
// as plain JSON. The UI panel and these files come from the same module, so an agent fetching
// /agent-context/crm-pg.json reads exactly what a human reads on the page.
//
// The same pass writes the service_explain documents to public/service-explain/. Those are a
// superset: the same decision document plus the data inventory and full lineage. Two families
// rather than one because the page renders the first, and paying for ninety-four tables of column
// notes on every render to serve a reader who wants five fields is the wrong trade.
//
//   node --experimental-strip-types scripts/emit-agent-context.ts           write the files
//   node --experimental-strip-types scripts/emit-agent-context.ts --check   fail if they are stale
//
// The check mode exists because generated files that nobody verifies drift, and a stale context
// document is the one failure this whole feature is meant to prevent.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { catalog } from '../src/data/catalog.ts'
import { changeFreeze, documentedServices, freezeActive, runbooks, serviceContext } from '../src/lib/agent-context.ts'
import { fleetCoverage, fleetFindings, fleetRows } from '../src/lib/fleet.ts'
import { serviceExplain } from '../src/lib/service-explain.ts'
import { everyAssetContext } from '../src/lib/asset-context.ts'

const OUT = 'public/agent-context'
const EXPLAIN = 'public/service-explain'
const ASSETS = 'public/agent-context/asset'

const documents = documentedServices().map((serviceId) => serviceContext(serviceId)!)
// Already ranked worst first, so an agent asking "what needs attention here" reads the answer off
// the top of one fetch rather than pulling thirty-three documents to sort them itself.
const ranked = fleetRows()
const assets = everyAssetContext()

const index = {
  project: catalog.project,
  organization: catalog.organization,
  freeze: { active: freezeActive(), ...changeFreeze },
  note:
    'A read-only snapshot: every fact names the tool it came from and when it was read. Facts are captured from the Aiven API; policy, objectives and runbooks are authored. Nothing here mutates anything.',
  runbooks: runbooks.length,
  endpoints: {
    service_explain: {
      url: '/service-explain/{serviceId}.json',
      returns:
        'Everything about one service: what it is and how critical, every dataset and column under it, lineage in both directions with what it eventually reaches, findings with their runbooks, and what may and may not be done to it. Starts with a `summary` paragraph carrying the same answer in prose.',
      use: 'Call this first, before acting on a service or answering a question about one. The per-service document under /agent-context/ is the same thing without the data inventory.',
      serviceIds: documentedServices(),
    },
    asset: {
      url: '/agent-context/asset/{assetId}.json',
      returns:
        'One dataset: description, columns, owners, tags with their meanings, facts each labelled captured, authored or derived, its own findings, how to deserialize it where it is a stream, whether anything uses it, what it costs, and where a problem with it most likely comes from.',
      use: 'Call this when the question is about a table or a topic rather than about a service, so an investigation is one fetch rather than five.',
      assetIds: assets.map((asset) => asset.assetId),
    },
  },
  fleet: {
    findings: fleetFindings(),
    coverage: fleetCoverage(),
    note:
      'Fleet findings are patterns across services rather than facts about any one of them, and coverage counts an unset field as missing rather than as a default. Thin context is a reason to decline.',
  },
  services: ranked.map((row) => {
    const doc = documents.find((d) => d.serviceId === row.serviceId)!
    return {
      serviceId: doc.serviceId,
      name: doc.name,
      type: doc.type,
      state: row.state,
      environment: row.environment,
      criticality: row.criticality,
      document: `/agent-context/${doc.serviceId}.json`,
      explain: `/service-explain/${doc.serviceId}.json`,
      findings: doc.findings.length,
      worst: doc.findings[0]?.severity ?? 'none',
      worstFinding: doc.findings[0]?.title,
      contextKnown: `${row.known}/5`,
      mayActUnattended: doc.policy.allowed,
    }
  }),
}

const files = new Map<string, string>([
  [`${OUT}/index.json`, `${JSON.stringify(index, null, 2)}\n`],
  ...documents.map(
    (doc): [string, string] => [`${OUT}/${doc.serviceId}.json`, `${JSON.stringify(doc, null, 2)}\n`],
  ),
  ...documentedServices().map((serviceId): [string, string] => [
    `${EXPLAIN}/${serviceId}.json`,
    `${JSON.stringify(serviceExplain(serviceId), null, 2)}\n`,
  ]),
  ...assets.map((doc): [string, string] => [
    `${ASSETS}/${doc.assetId}.json`,
    `${JSON.stringify(doc, null, 2)}\n`,
  ]),
])

if (process.argv.includes('--check')) {
  const stale = [...files].filter(([path, body]) => {
    try {
      return readFileSync(path, 'utf8') !== body
    } catch {
      return true
    }
  })
  if (stale.length) {
    console.error(`stale, run npm run context:emit: ${stale.map(([path]) => path).join(', ')}`)
    process.exit(1)
  }
  console.log(`agent-context up to date: ${files.size} files`)
} else {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(EXPLAIN, { recursive: true })
  mkdirSync(ASSETS, { recursive: true })
  for (const [path, body] of files) writeFileSync(path, body)
  console.log(`wrote ${files.size} files to ${OUT}/, ${OUT}/asset/ and ${EXPLAIN}/`)
}
