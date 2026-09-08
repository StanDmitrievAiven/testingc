// Writes the service context documents to public/agent-context/, where the built site serves them
// as plain JSON. The UI panel and these files come from the same module, so an agent fetching
// /agent-context/crm-pg.json reads exactly what a human reads on the page.
//
//   node --experimental-strip-types scripts/emit-agent-context.ts           write the files
//   node --experimental-strip-types scripts/emit-agent-context.ts --check   fail if they are stale
//
// The check mode exists because generated files that nobody verifies drift, and a stale context
// document is the one failure this whole feature is meant to prevent.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { catalog } from '../src/data/catalog.ts'
import { changeFreeze, documentedServices, freezeActive, runbooks, serviceContext } from '../src/lib/agent-context.ts'

const OUT = 'public/agent-context'

const documents = documentedServices().map((serviceId) => serviceContext(serviceId)!)

const index = {
  project: catalog.project,
  organization: catalog.organization,
  freeze: { active: freezeActive(), ...changeFreeze },
  note:
    'A read-only snapshot: every fact names the tool it came from and when it was read. Facts are captured from the Aiven API; policy and runbooks are authored. Nothing here mutates anything.',
  runbooks: runbooks.length,
  services: documents.map((doc) => ({
    serviceId: doc.serviceId,
    name: doc.name,
    type: doc.type,
    document: `/agent-context/${doc.serviceId}.json`,
    findings: doc.findings.length,
    worst: doc.findings[0]?.severity ?? 'none',
    mayActUnattended: doc.policy.allowed,
  })),
}

const files = new Map<string, string>([
  [`${OUT}/index.json`, `${JSON.stringify(index, null, 2)}\n`],
  ...documents.map(
    (doc): [string, string] => [`${OUT}/${doc.serviceId}.json`, `${JSON.stringify(doc, null, 2)}\n`],
  ),
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
  for (const [path, body] of files) writeFileSync(path, body)
  console.log(`wrote ${files.size} files to ${OUT}/`)
}
