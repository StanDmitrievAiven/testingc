// Self-check for the upstream walk. Run: node --experimental-strip-types src/lib/diagnose.check.ts
//
// G6 asked for this specifically: "a check with a deliberately broken hop, asserting the walk names
// that hop and not another". That requirement is doing real work, because the failure mode of a
// diagnosis tool is not silence — it is confidently naming the wrong hop, which sends somebody to
// argue with a team whose service is fine.
import assert from 'node:assert/strict'
import { catalog } from '../data/catalog.ts'
import { diagnose, hopHealth, withBreak } from './diagnose.ts'

// Francesco's example, which is the reason this exists: a symptom in the analytics layer whose
// cause is the ingestion two hops back.
const symptom = 'trino.summit_clickhouse'
const real = diagnose(symptom)!
assert.ok(real.chain.length >= 4, 'the webshop chain runs Trino, ClickHouse, Kafka, Postgres and the simulator')
assert.deepEqual(
  real.chain.map((hop) => hop.distance),
  [...real.chain.map((hop) => hop.distance)].sort((a, b) => a - b),
  'hops come back nearest first, which is the order somebody would walk them',
)

// The deliberately broken hop. Broken three different places; each time the walk must name that
// place and no other.
for (const serviceId of ['kafkaconnect-30e121dd', 'pg-37c7de3b', 'kafka-1b5cb1e7']) {
  const broken = diagnose(symptom, { healthOf: withBreak(serviceId, 'Simulated stoppage.') })!
  assert.equal(broken.cause?.serviceId, serviceId, `breaking ${serviceId} must name ${serviceId}`)
  assert.ok(broken.verdict.includes(broken.cause!.name), 'the verdict names the hop rather than describing it')
  assert.equal(
    broken.chain.filter((hop) => hop.health === 'degraded').length,
    1,
    'breaking one service degrades one hop, so a second name would be an invention',
  )
}

// The connector is the most likely cause of a stalled pipeline and it lives on the edge rather
// than in the graph. Before it was treated as a hop, breaking it named nothing at all.
assert.ok(
  real.chain.some((hop) => hop.assetId === 'connect.webshop-pg-cdc'),
  'the CDC connector is a hop, not just a label on one',
)
// And it is assessed from its task state, since a Kafka Connect service has no disk worth reading.
assert.equal(hopHealth('kafkaconnect-30e121dd').health, 'ok')
assert.ok(hopHealth('kafkaconnect-30e121dd').why.includes('1 of 1 tasks running'))

// The furthest cause wins. A lagging consumer fed by a stopped connector is a symptom with a
// symptom, and naming the nearest hop is a morning spent fixing the wrong thing.
const twoBroken = diagnose(symptom, {
  healthOf: (id) =>
    ['kafkaconnect-30e121dd', 'clickhouse-2a6274d2'].includes(id)
      ? { health: 'degraded', why: 'Simulated.', findings: [] }
      : { health: 'ok', why: 'Fine.', findings: [] },
})!
assert.equal(twoBroken.cause?.serviceId, 'kafkaconnect-30e121dd', 'the most upstream degraded hop is the one to fix')
assert.ok(twoBroken.verdict.includes('Fix the furthest one first'), 'and the nearer one is explained as a consequence')

// Only faults that could cause a data symptom count. Every service in this project has findings —
// seven are open to the internet — and none of that makes a table stale. A walk that counted every
// danger would name a cause on every chain and be wrong on almost all of them.
assert.ok(!real.cause, 'the real pipeline is healthy, so the honest answer is that nothing explains it')
const clickhouse = hopHealth('clickhouse-2a6274d2')
assert.equal(clickhouse.health, 'ok', 'a CPU burst and an open ip filter are not causes of stale data')
// Exactly one service is degraded in a way that could explain a data symptom: the powered-off one,
// which delivers nothing by definition. It holds no catalogued datasets, so it appears in no chain
// — which is the real reason every walk here comes back clean, and worth pinning rather than
// assuming the whole fleet is healthy.
const degradedServices = catalog.services.filter((service) => hopHealth(service.id).health === 'degraded')
assert.deepEqual(degradedServices.map((service) => service.id), ['os-ddec4cf-dhtest'])
assert.equal(degradedServices[0].state, 'POWEROFF')
assert.equal(
  catalog.assets.filter((asset) => asset.serviceId === 'os-ddec4cf-dhtest').length,
  0,
  'and it holds nothing, so no chain runs through it',
)

// Not examined is never the same as fine. This is the assertion that stops the walk clearing a
// service nobody has read.
assert.equal(hopHealth('webshop-simulator').health, 'unknown')
assert.ok(hopHealth('webshop-simulator').why.includes('cannot be cleared or blamed'))
assert.ok(
  real.verdict.includes('"nothing found" rather than "nothing wrong"'),
  'a chain with an unassessed hop says so instead of reporting all clear',
)

// Freshness states what it measured and refuses to compose what it cannot.
const withTopic = diagnose('ch.service_kafka.orders')!
assert.ok(withTopic.freshness.includes('records behind'), 'consumer lag is the one delay this project measures')
assert.ok(
  withTopic.freshness.includes('cannot be added into an end-to-end age'),
  'a position is not a duration, and the document must not pretend otherwise',
)
assert.ok(
  diagnose('marmot.users')!.freshness.includes('No hop in this chain measures its own delay'),
  'a chain with nothing measurable says so rather than reporting zero',
)

// The boundary, on every diagnosis, because the consumer is where the fault usually is and is the
// one place Aiven cannot see.
for (const asset of catalog.assets) {
  const walk = diagnose(asset.id)
  if (!walk) continue
  assert.ok(walk.boundary.includes('stops where Aiven can see'), `${asset.id} omits the boundary`)
}

// An asset nothing feeds gets an answer, not an empty panel: "the cause is not upstream" is useful.
const source = diagnose('marmot.users')!
assert.ok(source.chain.length === 0 || source.verdict.length > 40)
assert.ok(diagnose('pg.public.orders')!.chain.length > 0, 'even a source table is written by something')
assert.equal(diagnose('no-such-asset'), undefined)

// Foreign keys are structure, not flow. marmot has 65 of them and nothing arrives through one, so
// a walk that followed them would report a chain of dozens of hops for every table in the schema.
const fkHeavy = diagnose('marmot.api_keys')!
assert.ok(fkHeavy.chain.length < 5, `${fkHeavy.chain.length} hops upstream of api_keys means foreign keys are being walked`)

console.log(
  `diagnose: ok (${real.chain.length}-hop webshop chain, cause named from 3 injected faults, ${catalog.assets.length} assets walked)`,
)
