import assert from 'node:assert/strict'

// The store is the only thing standing between a typed tag and what every view then reads back, so
// it is worth checking without a browser. Both globals it touches are stubbed before importing it.
let store: Record<string, string> = {}
const events: string[] = []
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  },
  window: { dispatchEvent: (event: Event) => events.push(event.type) },
})

const edits = await import('./catalog-edits.ts')

// Tags of a service or folder, which have none in the snapshot and so start from nothing.
assert.deepEqual(edits.tagsFor('pg-37c7de3b'), [])
edits.setTags('pg-37c7de3b', ['production', 'source-of-truth'])
assert.deepEqual(edits.tagsFor('pg-37c7de3b'), ['production', 'source-of-truth'])
assert.ok(events.includes('catalog-edits'), 'saving tells the views to re-read')

// An asset passes its snapshot tags as the fallback: untouched it shows those, and once edited the
// stored list takes over completely.
assert.deepEqual(edits.tagsFor('pg.public.customers', ['webshop', 'pii']), ['webshop', 'pii'])
edits.setTags('pg.public.customers', ['webshop', 'pii', 'verified'])
assert.deepEqual(edits.tagsFor('pg.public.customers', ['webshop', 'pii']), ['webshop', 'pii', 'verified'])

// The case that decides whether removing a tag works at all: an entity edited down to nothing must
// read back as nothing, not fall through to the snapshot tags it was cleared of.
edits.setTags('pg.public.customers', [])
assert.deepEqual(edits.tagsFor('pg.public.customers', ['webshop', 'pii']), [])

// Typed input is normalised on the way in, so nothing downstream has to cope with variants.
edits.setTags('crm-pg', ['  PII  ', 'Needs Review!!', 'pii', 'production'])
assert.deepEqual(edits.tagsFor('crm-pg'), ['pii', 'needs-review', 'production'], 'trimmed, folded and deduplicated')
edits.setTags('crm-pg', ['!!!', '   ', 'costly'])
assert.deepEqual(edits.tagsFor('crm-pg'), ['costly'], 'input with nothing usable in it is dropped')

// Columns are keyed under their asset, so tagging one must not disturb its siblings or the table.
edits.setColumnTags('pg.public.customers', 'email', ['pii', 'gdpr-erasure'])
edits.setColumnTags('pg.public.customers', 'id', ['join-key'])
assert.deepEqual(edits.columnTagsFor('pg.public.customers', 'email'), ['pii', 'gdpr-erasure'])
assert.deepEqual(edits.columnTagsFor('pg.public.customers', 'id'), ['join-key'])
assert.deepEqual(edits.columnTagsFor('pg.public.customers', 'name'), [], 'an untagged column stays empty')
assert.deepEqual(edits.columnTagsFor('pg.public.orders', 'id'), [], 'same column name, different asset')
assert.deepEqual(edits.tagsFor('pg.public.customers', ['webshop']), [], 'the asset itself is untouched')

// Column tags and column descriptions share a key space in the stored object; neither may drop the
// other, since they are written by two different fields on the same row.
edits.setColumnDescription('pg.public.customers', 'email', 'Login address.')
edits.setColumnTags('pg.public.customers', 'email', ['pii'])
assert.equal(edits.columnDescription('pg.public.customers', 'email'), 'Login address.')
assert.deepEqual(edits.columnTagsFor('pg.public.customers', 'email'), ['pii'])

// What is actually persisted, and what happens when it comes back damaged or from an older version
// of the app that never wrote tags.
const saved = JSON.parse(store['catalog-edits'])
assert.deepEqual(Object.keys(saved).sort(), ['assets', 'columnTags', 'columns', 'tags'])

store = { 'catalog-edits': JSON.stringify({ assets: { 'pg.public.orders': 'Older edit.' } }) }
assert.equal(edits.assetDescription('pg.public.orders', 'fallback'), 'Older edit.', 'old edits survive')
assert.deepEqual(edits.tagsFor('pg.public.orders', ['webshop']), ['webshop'], 'missing tags mean none stored')

store = { 'catalog-edits': 'not json at all' }
assert.deepEqual(edits.tagsFor('anything', ['fallback']), ['fallback'], 'a damaged store reads as empty')

console.log('catalog-edits: ok')
