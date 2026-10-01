// Self-check for catalog descriptions. Run: node src/lib/catalog.check.ts
//
// Imports the snapshot only, not lib/catalog.ts, which uses `@/` aliases node cannot resolve.
import assert from 'node:assert/strict'
import { catalog, folderDescriptions } from '../data/catalog.ts'
import { behaviourTags, knownOwners, observedPeople, resolveOwners, searchAll, treeAncestors } from './catalog.ts'
import { setOwners } from './catalog-edits.ts'
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
  ['crm-pg:public', 'marmot-pg:public', 'pg-37c7de3b:public'],
  'the webshop, CRM and Marmot schemas have foreign keys recorded',
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

// Marmot's model was read from the live service's constraints, so what has to hold is that it came
// across whole: 61 keys over 44 of its 57 tables, every one of them drawable.
const marmot = catalog.assets.filter((asset) => asset.serviceId === 'marmot-pg')
const marmotKeys = keys.filter((edge) => schemaOf(edge.sourceAssetId) === 'marmot-pg:public')
assert.equal(marmot.length, 57)
assert.equal(marmotKeys.length, 61, 'every foreign key in the schema is recorded')
assert.equal(new Set(marmot.filter((asset) => related.has(asset.id)).map((a) => a.id)).size, 44)

// The three shapes that would otherwise go untested: a self-reference, two keys from one table to
// the same target, and a key that lands on a unique column rather than the primary key.
assert.ok(marmotKeys.some((edge) => edge.sourceAssetId === edge.destAssetId), 'doc_pages nests itself')
assert.equal(
  marmotKeys.filter((edge) => edge.sourceAssetId === 'marmot.lineage_edges' && edge.destAssetId === 'marmot.assets').length,
  2,
  'lineage_edges points at assets twice, once per endpoint',
)
assert.ok(
  marmotKeys.some((edge) => edge.destColumn === 'mrn'),
  'the MRN keys are kept as MRN keys rather than rewritten to id',
)

// The schema's own description quotes these counts, and a description that silently stops matching
// the data is worse than none: this is what makes changing the tables force the prose to follow.
const marmotSchemaText = folderDescriptions['marmot-pg:public']
assert.ok(
  [57, 44, 61, 13].every((count) => marmotSchemaText.includes(String(count))),
  `the schema description still quotes its real counts: ${marmotSchemaText}`,
)

// A table with no keys keeps no column list, so the honest gap stays visible rather than being
// filled with invented descriptions.
const bare = marmot.filter((asset) => !related.has(asset.id))
assert.equal(bare.length, 13)
assert.ok(
  bare.every((asset) => asset.columns.length === 0 && /No keys and no column list/.test(asset.description)),
  'the unrelated tables say why they are empty',
)

// Search has to find things by what they are, not only by what they are called — the case that
// prompted it being a set of topics named F1_2. So each route in is pinned: a description, a tag, a
// column, a contact. And each hit has to report the field it matched on, because a search that
// cannot say why it returned something is asking the reader to guess.
assert.deepEqual(
  searchAll('postgresconnector').assets.map((hit) => [hit.item.name, hit.why]),
  [['webshop-pg-cdc', 'description']],
  'a word that appears only in a description must still find its asset, and say that is where it matched',
)
assert.ok(
  searchAll('email').columns.some((hit) => hit.item.column.name === 'email' && hit.why === 'name'),
  'columns are searchable in their own right: the answer to "where are the email addresses" is a column',
)
assert.equal(
  searchAll('stan.dmitriev').services.map((hit) => `${hit.item.id} ${hit.why}`).join(),
  'pg-37c7de3b contact',
  'searching for a person finds the service they are the contact for',
)

// `tag:` filters across services, which is how a sensitivity question stops being a project tour.
const blocked = searchAll('tag:agent-blocked')
assert.equal(blocked.assets.length, 4, 'four assets hold credentials an agent must not read')
assert.ok(
  blocked.assets.every((hit) => hit.tags.includes('agent-blocked') && hit.why === 'tag: agent-blocked'),
  'a tag filter must return only tagged things, and say the tag is why',
)
assert.ok(
  blocked.assets.every((hit) => hit.tags.some((tag) => behaviourTags.includes(tag))),
  'a result carries the tags that change behaviour, so it warns before it is opened rather than after',
)
assert.equal(searchAll('tag:pi').assets.length, searchAll('tag:pii').assets.length, 'a partial tag matches while typing')
assert.equal(searchAll('tag:nonexistent-tag').assets.length, 0, 'an unknown tag matches nothing rather than everything')

// Name matches must outrank the rest, or every result reads as a description hit.
const named = searchAll('customers')
assert.ok(
  named.assets.filter((hit) => hit.item.name === 'customers').every((hit) => hit.why === 'name'),
  'a hit on the name reports as a name',
)
for (const hits of [searchAll('pg').services, searchAll('order').assets]) {
  assert.equal(new Set(hits.map((hit) => JSON.stringify(hit.item))).size, hits.length, 'no result appears twice')
}

// Ownership. Inheritance is the whole feature: without it, owning ninety-four tables means ninety-
// four edits, which is why the ownership field in most catalogs is empty. So the fallback up the
// tree is what gets pinned, along with the part that keeps it honest — saying where it came from.
assert.deepEqual(
  catalog.assets.filter((asset) => treeAncestors(asset.id).length === 0).map((a) => a.id),
  [],
  'every asset is reachable in the tree, which is what inheritance walks',
)

let store: Record<string, string> = {}
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  },
  window: { dispatchEvent: () => true },
})

assert.deepEqual(resolveOwners('pg.public.orders'), { owners: [] }, 'nothing is owned until somebody says so')

setOwners('pg-37c7de3b', [{ name: 'Webshop Team', kind: 'group' }])
assert.deepEqual(
  resolveOwners('pg.public.orders'),
  { owners: [{ name: 'Webshop Team', kind: 'group' }], inheritedFrom: 'pg-37c7de3b' },
  'a table with no owner belongs to whoever owns its service, and says so',
)

// The nearest owner wins rather than accumulating: "who do I tell" has one answer, and a schema
// owner sitting between the table and the service is the more specific one.
setOwners('pg-37c7de3b:public', [{ name: 'Orders Squad', kind: 'group' }])
assert.deepEqual(resolveOwners('pg.public.orders'), {
  owners: [{ name: 'Orders Squad', kind: 'group' }],
  inheritedFrom: 'pg-37c7de3b:public',
})
assert.equal(resolveOwners('pg.marketing.campaigns').inheritedFrom, 'pg-37c7de3b', 'a sibling schema is unaffected')

setOwners('pg.public.orders', [{ name: 'ana@example.com', kind: 'person' }])
assert.deepEqual(
  resolveOwners('pg.public.orders'),
  { owners: [{ name: 'ana@example.com', kind: 'person' }] },
  'an owner set here overrides the schema, and is not marked as inherited',
)
assert.equal(resolveOwners('pg-37c7de3b').inheritedFrom, undefined, 'a service is the top, so it inherits nothing')

// Searching by owner has to follow inheritance too, or "what does this team own" answers with the
// one schema they were assigned and none of the tables under it.
const owned = searchAll('owner:orders squad')
assert.ok(
  owned.assets.some((hit) => hit.item.id === 'pg.public.order_items' && hit.why.includes('via public')),
  'inherited ownership is found, and reported as inherited rather than as a direct claim',
)
assert.ok(
  !owned.assets.some((hit) => hit.item.id === 'pg.public.orders'),
  'a table with its own owner is not returned for the schema owner it overrode',
)
assert.equal(owned.columns.length, 0, 'columns have no owner of their own, so an owner search skips them')
assert.equal(searchAll('owner:nobody at all').assets.length, 0, 'an unknown owner matches nothing')
assert.ok(
  searchAll('ana@example.com').assets.some((hit) => hit.item.id === 'pg.public.orders'),
  'an owner is findable without the prefix, since that is how a name gets pasted into a search box',
)

assert.deepEqual(
  knownOwners().map((owner) => owner.name),
  ['ana@example.com', 'Orders Squad', 'Webshop Team'],
  'everyone already named is offered as a suggestion, so the second assignment is a click',
)
assert.ok(
  observedPeople().every((person) => person.name.includes('@') && person.kind === 'person'),
  'observed suggestions are addresses of people, never platform actors',
)
store = {}

console.log(`catalog: ok (${catalog.assets.length} assets, ${catalog.assets.reduce((n, a) => n + a.columns.length, 0)} columns, ${Object.keys(folderDescriptions).length} folders, ${catalog.lineage.length} lineage edges)`)
