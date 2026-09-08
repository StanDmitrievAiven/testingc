import assert from 'node:assert/strict'
import { catalog } from './catalog.ts'
import { isPredefinedTag, normalizeTag, tagDescription, tagVocabulary } from './tags.ts'

// The point of the vocabulary is that hovering a tag explains it. A tag the catalog already uses
// but the vocabulary does not describe would render as somebody's own undescribed tag, so the two
// have to stay in step: this fails the moment a tag is added to the snapshot without a description.
const used = [...new Set(catalog.assets.flatMap((asset) => asset.tags))].sort()
const undescribed = used.filter((tag) => !isPredefinedTag(tag))
assert.deepEqual(undescribed, [], 'every tag in the snapshot has a description')
assert.ok(used.length >= 18, `the snapshot still uses its tags (${used.length})`)
assert.ok(!used.includes('federated'), 'the federated/federation pair stayed merged into one tag')

// Sensitivity is the group people reach for first, so it has to cover the usual classifications
// rather than personal data alone.
const sensitivity = tagVocabulary.find((group) => group.name === 'Sensitivity')?.tags ?? {}
assert.ok(
  ['pii', 'special-category', 'pci', 'credentials', 'pseudonymised', 'anonymised', 'gdpr-erasure'].every(
    (tag) => tag in sensitivity,
  ),
  'the sensitivity group covers the classifications people expect to find',
)

// One tag must not appear in two groups, or which description you get depends on group order.
const listed = tagVocabulary.flatMap((group) => Object.keys(group.tags))
assert.equal(new Set(listed).size, listed.length, 'no tag is defined twice')
assert.ok(listed.length >= 20, `enough predefined tags to be useful (${listed.length})`)
assert.ok(
  listed.every((tag) => normalizeTag(tag) === tag),
  'every predefined tag is already in the stored shape, so picking one cannot alter it',
)
assert.ok(
  Object.values(Object.assign({}, ...tagVocabulary.map((group) => group.tags))).every(
    (text) => typeof text === 'string' && (text as string).length > 20,
  ),
  'each description actually says something',
)

// What somebody types has to collapse to the same word the vocabulary uses, or the description is
// lost and the catalog ends up with three spellings of one tag.
assert.equal(normalizeTag('PII'), 'pii')
assert.equal(normalizeTag('  Pii  '), 'pii')
assert.equal(normalizeTag('needs owner'), 'needs-owner')
assert.equal(normalizeTag('needs_owner'), 'needs-owner')
assert.equal(normalizeTag('Source Of Truth'), 'source-of-truth')
assert.equal(normalizeTag('gdpr--erasure'), 'gdpr-erasure', 'runs of separators collapse')
assert.equal(normalizeTag('v1.2'), 'v1.2', 'dots survive, for version-shaped tags')

// Anything that would make a tag unmatchable or unreadable is dropped rather than stored.
assert.equal(normalizeTag('<script>pii</script>'), 'scriptpiiscript')
assert.equal(normalizeTag('tag!!!'), 'tag')
assert.equal(normalizeTag('-leading-and-trailing-'), 'leading-and-trailing')
assert.equal(normalizeTag('   '), '', 'nothing usable means nothing to add')
assert.equal(normalizeTag('!!!'), '')
assert.equal(normalizeTag('x'.repeat(80)).length, 32, 'a pasted paragraph cannot become a tag')

// A normalised tag is unchanged by normalising again: the store keeps its own output.
for (const raw of ['PII', 'needs owner', 'v1.2', 'x'.repeat(80), 'Source Of Truth']) {
  const once = normalizeTag(raw)
  assert.equal(normalizeTag(once), once, `normalising ${once} again leaves it alone`)
}

assert.equal(tagDescription('pii')?.startsWith('Personal data'), true)
assert.equal(tagDescription('not-a-real-tag'), undefined, 'own tags simply have no description')

console.log(`tags: ok (${listed.length} predefined in ${tagVocabulary.length} groups, ${used.length} used in the snapshot)`)
