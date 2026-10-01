// Self-check for the per-asset document. Run: node --experimental-strip-types src/lib/asset-context.check.ts
//
// The point of one document per asset is that a decision can be made from one fetch. That only
// holds if the document is complete and labelled: a half-assembled view is worse than five lookups,
// because five lookups at least make their gaps obvious.
import assert from 'node:assert/strict'
import { catalog } from '../data/catalog.ts'
import { topicSerialization } from '../data/operations.ts'
import { assetContext, everyAssetContext } from './asset-context.ts'
import { policyFor } from './agent-context.ts'
import { deletionReview } from './asset-review.ts'

const every = everyAssetContext()
assert.equal(every.length, catalog.assets.length, 'every dataset has a document, including the dull ones')

// Requirement 3: every fact says whether it was read from a tool, written by somebody, or computed.
// An unlabelled fact is the thing this whole layer exists to stop.
for (const doc of every) {
  for (const fact of doc.facts) {
    assert.ok(['captured', 'authored', 'derived'].includes(fact.origin), `${doc.assetId}: ${fact.what} has no origin`)
    assert.ok(fact.source, `${doc.assetId}: ${fact.what} names no source`)
  }
  assert.ok(doc.facts.some((fact) => fact.what === 'Last write'), `${doc.assetId} omits the last-write gap`)
  assert.ok(doc.policy.allowed.length || doc.policy.because, 'the service policy comes through rather than being restated')
}

// The absence of a last-write time is derived, not captured: nothing was read to produce it, and
// calling it captured would be a claim about a tool that was never run.
const anyDoc = assetContext('pg.public.orders')!
assert.equal(anyDoc.facts.find((fact) => fact.what === 'Last write')?.origin, 'derived')

// Requirement 2, the reason Kafka people asked for this: how to deserialize the thing.
const topic = assetContext('kafka.webshop.public.orders')!
assert.ok(topic.stream, 'a topic carries its stream details')
assert.equal(topic.stream!.format, 'Avro')
assert.equal(topic.stream!.valueSubject, 'webshop.public.orders-value')
assert.ok(topic.stream!.subjectStrategy.includes('TopicNameStrategy'), 'the naming strategy is stated, not implied')
assert.ok(topic.stream!.registry.includes('Karapace'), 'and that it is not a Confluent cluster')
assert.deepEqual(topic.stream!.envelopeFields, ['__deleted', '__op', '__source_ts_ms'])
assert.equal(topic.stream!.consumers.length, 1)
assert.equal(topic.stream!.consumers[0].group, 'ch-webshop-orders-avro-v1')
assert.ok(
  topic.stream!.note.includes('rather than the ones that exist'),
  'one consumer group read is not the same as one existing, and a topic can carry hundreds',
)
assert.ok(
  topic.facts.some((fact) => fact.what === 'Serialization' && fact.source === 'aiven_kafka_schema_registry_subjects'),
  'the serialization fact names the tool it was read from',
)

// A subject listed but not read says so rather than borrowing the version from its neighbour.
const unread = assetContext('kafka.webshop.public.products')!
assert.equal(unread.stream!.schemaVersion, undefined)
assert.ok(unread.facts.find((fact) => fact.what === 'Serialization')?.value.includes('version not read'))
assert.equal(topicSerialization.filter((entry) => entry.schemaVersion !== undefined).length, 1, 'one subject was read in full')

// A table has no stream, and must not be given an empty one: an empty object reads as "no schema".
assert.equal(assetContext('pg.public.orders')!.stream, undefined)

// Requirement 4: findings about the dataset, not only about its service.
const secret = assetContext('marmot.service_account_api_keys')!
assert.deepEqual(
  secret.findings.map((finding) => finding.kind),
  ['sensitivity', 'dead-workflow'],
  'worst first, and both of them are about this table rather than about marmot-pg',
)
assert.equal(secret.findings[0].severity, 'danger', 'credentials and agent-blocked are not a caution')
assert.ok(secret.findings[0].detail.length > 40, 'the tag vocabulary supplies the reason rather than the tag name alone')
assert.ok(
  every.filter((doc) => doc.findings.some((finding) => finding.kind === 'dead-workflow')).length > 10,
  'the unused marmot tables each carry the finding on themselves',
)

// Nothing is invented for an asset nobody has captured: no findings is a valid answer.
const quiet = assetContext('trino.summit_pg')!
assert.ok(Array.isArray(quiet.findings))
assert.ok(quiet.deletion.verdict === 'cannot tell', 'and its deletion verdict stays honest about that')

// Composition rather than recalculation, so the asset page and the service_explain inventory can
// never disagree about whether something is in use.
for (const doc of every.slice(0, 20)) {
  assert.deepEqual(doc.deletion, deletionReview(doc.assetId), `${doc.assetId}: deletion review is the shared one`)
  assert.deepEqual(doc.policy, policyFor(doc.serviceId), 'policy belongs to the service, not to a second opinion')
}

// Tags carry their meaning, since a tag an agent cannot interpret is decoration.
for (const doc of every) {
  for (const tag of doc.tags) {
    assert.ok(tag.meaning.length > 10, `${doc.assetId}: tag ${tag.tag} has no meaning attached`)
  }
}

// Descriptions and column notes are present across the catalog, which is what makes the rest
// worth fetching.
assert.ok(
  every.every((doc) => doc.description.length > 10),
  'every dataset is described',
)
assert.equal(
  every.filter((doc) => doc.columns.some((column) => !column.note)).length,
  0,
  'and every column has a note',
)

// Deterministic, because these are written to files and a document that reads the clock would
// produce a diff on every build.
assert.equal(JSON.stringify(assetContext('pg.public.orders')), JSON.stringify(assetContext('pg.public.orders')))
assert.equal(assetContext('no-such-asset'), undefined)

console.log(
  `asset-context: ok (${every.length} documents, ${every.filter((d) => d.stream).length} streams, ${every.reduce((n, d) => n + d.findings.length, 0)} asset findings)`,
)
