// Run with: node --experimental-strip-types src/lib/fleet.check.ts
//
// A triage board that disagrees with the detail view is worse than no board at all: it teaches
// people to distrust both. So most of what follows is agreement — every row against the document it
// links to, every fleet-wide count against the services it names, and the coverage numbers against
// the same policy resolution the agent uses. The ordering is checked too, because a board sorted
// wrongly is read wrongly, and nobody notices.
import { catalog } from '../data/catalog.ts'
import { serviceFacts } from '../data/operations.ts'
import { findingsFor, policyFor } from './agent-context.ts'
import { serviceById } from './catalog.ts'
import { coverageFor, fleetCoverage, fleetFindings, fleetRows } from './fleet.ts'

function assert(ok: boolean, what: string): void {
  if (!ok) throw new Error(`fleet: ${what}`)
}

const rows = fleetRows()
const findings = fleetFindings()
const coverage = fleetCoverage()

// Every service appears exactly once, including the ones with nothing to say about them.
assert(rows.length === catalog.services.length, `expected ${catalog.services.length} rows, got ${rows.length}`)
assert(new Set(rows.map((r) => r.serviceId)).size === rows.length, 'a service must not appear twice')

// The board and the document are the same numbers. This is the whole contract.
for (const row of rows) {
  const detail = findingsFor(row.serviceId)
  assert(row.findings === detail.length, `${row.serviceId}: board says ${row.findings} findings, document says ${detail.length}`)
  assert(row.worst?.title === detail[0]?.title, `${row.serviceId}: the headline finding must be the document's first`)
  assert(row.known === Object.values(coverageFor(row.serviceId)).filter(Boolean).length, `${row.serviceId} coverage count`)
}

// Worst first, then services with findings, then criticality, then count. A board where everything
// is red has to break the tie on something, or it is a list in arbitrary order wearing a severity.
const severityRank = { danger: 0, caution: 1, info: 2 } as const
const criticalityRank = { critical: 0, important: 1, standard: 2, low: 3 } as const
for (let i = 1; i < rows.length; i += 1) {
  const previous = rows[i - 1]
  const row = rows[i]
  const key = (r: (typeof rows)[number]) => [
    severityRank[r.worst?.severity ?? 'info'],
    r.findings === 0 ? 1 : 0,
    r.criticality ? criticalityRank[r.criticality] : criticalityRank.important,
    -r.findings,
  ]
  const a = key(previous)
  const b = key(row)
  const firstDifference = a.findIndex((value, index) => value !== b[index])
  assert(
    firstDifference === -1 || a[firstDifference] < b[firstDifference],
    `${previous.serviceId} must not sort above ${row.serviceId}`,
  )
}
assert(rows[0].serviceId === 'crm-pg', 'crm-pg is critical with the most findings, so it leads the board')
assert(
  rows.filter((r) => r.findings > 0).length === 7,
  `expected 7 services with findings, got ${rows.filter((r) => r.findings > 0).length}`,
)
// An unclassified service sorts with important rather than last: nobody has thought about it, which
// is not the same as it not mattering.
assert(
  rows.findIndex((r) => r.criticality === undefined) > rows.findIndex((r) => r.criticality === 'low'),
  'the classified test cluster has findings, so it still sorts above services with none',
)

// Fleet findings count what they name, and name things that exist.
for (const finding of findings) {
  assert(finding.serviceIds.length > 0, `${finding.kind} claims a pattern with no services behind it`)
  assert(
    finding.serviceIds.every((id) => serviceById(id) !== undefined),
    `${finding.kind} names a service that is not in the catalog`,
  )
  assert(
    finding.title.includes(String(finding.serviceIds.length)),
    `${finding.kind} must state the count it is claiming, so the claim can be checked`,
  )
  assert(finding.capturedAt.includes('T'), `${finding.kind} must say when its evidence was read`)
}

const kinds = findings.map((f) => f.kind)
assert(kinds.includes('fleet-open-to-internet'), 'seven services share one ip filter default, which is the point of this view')
assert(kinds.includes('fleet-weak-password-encryption'), 'md5 is invisible per service and obvious across two')
assert(kinds[0] === 'fleet-open-to-internet', 'the danger sorts first')

// Each fleet finding is exactly the services whose own document carries the matching finding.
const byKind = (kind: string) => findings.find((f) => f.kind === kind)?.serviceIds ?? []
for (const [fleetKind, serviceKind] of [
  ['fleet-open-to-internet', 'open-to-internet'],
  ['fleet-weak-password-encryption', 'weak-password-encryption'],
  ['fleet-no-termination-protection', 'no-termination-protection'],
] as const) {
  const fromDocuments = catalog.services
    .map((s) => s.id)
    .filter((id) => findingsFor(id).some((f) => f.kind === serviceKind))
  assert(
    byKind(fleetKind).slice().sort().join() === fromDocuments.sort().join(),
    `${fleetKind} disagrees with the service documents about who it covers`,
  )
}

// Coverage is pessimistic on purpose: an unset field is missing, never a default.
for (const dimension of coverage.dimensions) {
  assert(dimension.have <= dimension.of, `${dimension.name} cannot cover more than exists`)
  assert(dimension.note.length > 20, `${dimension.name} must say what it is counting`)
}
const facts = coverage.dimensions.find((d) => d.name === 'Operational facts')!
assert(facts.have === serviceFacts.length, 'facts coverage is exactly the services captured')
assert(facts.have < facts.of / 2, 'most of this project has no operational evidence, and the page must not hide it')
assert(
  coverage.dimensions.find((d) => d.name === 'Described assets')?.have === catalog.assets.length,
  'every asset carries a description, which is the one dimension that is complete',
)

// The coverage figure and the policy an agent resolves must agree about who is unknown.
const unclassified = byKind('fleet-unclassified')
assert(
  unclassified.every((id) => policyFor(id).basis.includes('unclassified')),
  'a service counted as unclassified must actually resolve to the fail-closed policy',
)
assert(
  catalog.services
    .map((s) => s.id)
    .filter((id) => policyFor(id).basis.includes('unclassified'))
    .length === unclassified.length,
  'the fleet count and the policy resolution must agree, or the board is reporting a different fleet',
)

console.log(`fleet ok: ${rows.length} services, ${findings.length} fleet findings`)
for (const finding of findings) {
  console.log(`  [${finding.severity.padEnd(7)}] ${finding.title}`)
}
console.log(
  `  coverage: ${coverage.dimensions.map((d) => `${d.name.toLowerCase()} ${d.have}/${d.of}`).join(', ')}`,
)
