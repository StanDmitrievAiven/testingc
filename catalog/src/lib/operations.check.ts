// Self-check for the operational snapshot reads. Run: node src/lib/operations.check.ts
import assert from 'node:assert/strict'
import { topicHealth } from '../data/operations.ts'
import {
  eventsForService,
  factsForService,
  formatBytes,
  formatMs,
  lagOf,
  shareOfQueryTime,
  topicHealthFor,
  workloadFor,
} from './operations.ts'

// Lag and replay depth are subtractions across partitions, which is the whole point of the panel:
// orders had read all but 5 messages, and retains 1.34M of the 13.8M offsets ever produced.
const orders = topicHealthFor('kafka.webshop.public.orders')
assert.ok(orders, 'the orders topic is in the snapshot')
const { lag, retained, bytes } = lagOf(orders)
assert.equal(lag, 5, 'lag sums latest - consumer across all three partitions')
assert.equal(retained, 1342101, 'retained sums latest - earliest, i.e. what a replay could still reach')
assert.equal(bytes, 243752960)

// A caught-up group must read as exactly zero rather than as a small positive number.
const customers = topicHealthFor('kafka.webshop.public.customers')
assert.ok(customers)
assert.equal(lagOf(customers).lag, 0, 'every partition level with its consumer means no lag')

assert.equal(topicHealthFor('pg.public.customers'), undefined, 'tables have no topic health')

// Workload is attributed per table, heaviest first, and must not leak across tables or services.
const ordersWork = workloadFor('pg-37c7de3b', 'orders')
assert.equal(ordersWork[0].id, 'orders-status-sample', 'the heaviest statement sorts first')
assert.ok(
  ordersWork.every((stat) => stat.tables.includes('orders')),
  'only statements touching the table are returned',
)
assert.ok(
  ordersWork[0].totalMs > ordersWork[ordersWork.length - 1].totalMs,
  'ordering is by total time, descending',
)
assert.deepEqual(workloadFor('crm-pg', 'orders'), [], 'no statements were captured for other services')
assert.deepEqual(workloadFor('pg-37c7de3b', 'campaigns'), [], 'an untouched table has no workload')

// The two ORDER BY random() statements are the reason this panel exists: together they are
// essentially all of the service's query time.
const share = shareOfQueryTime(ordersWork[0]) + shareOfQueryTime(workloadFor('pg-37c7de3b', 'customers')[0])
assert.ok(share > 0.99 && share <= 1, `two statements hold almost all query time, got ${share}`)

// Units have to move with the value: the same formatter renders 0.026 ms and 24 hours.
assert.equal(formatMs(86580571.573), '24.1 h')
assert.equal(formatMs(1985.247), '1.99 s')
assert.equal(formatMs(217.319), '217 ms')
assert.equal(formatMs(0.026), '0.03 ms')
assert.equal(formatBytes(243752960), '232 MB')
assert.equal(formatBytes(3402251285), '3.2 GB')

// Events come back newest first, and only for the service asked about.
const events = eventsForService('pg-37c7de3b')
assert.ok(events.length >= 4)
assert.ok(
  events.every((event) => event.serviceId === 'pg-37c7de3b'),
  'no other service leaks into the timeline',
)
assert.deepEqual(
  [...events].sort((a, b) => b.at.localeCompare(a.at)).map((event) => event.id),
  events.map((event) => event.id),
  'already ordered newest first',
)
assert.ok(
  events.some((event) => event.actor === 'Aiven Automation'),
  'the failover nobody triggered is present, which is the point of showing this next to the purpose log',
)
assert.deepEqual(eventsForService('nope'), [])

// Facts are captured for only some services; callers must be able to tell.
assert.equal(factsForService('pg-37c7de3b')?.nodeCount, 1)
assert.equal(factsForService('clickhouse-2a6274d2')?.pendingUpdates.length, 3)
assert.equal(factsForService('trino2'), undefined, 'an uncaptured service returns undefined, not a blank record')

// Every topic in the snapshot must be internally consistent, or the arithmetic above is meaningless.
for (const health of topicHealth) {
  for (const partition of health.partitions) {
    assert.ok(
      partition.earliestOffset <= partition.consumerOffset && partition.consumerOffset <= partition.latestOffset,
      `${health.assetId} partition ${partition.partition} has offsets out of order`,
    )
    assert.ok(partition.isr >= health.minInsyncReplicas, `${health.assetId} is below its min in-sync replicas`)
  }
}

console.log('operations: ok')
