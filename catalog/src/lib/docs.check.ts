// Every documentation link in the repo, checked against the set verified against the live site.
// Run: node --experimental-strip-types src/lib/docs.check.ts
//
// A link that 404s is worse than no link: it costs the reader a click to discover that the thing
// which was supposed to save them a search has sent them on one. These URLs were each requested
// and returned 200 on 2026-09-15. Anything added later has to be checked the same way and added
// here, which is the whole point of the assertion — it fails on a plausible-looking guess.
import assert from 'node:assert/strict'
import { runbooks } from '../data/agent.ts'
import { deviations } from '../data/deviations.ts'
import { catalog } from '../data/catalog.ts'
import { findingsFor, lifecycleFor, serviceContext, updateImpact } from './agent-context.ts'
import { deviationsFor } from '../data/deviations.ts'

const verified = new Set([
  'https://aiven.io/docs/platform/howto/restrict-access',
  'https://aiven.io/docs/platform/concepts/maintenance-window',
  'https://aiven.io/docs/platform/howto/scale-services',
  'https://aiven.io/docs/platform/concepts/service-power-cycle',
  'https://aiven.io/docs/platform/concepts/dynamic-disk-sizing',
  'https://aiven.io/docs/platform/concepts/enhanced-compliance-env',
  'https://aiven.io/docs/platform/howto/console-fork-service',
  'https://aiven.io/docs/products/postgresql/reference/list-of-extensions',
  'https://aiven.io/docs/products/postgresql/howto/manage-extensions',
  'https://aiven.io/docs/products/postgresql/reference/pg-connection-limits',
  'https://aiven.io/docs/products/postgresql/concepts/high-availability',
  'https://aiven.io/docs/products/postgresql/concepts/pg-connection-pooling',
  'https://aiven.io/docs/products/postgresql/concepts/aiven-db-migrate',
  'https://aiven.io/docs/products/kafka/concepts/horizontal-vertical-scaling',
  'https://aiven.io/docs/products/kafka/howto/create-topic',
  'https://aiven.io/docs/products/kafka/karapace/concepts/schema-registry-authorization',
  'https://aiven.io/docs/tools/api',
])

const used = new Map<string, string>()
for (const deviation of deviations) if (deviation.docUrl) used.set(deviation.docUrl, `deviation ${deviation.id}`)
for (const runbook of runbooks) if (runbook.docUrl) used.set(runbook.docUrl, `runbook ${runbook.forFinding}`)
for (const service of catalog.services) {
  for (const finding of findingsFor(service.id)) {
    if (finding.docUrl) used.set(finding.docUrl, `finding ${finding.kind}`)
  }
}

for (const [url, where] of used) {
  assert.ok(verified.has(url), `${where} links to ${url}, which is not in the verified set`)
}

// Every finding an operator can actually meet has somewhere to read about it. Checked against the
// findings this project produces rather than against the list of kinds, so a finding added without
// a link fails here instead of quietly shipping as a dead end.
for (const service of catalog.services) {
  for (const finding of findingsFor(service.id)) {
    assert.ok(finding.docUrl, `${finding.kind} on ${service.id} has nothing to read`)
  }
}

// A runbook citing a deviation that does not exist would render as nothing at all, which is the
// failure mode of every id-based reference.
for (const runbook of runbooks) {
  for (const id of runbook.deviations ?? []) {
    assert.ok(
      deviations.some((deviation) => deviation.id === id),
      `runbook "${runbook.title}" cites unknown deviation ${id}`,
    )
  }
}

// Internal deviations carry no link by definition: there is no public page for something Aiven
// does not publish, and inventing one would be the worst possible way to fail this check.
for (const deviation of deviations.filter((d) => d.internal)) {
  assert.equal(deviation.docUrl, undefined, `${deviation.id} is internal and must not link to public documentation`)
}

// Internal facts stay inside. This is the one assertion here that is about disclosure rather than
// tidiness: the emitted documents are fetched by agents and end up pasted into places nobody is
// tracking, so a fact Aiven has not published must not be in them. The UI shows it; the files do not.
const internal = deviations.filter((deviation) => deviation.internal)
assert.ok(internal.length, 'there is at least one internal deviation, or this check proves nothing')
for (const service of catalog.services) {
  const emitted = serviceContext(service.id)?.deviations ?? deviationsFor(service.type)
  for (const deviation of emitted) {
    assert.ok(!deviation.internal, `${service.id} would emit internal deviation ${deviation.id}`)
  }
}
// And the operator does see them, which is the other half of the requirement.
assert.ok(
  deviationsFor('pg', true).some((deviation) => deviation.internal),
  'the interface asks for internal deviations and must get them',
)

// Service state is a dated fact with an explanation, not a badge. A newcomer cannot tell whether
// REBUILDING needs action, and neither can an agent.
const lifecycle = lifecycleFor('pg-37c7de3b')
assert.equal(lifecycle.state, 'RUNNING')
assert.ok(lifecycle.stateReadAt, 'with the time it was read')
assert.ok(lifecycle.stateMeans.includes('Serving traffic'))
assert.equal(lifecycle.maintenanceWindow, 'friday at 20:29:11 UTC')
assert.ok(lifecycle.note.includes('Nothing is queued'), 'an empty queue is a reading, not a promise')
assert.ok(
  lifecycleFor('os-ddec4cf-dhtest').stateMeans.includes('not free'),
  'a powered-off service still costs money, which is the thing people get wrong about POWEROFF',
)
assert.ok(lifecycleFor('dashboard-web').note.includes('No facts were captured'), 'and an uncaptured service says so')

// Five updates are genuinely queued, three of them with deadlines Aiven will act on whether or not
// it suits anybody. This is the real path, and the part the console does not answer is the impact.
const queued = catalog.services.flatMap((service) => lifecycleFor(service.id).updates)
assert.equal(queued.length, 5)
assert.ok(
  queued.every((update) => update.impact && update.takes && update.deadlineNote),
  'every queued update states what it costs, how long it takes, and when it stops being optional',
)
const clickhouse = lifecycleFor('clickhouse-2a6274d2').updates
assert.equal(clickhouse.length, 3)
assert.ok(
  clickhouse.find((update) => update.description.includes('26.3'))!.impact.includes('cannot be rolled back'),
  'a version upgrade on one node is an outage and a one-way door, and both halves have to be said',
)
assert.ok(clickhouse.every((update) => update.deadlineNote.startsWith('Mandatory after')))
assert.ok(
  lifecycleFor('marmot-pg').updates[0].deadlineNote.includes('still yours to choose'),
  'no deadline set is a different sentence from an unknown deadline',
)

// And the branches the real queue does not reach, checked directly on both node counts, because
// the difference between a rolling restart and an outage is the entire point of stating it.
assert.ok(updateImpact('PostgreSQL 16.2 minor version upgrade', 1).impact.includes('downtime'))
assert.ok(updateImpact('PostgreSQL 16.2 minor version upgrade', 1).impact.includes('cannot be rolled back'))
assert.ok(updateImpact('PostgreSQL 16.2 minor version upgrade', 3).impact.includes('Rolling across nodes'))
assert.ok(updateImpact('security patch for the base image', 1).impact.includes('short outage'))
assert.ok(updateImpact('security patch for the base image', 3).impact.includes('one at a time'))
assert.ok(updateImpact('something nobody has seen before', 1).impact.includes('Treat as downtime'))
assert.ok(
  updateImpact('something nobody has seen before', 3).impact.includes('Confirm with support'),
  'an unrecognised update on a multi-node service is a guess and says so',
)
assert.ok(
  !queued.some((update) => update.impact.includes('Confirm with support') && update.description.includes('version')),
  'a recognised update never falls through to the unrecognised wording',
)

console.log(
  `docs: ok (${used.size} distinct links, all verified; ${deviations.length} deviations, ${internal.length} internal and withheld)`,
)
