// Self-check for service mark resolution. Run: node src/lib/aiven-service-icons/mark.check.ts
import assert from 'node:assert/strict'
import { serviceMark } from './mark.ts'

// Every service type in the catalog resolves to the correct canonical mark.
for (const [type, id] of [
  ['pg', 'postgresql'],
  ['kafka', 'apache-kafka'],
  ['clickhouse', 'clickhouse'],
  ['opensearch', 'opensearch'],
  ['datahub', 'datahub'],
  ['application', 'apps'],
]) {
  assert.equal(serviceMark(type)?.id, id, `${type} should resolve to ${id}`)
}

// Kafka Connect has no first-party mark. Handing back the Apache Kafka mark would be a
// trademark-level mistake, and getServiceIcon()'s substring fallback does exactly that.
assert.equal(serviceMark('kafka_connect'), null, 'kafka_connect must not borrow the Kafka mark')

// Unknown types stay unresolved rather than guessing from an adjacent technology.
assert.equal(serviceMark('redis'), null)
assert.equal(serviceMark(''), null)

console.log('service marks: ok')
