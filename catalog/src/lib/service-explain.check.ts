// Self-check for service_explain. Run: node --experimental-strip-types src/lib/service-explain.check.ts
//
// The failure this is written against is a document that reads as complete while being wrong: an
// inventory that quietly drops a table, a lineage list that includes the service's own hops and so
// overstates the blast radius, or a summary that says an agent may act when the policy says it may
// not. Each of those is invisible in a 3000-line JSON file and obvious to an assertion.
import assert from 'node:assert/strict'
import { catalog } from '../data/catalog.ts'
import { serviceContext } from './agent-context.ts'
import { assetsForService } from './catalog.ts'
import { serviceExplain } from './service-explain.ts'

const doc = serviceExplain('pg-37c7de3b')
assert.ok(doc, 'the busiest Postgres service must have a document')

// Composition: everything the decision document says, this says identically. If these ever drift,
// an agent gets one answer from the page and another from the endpoint.
const context = serviceContext('pg-37c7de3b')!
for (const field of ['policy', 'findings', 'freeze', 'classification', 'plan', 'dependents'] as const) {
  assert.deepEqual(doc[field], context[field], `${field} must be the decision document's, not a second copy`)
}

// The inventory is the whole catalogue for this service, not a sample of it.
const owned = assetsForService('pg-37c7de3b')
assert.equal(doc.data.datasets, owned.length)
assert.deepEqual(doc.data.assets.map((a) => a.id).sort(), owned.map((a) => a.id).sort())
assert.equal(
  doc.data.columns,
  owned.reduce((n, asset) => n + asset.columns.length, 0),
  'every column is counted, since a partial inventory is worse than none',
)
assert.ok(
  doc.data.assets.every((asset) => asset.description && asset.columns.every((column) => column.note)),
  'descriptions and column notes come through rather than being dropped on the way',
)

// Lineage. The boundary is what matters: an edge inside the service breaks nobody else, and
// counting it as downstream turns a safe restart into a fabricated incident.
const own = new Set(owned.map((a) => a.id))
assert.ok(doc.lineage.outbound.length > 0, 'it feeds the rest of the webshop pipeline')
assert.ok(
  doc.lineage.outbound.every((edge) => own.has(edge.from) && !own.has(edge.to)),
  'outbound edges leave the service',
)
// It is written to by the simulator, so a document that only looked downstream would present the
// origin of this data as unknown.
assert.deepEqual(doc.lineage.upstreamServices, ['webshop-simulator'])
assert.ok(
  doc.lineage.inbound.every((edge) => !own.has(edge.from) && own.has(edge.to)),
  'inbound edges arrive from outside',
)
assert.ok(!doc.lineage.downstreamServices.includes('pg-37c7de3b'), 'a service is never downstream of itself')
assert.equal(
  doc.lineage.internalHops,
  catalog.lineage.filter((e) => own.has(e.sourceAssetId) && own.has(e.destAssetId)).length,
)

// Transitive reach is the point of having it. Kafka feeds ClickHouse directly and Trino only
// through it, and that second hop is why a change here shows up in a dashboard nobody connected
// to Kafka.
const kafka = serviceExplain('kafka-1b5cb1e7')!
assert.deepEqual(kafka.lineage.downstreamServices, ['clickhouse-2a6274d2'])
assert.deepEqual(kafka.lineage.reachesEventually, ['clickhouse-2a6274d2', 'trino-hub'])
for (const doc of [kafka, serviceExplain('crm-pg')!]) {
  for (const direct of doc.lineage.downstreamServices) {
    assert.ok(doc.lineage.reachesEventually.includes(direct), `${direct} is one hop away and so also eventually reached`)
  }
  assert.ok(!doc.lineage.reachesEventually.includes(doc.serviceId), 'a service never reaches itself')
}

// An integration end is not a data direction, and conflating them inverts the arrow: crm-pg is the
// *source* of the credential that crm-app uses to write *into* it. Both facts, stated separately.
const crm = serviceExplain('crm-pg')!
assert.equal(crm.lineage.integrations.find((i) => i.peer === 'crm-app')?.thisServiceIs, 'source')
assert.deepEqual(crm.lineage.upstreamServices, ['crm-app'], 'and the data still flows the other way')

// Data-level rules, which are the ones an operation policy cannot express: "you may restart this"
// and "you may not read the table of API keys inside it" are both true at once.
const marmot = serviceExplain('marmot-pg')!
const blocked = marmot.boundaries.doNotRead
const marmotAssets = new Set(assetsForService('marmot-pg').map((a) => a.id))
assert.deepEqual(
  [...new Set(blocked.map((rule) => rule.assetId))].sort(),
  ['marmot.api_keys', 'marmot.service_account_api_keys', 'marmot.system_secrets'],
  'the three secret-holding tables are named',
)
assert.ok(
  blocked.every((rule) => rule.reason.length > 20 && marmotAssets.has(rule.assetId)),
  'each rule names a real asset here and says why, taking the reason from the tag vocabulary',
)
assert.ok(
  blocked.every(
    (rule) =>
      !marmot.boundaries.handleCarefully.some((other) => other.assetId === rule.assetId && other.tag === rule.tag),
  ),
  'a tag forbids reading or constrains use, never both',
)
// Stated in the paragraph, not only in a field further down — and counted as tables rather than as
// rules, since each of these carries two blocking tags and "6 tables" would be three imaginary ones.
assert.ok(
  marmot.summary.includes('3 of those datasets hold data an agent must not read.'),
  `the count must be of assets, not of rules: ${marmot.summary}`,
)
assert.equal(doc.boundaries.doNotRead.length, 0, 'and a service holding none says none rather than guessing')

// The summary has to agree with the fields under it, because it is the part that gets read.
assert.ok(doc.summary.includes(doc.name) && doc.summary.includes('PostgreSQL'), 'it says what the thing is')
assert.ok(
  doc.summary.includes(String(doc.data.datasets)) && doc.summary.includes(doc.findings[0].title),
  'it carries the inventory size and the worst finding',
)
for (const operation of doc.policy.forbidden) {
  assert.ok(doc.summary.includes(operation), `the summary must not omit the forbidden ${operation}`)
}

// A service nobody has captured must read as short and unhelpful rather than as confident, and it
// must still exist: "no context for this one" is the answer that stops an agent, and only an
// endpoint that returns something can give it.
const thin = serviceExplain('trino2')!
assert.ok(thin.summary.includes('not classified'), 'an unclassified service says so in its first sentence')
assert.ok(
  thin.summary.includes('Unattended, an agent may read metadata.') &&
    thin.summary.includes('Forbidden: everything else.'),
  'thin context resolves to read-only, in the prose as well as in the policy',
)
assert.equal(thin.data.datasets, 0)
assert.ok(
  thin.summary.includes('no data inventory to reason about'),
  'an empty inventory is stated rather than left as an absent field to be read as zero risk',
)

// Every summary is prose, not fragments joined by hope. The service purposes are authored by hand
// and punctuated inconsistently, so the unterminated ones run into the sentence that follows and
// produce "Second Trino app Nothing under it is catalogued".
for (const service of catalog.services) {
  const purpose = (service.notes ?? service.role).trim()
  assert.ok(
    serviceExplain(service.id)!.summary.includes(/[.!?]$/.test(purpose) ? purpose : `${purpose}.`),
    `${service.id}: the purpose must be punctuated before the next sentence starts`,
  )
}

assert.equal(serviceExplain('no-such-service'), undefined, 'an unknown id is absent, not an empty document')

// Emitted to files, so a document that reads the clock would produce a diff on every build.
assert.equal(JSON.stringify(serviceExplain('crm-pg')), JSON.stringify(serviceExplain('crm-pg')), 'deterministic')

const every = catalog.services.map((service) => serviceExplain(service.id)!)
assert.ok(every.every(Boolean), 'every service can be explained, including the ones with nothing behind them')
console.log(
  `service-explain: ok (${every.length} services, ${every.reduce((n, d) => n + d.data.datasets, 0)} datasets, ${every.reduce((n, d) => n + d.boundaries.doNotRead.length, 0)} do-not-read rules)`,
)
