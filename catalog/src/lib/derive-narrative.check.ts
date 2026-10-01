// Self-check for the review gate and the derived narrative.
// Run: node --experimental-strip-types src/lib/derive-narrative.check.ts
//
// Two failures are worth guarding against and neither is a crash. The first is a generated sentence
// that quietly becomes fact — the governance failure where, as Marko Bocevski put it, "somebody
// does that and doesn't pay attention to it and just says, 'Oh, this is great.'" The second is a
// rejected sentence that stays in the store, where something eventually reads the value without
// reading the state.
import assert from 'node:assert/strict'
import { contextLog } from '../data/context-log.ts'
import {
  assetDescription,
  grantGeneration,
  grantsHeld,
  provenanceOf,
  review,
  revokeGeneration,
  setAssetDescription,
  suggest,
} from './catalog-edits.ts'
import { draftFor, draftableServices } from './derive-narrative.ts'

// A store in memory, because this runs under plain Node. The shim is four lines and means the
// review gate is checked through the same functions the browser calls, rather than a copy of them.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
}
;(globalThis as { window?: unknown }).window = { dispatchEvent: () => true }

// The draft itself, from the real purpose log.
const draft = draftFor('crm-app')
assert.equal(draft.entries, 6)
assert.ok(draft.text.includes('Changed 6 times since'), 'the history is summarised rather than listed in full')
assert.equal(draft.sources.length, 6, 'every entry behind the sentence is named, not just the newest')
assert.ok(
  draft.sources.every((source) => /^purpose log #\d+ — aiven_\w+ on \d{4}-\d{2}-\d{2}/.test(source)),
  'each source is specific enough to go and read',
)
assert.ok(draft.because.includes('not the same as what the service now does'), 'the draft warns about itself')
assert.deepEqual(draftableServices(), ['crm-pg', 'crm-app', 'crm-sql'])

// A service with no history gets no draft and an explanation, rather than an invented sentence.
const empty = draftFor('pg-37c7de3b')
assert.equal(empty.text, '')
assert.equal(empty.entries, 0)
assert.ok(empty.because.includes('only covers changes made through the agent proxy'))

// Requirement 3: generation is refused outside a granted scope, and refusing says how to proceed.
const refused = suggest('crm-app', draft.text, { author: 'derived from the purpose log', sources: draft.sources })
assert.equal(refused.ok, false)
assert.ok(refused.because.includes('Nobody has agreed'))
assert.equal(assetDescription('crm-app', 'original'), 'original', 'a refused suggestion writes nothing at all')

// Granted, and the grant records who gave it.
grantGeneration('crm-app', 'stan')
assert.equal(grantsHeld()['crm-app'].by, 'stan')
assert.ok(grantsHeld()['crm-app'].at.startsWith('20'))

const accepted = suggest('crm-app', draft.text, { author: 'derived from the purpose log', sources: draft.sources })
assert.ok(accepted.ok)
assert.ok(accepted.because.includes('counts for nothing until somebody accepts it'))

// Requirement 1 and 2: it is stored suggested, with its author, time and every source.
const pending = provenanceOf('crm-app')!
assert.equal(pending.state, 'suggested')
assert.equal(pending.author, 'derived from the purpose log')
assert.equal(pending.sources?.length, 6)
assert.notEqual(pending.state, 'accepted', 'nothing is accepted by default, which is the whole gate')

// Accepting is the only thing that makes it count.
review('crm-app', 'accepted')
assert.equal(provenanceOf('crm-app')!.state, 'accepted')
assert.equal(assetDescription('crm-app', 'original'), draft.text)
assert.equal(
  provenanceOf('crm-app')!.author,
  'derived from the purpose log',
  'accepting does not rewrite history: it stays a generated sentence that somebody agreed to',
)

// Rejecting removes the text as well as the verdict. A rejected sentence left in the store is how
// a rejected sentence ends up on a page.
suggest('crm-pg', draftFor('crm-pg').text, { author: 'derived from the purpose log', sources: ['purpose log #2'] })
assert.equal(provenanceOf('crm-pg'), undefined, 'and crm-pg was never granted, so nothing was written')
grantGeneration('crm-pg', 'stan')
suggest('crm-pg', draftFor('crm-pg').text, { author: 'derived from the purpose log', sources: ['purpose log #2'] })
assert.equal(provenanceOf('crm-pg')!.state, 'suggested')
review('crm-pg', 'rejected')
assert.equal(provenanceOf('crm-pg'), undefined, 'the verdict is gone')
assert.equal(assetDescription('crm-pg', 'original'), 'original', 'and so is the text')

// A grant is per scope, not per project: revoking one leaves the other alone, and revoking stops
// the next suggestion rather than retracting the accepted one.
revokeGeneration('crm-pg')
assert.equal(grantsHeld()['crm-pg'], undefined)
assert.ok(grantsHeld()['crm-app'], 'one revocation does not clear the rest')
assert.equal(suggest('crm-pg', 'anything', { author: 'x', sources: [] }).ok, false)

// A human typing is the author and the reviewer at once. Pretending otherwise would put a person's
// own sentence behind a gate they are standing on the other side of.
setAssetDescription('marmot.users', 'Written by hand.')
const byHand = provenanceOf('marmot.users')!
assert.equal(byHand.state, 'accepted')
assert.equal(byHand.author, 'you')
assert.equal(byHand.sources, undefined, 'a person is their own source')

// The log is what makes any of this possible, so it is worth pinning that every entry has the one
// field the proxy refuses the call without.
assert.ok(contextLog.every((entry) => entry.purpose.length > 30), 'every recorded change says why')

console.log(
  `derive-narrative: ok (${draftableServices().length} draftable services, ${contextLog.length} recorded purposes, gate refuses ungranted scopes)`,
)
