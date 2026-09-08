// Self-check for catalog descriptions. Run: node src/lib/catalog.check.ts
//
// Imports the snapshot only, not lib/catalog.ts, which uses `@/` aliases node cannot resolve.
import assert from 'node:assert/strict'
import { catalog, folderDescriptions } from '../data/catalog.ts'
import { reachable } from './graph-math.ts'

// The deliverable: nothing in the catalog is left undescribed. An empty string counts as missing,
// since that is what renders as a blank cell.
const bareAssets = catalog.assets.filter((asset) => !asset.description.trim())
assert.deepEqual(bareAssets.map((a) => a.id), [], 'every asset carries a description')

const bareColumns = catalog.assets.flatMap((asset) =>
  asset.columns.filter((column) => !column.note?.trim()).map((column) => `${asset.id}.${column.name}`),
)
assert.deepEqual(bareColumns, [], 'every column carries a note')
assert.ok(catalog.assets.reduce((n, a) => n + a.columns.length, 0) > 200, 'the columns are actually there to describe')

// Notes are written once on the PostgreSQL source and must survive both derivations, or the same
// prose would have to be maintained three times.
const noteFor = (assetId: string, column: string) =>
  catalog.assets.find((a) => a.id === assetId)?.columns.find((c) => c.name === column)?.note

const sourceNote = noteFor('pg.public.order_items', 'unit_price')
assert.match(sourceNote ?? '', /not the current/, 'the source note is the interesting one')
assert.equal(noteFor('kafka.webshop.public.order_items', 'unit_price'), sourceNote, 'avroFromPg keeps the note')
assert.equal(noteFor('ch.service_kafka.order_items', 'unit_price'), sourceNote, 'chFromAvro keeps the note')

// The federated campaigns table used to overwrite every note with one generic string; it must now
// keep the real prose and only fill in where the source has none.
assert.equal(noteFor('ch.pg.marketing.campaigns', 'budget_eur'), noteFor('pg.marketing.campaigns', 'budget_eur'))
assert.ok(
  !catalog.assets
    .find((a) => a.id === 'ch.pg.marketing.campaigns')
    ?.columns.every((c) => c.note === 'Federated from PostgreSQL'),
  'the generic note no longer masks the real ones',
)

// Debezium metadata columns exist only downstream, so they are described where they appear.
assert.equal(noteFor('pg.public.orders', '__op'), undefined, 'the source table has no CDC metadata')
assert.match(noteFor('kafka.webshop.public.orders', '__op') ?? '', /Debezium/)

// Folder ids are built by catalogTree as `service:schema`, with `defaultdb` interposed for
// PostgreSQL. A key that matches nothing is a typo that would silently show the generic fallback.
const schemasOf = (serviceId: string) =>
  new Set(catalog.assets.filter((a) => a.serviceId === serviceId).map((a) => a.schema))

for (const [key, text] of Object.entries(folderDescriptions)) {
  const [serviceId, folder] = key.split(':')
  const service = catalog.services.find((s) => s.id === serviceId)
  assert.ok(service, `${key} names a service in the snapshot`)
  assert.ok(
    folder === 'defaultdb' ? service.type === 'pg' : schemasOf(serviceId).has(folder),
    `${key} names a schema that some asset actually sits in`,
  )
  assert.ok(text.length > 40, `${key} says something specific rather than a stub`)
}

// Coverage the other way: every schema a user can click on has real prose. Applications and
// connectors hang their assets directly off the service, so they never produce a folder.
const foldered = new Set(['pg', 'clickhouse', 'kafka'])
for (const service of catalog.services) {
  if (!foldered.has(service.type)) continue
  for (const schema of schemasOf(service.id)) {
    if (!schema) continue
    assert.ok(folderDescriptions[`${service.id}:${schema}`], `${service.id}:${schema} has no description`)
  }
  if (service.type === 'pg' && schemasOf(service.id).size) {
    assert.ok(folderDescriptions[`${service.id}:defaultdb`], `${service.id}:defaultdb has no description`)
  }
}

// The asset page draws lineage column to column, attaching each edge to a handle named after the
// column. React Flow silently drops an edge whose handle does not exist, so a row naming a column
// its asset does not have would go missing from the picture while still being counted beside the
// tab — which is the disagreement that made 11 links look like 2.
const columnsOf = (assetId: string) =>
  new Set(catalog.assets.find((asset) => asset.id === assetId)?.columns.map((column) => column.name))

for (const edge of catalog.lineage) {
  if (edge.sourceColumn) {
    assert.ok(columnsOf(edge.sourceAssetId).has(edge.sourceColumn), `${edge.id}: ${edge.sourceAssetId} has no column ${edge.sourceColumn}`)
  }
  if (edge.destColumn) {
    assert.ok(columnsOf(edge.destAssetId).has(edge.destColumn), `${edge.id}: ${edge.destAssetId} has no column ${edge.destColumn}`)
  }
  // Recording one end per column and the other per dataset would stack the whole fan on one
  // handle, which draws as a single line no matter how many rows there are.
  assert.equal(
    Boolean(edge.sourceColumn),
    Boolean(edge.destColumn),
    `${edge.id} is column-level at one end only`,
  )
}

// Two edges resolving to the same pair of handles would overlap exactly, so a link would be
// counted but not separately visible.
const pairs = catalog.lineage.map(
  (edge) => `${edge.sourceAssetId}.${edge.sourceColumn ?? '*'}->${edge.destAssetId}.${edge.destColumn ?? '*'}`,
)
assert.equal(new Set(pairs).size, pairs.length, 'every lineage edge draws on its own pair of handles')

// The case in the report: eleven links between two datasets, one per column, all of them drawable.
const toChProducts = catalog.lineage.filter((edge) => edge.destAssetId === 'ch.service_kafka.products')
assert.equal(toChProducts.length, 11)
assert.equal(new Set(toChProducts.map((edge) => edge.sourceAssetId)).size, 1, 'all eleven come from the one topic')
assert.ok(toChProducts.every((edge) => edge.destColumn), 'each names the column it lands on')

// The asset page starts at the direct neighbours and offers another hop while one is left. That
// only makes sense because the webshop chain is genuinely deeper than one hop, so assert the shape
// it walks: simulator writes Postgres, CDC copies it to a topic, ClickHouse consumes the topic.
const links = catalog.lineage.map((edge) => ({ source: edge.sourceAssetId, target: edge.destAssetId }))
const upstreamOf = (assetId: string, depth: number) =>
  [...reachable(links, assetId, depth, 'backward')].filter((id) => id !== assetId).sort()

assert.deepEqual(upstreamOf('ch.service_kafka.orders', 1), ['kafka.webshop.public.orders'])
assert.deepEqual(upstreamOf('ch.service_kafka.orders', 2), [
  'kafka.webshop.public.orders',
  'pg.public.orders',
])
assert.ok(
  upstreamOf('ch.service_kafka.orders', 3).includes('app.webshop-simulator'),
  'the third hop reaches the application that writes the source table',
)

// Each hop must add something, or the button offering it would redraw the same picture.
const widths = [1, 2, 3, 4].map((depth) => upstreamOf('ch.service_kafka.orders', depth).length)
assert.deepEqual(widths, [1, 2, 4, 4], 'three hops grow the graph, the fourth is exhausted')

// Downstream is the same chain read the other way: Postgres reaches ClickHouse in two hops, and
// ClickHouse is queried by Trino, which is where the story ends.
assert.ok(reachable(links, 'pg.public.orders', 2, 'forward').has('ch.service_kafka.orders'))
assert.deepEqual(
  [...reachable(links, 'ch.service_kafka.orders', Infinity, 'forward')].sort(),
  ['ch.service_kafka.orders', 'trino.summit_clickhouse'],
  'the Trino catalog is the last thing downstream of ClickHouse',
)

// The data model tab is offered per folder by whether a foreign key joins the tables under it, so
// what has to hold is the shape of the recorded keys. Two schemas have a relational model; the rest
// are topics, engine tables and append-only logs, and drawing them would be a row of loose boxes.
const keys = catalog.lineage.filter((edge) => edge.kind === 'fk')
const schemaOf = (assetId: string) => {
  const asset = catalog.assets.find((item) => item.id === assetId)
  return asset ? `${asset.serviceId}:${asset.schema}` : '?'
}
assert.deepEqual(
  [...new Set(keys.map((edge) => schemaOf(edge.sourceAssetId)))].sort(),
  ['crm-pg:public', 'pg-37c7de3b:public'],
  'only the webshop and CRM schemas have foreign keys recorded',
)
assert.ok(
  keys.every((edge) => schemaOf(edge.sourceAssetId) === schemaOf(edge.destAssetId)),
  'every key stays inside its schema, so no model has to reach outside the folder',
)
assert.ok(keys.every((edge) => edge.sourceColumn && edge.destColumn), 'each key names both columns')

// Each key must land on a column the target actually has, or the arrow falls back to the header
// handle and the model stops saying which column it references.
for (const edge of keys) {
  const target = catalog.assets.find((item) => item.id === edge.destAssetId)
  assert.ok(
    target?.columns.some((column) => column.name === edge.destColumn),
    `${edge.destAssetId} has the referenced column ${edge.destColumn}`,
  )
}

// The tables that take part, versus everything the folder holds: the Postgres database folder draws
// four of its five tables, and marketing.campaigns stays in the Contains list where it reads better.
const related = new Set(keys.flatMap((edge) => [edge.sourceAssetId, edge.destAssetId]))
const pgTables = catalog.assets.filter((asset) => asset.serviceId === 'pg-37c7de3b')
assert.equal(pgTables.length, 5)
assert.equal(pgTables.filter((asset) => related.has(asset.id)).length, 4)

// The folder the tab must stay away from: 58 tables, no keys, most without a column list.
const marmot = catalog.assets.filter((asset) => asset.serviceId === 'marmot-pg')
assert.ok(marmot.length > 50 && !marmot.some((asset) => related.has(asset.id)))

console.log(`catalog: ok (${catalog.assets.length} assets, ${catalog.assets.reduce((n, a) => n + a.columns.length, 0)} columns, ${Object.keys(folderDescriptions).length} folders, ${catalog.lineage.length} lineage edges)`)
