// Self-check for graph maths. Run: node src/lib/graph-math.check.ts
import assert from 'node:assert/strict'
import { groupedLayout, neighborhood } from './graph-math.ts'

// a → b → c → d, plus a side branch b → e and a cycle d → b.
const links = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'd' },
  { source: 'b', target: 'e' },
  { source: 'd', target: 'b' },
  { source: 'x', target: 'y' },
]

const at = (focus: string, depth: number) => [...neighborhood(links, focus, depth)].sort()

// Depth counts hops, and the focus node is always in its own neighbourhood.
assert.deepEqual(at('a', 0), ['a'])
assert.deepEqual(at('a', 1), ['a', 'b'])
assert.deepEqual(at('a', 2), ['a', 'b', 'c', 'd', 'e'])

// Direction is ignored: c is reachable from d even though the edge points the other way.
assert.deepEqual(at('d', 1), ['b', 'c', 'd'])

// The cycle must not loop forever, and Infinity must stop at the component boundary rather
// than dragging in the unrelated x–y pair.
assert.deepEqual(at('a', Infinity), ['a', 'b', 'c', 'd', 'e'])
assert.deepEqual(at('x', Infinity), ['x', 'y'])

// An id that is in no link at all is its own component, never a crash.
assert.deepEqual(at('nope', Infinity), ['nope'])

// --- groupedLayout ---

const box = { width: 100, height: 50, padding: 10, header: 30 }
const members = [
  { id: 'a1', group: 'a' },
  { id: 'a2', group: 'a' },
  { id: 'b1', group: 'b' },
]
const nested = groupedLayout(
  members,
  [
    { source: 'a1', target: 'a2' },
    { source: 'a2', target: 'b1' },
  ],
  box,
)

const group = (id: string) => nested.groups.find((item) => item.id === id)!
const member = (id: string) => nested.nodes.find((item) => item.id === id)!

// Every group and member is placed exactly once.
assert.equal(nested.groups.length, 2)
assert.equal(nested.nodes.length, members.length)

// A group is big enough to hold its members plus the header and padding, and a solo member
// gives a group of exactly one box plus the chrome.
assert.equal(group('b').width, box.width + box.padding * 2)
assert.equal(group('b').height, box.height + box.header + box.padding)
assert.ok(group('a').width >= box.width * 2, 'two ranked members must widen the group')

// Member coordinates are relative to their group, so they start at the padding/header corner
// and always leave room for the box itself.
for (const item of nested.nodes) {
  assert.ok(item.x >= box.padding, `${item.id} starts inside the left padding`)
  assert.ok(item.y >= box.header, `${item.id} clears the group header`)
  assert.ok(item.x + box.width <= group(item.group).width - box.padding + 0.001, `${item.id} fits`)
  assert.ok(item.y + box.height <= group(item.group).height - box.padding + 0.001, `${item.id} fits`)
}

// The internal link ranks a1 before a2 left-to-right, and the crossing link ranks group a
// before group b. Without the second pass the groups would sit on top of each other.
assert.ok(member('a1').x < member('a2').x, 'internal edge should order members')
assert.ok(group('a').x < group('b').x, 'crossing edge should order groups')

// Groups must not overlap horizontally.
assert.ok(group('a').x + group('a').width <= group('b').x, 'groups should not overlap')

console.log('graph-math: ok')
