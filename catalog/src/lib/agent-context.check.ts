// Run with: node --experimental-strip-types src/lib/agent-context.check.ts
//
// The smallest set of assertions that fail if the context document starts lying: the headroom
// arithmetic, the freshness that decides whether headroom may be acted on, the fail-closed policy
// default, and the runbook wiring. If a finding can appear with no play attached, or a policy can
// default to permissive, that is the bug worth catching here rather than on stage.
import { agentPolicies, runbooks } from '../data/agent.ts'
import { classificationFor, classifications } from '../data/classification.ts'
import { objectiveFor, objectives } from '../data/objectives.ts'
import { metricReadings, metricsCapturedAt, operationsCapturedAt } from '../data/operations.ts'
import {
  capabilitiesFor,
  contactsFor,
  coveredServices,
  diskTrend,
  documentedServices,
  findingsFor,
  freezeActive,
  planOptions,
  policyFor,
  serviceContext,
  stalenessHours,
} from './agent-context.ts'
import { serviceById } from './catalog.ts'

function assert(ok: boolean, what: string): void {
  if (!ok) throw new Error(`agent-context: ${what}`)
}

function close(actual: number, expected: number, tolerance: number, what: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${what} was ${actual}, expected about ${expected}`)
}

const disk = (serviceId: string) => {
  const reading = metricReadings.find((r) => r.serviceId === serviceId && r.metric === 'disk_usage')
  assert(reading !== undefined, `no disk reading for ${serviceId}`)
  return reading!
}

// Headroom, against numbers worked out by hand from the captured window.
// crm-pg: 6.585 − 1.736 = 4.849 points over 3 days, so 1.616 a day, and (100 − 6.585) / 1.616 days left.
const crm = diskTrend(disk('crm-pg'))
close(crm.windowDays, 3, 0.01, 'crm-pg window length')
close(crm.perDay, 1.6163, 0.001, 'crm-pg growth a day')
close(crm.daysToFull ?? 0, 57.8, 0.5, 'crm-pg days to full')
assert(crm.includesInitialLoad, 'crm-pg window opens at creation, so the caveat must be set')

// pg-37c7de3b: 0.194 points over 7 days is thousands of days away, and it predates the purpose log,
// so nothing claims its window starts at creation.
const webshop = diskTrend(disk('pg-37c7de3b'))
close(webshop.perDay, 0.0277, 0.001, 'pg-37c7de3b growth a day')
close(webshop.daysToFull ?? 0, 3275, 5, 'pg-37c7de3b days to full')
assert(!webshop.includesInitialLoad, 'pg-37c7de3b has no creation entry, so the caveat must be clear')

// A reading with no growth must say so rather than report an infinite runway as a number.
assert(
  diskTrend({ ...disk('pg-37c7de3b'), min: 9.245, latest: 9.245 }).daysToFull === undefined,
  'flat disk must leave days-to-full absent',
)

// Freshness: crm-pg's window ends 26 hours before the capture, everyone else's ends with it.
close(stalenessHours(disk('crm-pg')), 26.17, 0.05, 'crm-pg staleness')
close(stalenessHours(disk('pg-37c7de3b')), 0, 0.01, 'pg-37c7de3b staleness')
assert(
  findingsFor('crm-pg').some((f) => f.kind === 'stale-context'),
  'crm-pg must be flagged as stale, since its capacity finding rests on old evidence',
)
assert(
  !findingsFor('pg-37c7de3b').some((f) => f.kind === 'stale-context'),
  'pg-37c7de3b is current and must not be flagged stale',
)

// Findings fire where the evidence is, and nowhere else.
const crmFindings = findingsFor('crm-pg')
assert(crmFindings.some((f) => f.kind === 'disk-filling'), 'crm-pg disk is filling and must be flagged')
assert(
  crmFindings.find((f) => f.kind === 'disk-filling')?.severity === 'caution',
  'at ~58 days the disk finding is caution, not danger',
)
assert(
  crmFindings.find((f) => f.kind === 'disk-filling')?.detail.includes('initial load'),
  'the disk finding must carry its own caveat, or it overstates the rate',
)
assert(
  !findingsFor('pg-37c7de3b').some((f) => f.kind === 'disk-filling'),
  'pg-37c7de3b has thousands of days of headroom and must not be flagged',
)
assert(
  findingsFor('clickhouse-2a6274d2').some((f) => f.kind === 'pending-maintenance'),
  'clickhouse has queued updates with deadlines and must be flagged',
)
assert(
  findingsFor('kafka-1b5cb1e7').every((f) => f.kind !== 'single-node'),
  'kafka has three nodes, so the single-node finding must not fire',
)

// Objectives: every number a finding fires on is declared, and the one in force is the one quoted.
assert(objectiveFor('disk-headroom', 'kafka')?.target === 45, 'kafka overrides the fleet disk objective')
assert(objectiveFor('disk-headroom', 'pg')?.target === 90, 'pg takes the fleet default')
assert(objectiveFor('disk-headroom', undefined)?.appliesTo.includes('*'), 'an unknown type falls back to the default')
for (const objective of objectives) {
  assert(objective.rationale.length > 60, `${objective.id} must say why this number and not another`)
  assert(objective.owner.length > 0, `${objective.id} needs an owner`)
  assert(objective.reviewed.length === 10, `${objective.id} needs a review date, or it decays into a constant`)
}
for (const serviceId of coveredServices()) {
  const type = serviceById(serviceId)?.type
  for (const finding of findingsFor(serviceId)) {
    if (finding.objective === undefined) continue
    const objective = objectiveFor(finding.objective, type)
    assert(objective !== undefined, `${finding.kind} cites ${finding.objective}, which nobody declared`)
    assert(
      finding.detail.includes(String(objective!.target)),
      `${finding.kind} must quote the target it was measured against, so the threshold can be argued with`,
    )
  }
}
assert(
  findingsFor('crm-pg').find((f) => f.kind === 'disk-filling')?.objective === 'disk-headroom',
  'the disk finding must name the objective it breached rather than a number in the code',
)

// The stopped test cluster. A finding has to still be true on a service that is switched off.
const stopped = findingsFor('os-ddec4cf-dhtest')
assert(stopped.some((f) => f.kind === 'powered-off'), 'a service stopped for a month must be reported')
assert(
  stopped.find((f) => f.kind === 'open-to-internet')?.severity === 'caution',
  'an open filter on a stopped service is dormant, and calling it a live danger is a false claim',
)
assert(!stopped.some((f) => f.kind === 'single-node'), 'a stopped service cannot suffer a restart outage')
assert(!stopped.some((f) => f.kind === 'backup-stale'), 'a stopped service has nothing to back up, so the gap is expected')
assert(
  findingsFor('pg-37c7de3b').find((f) => f.kind === 'open-to-internet')?.severity === 'danger',
  'a running service open to the world is still a danger',
)

// A setting that is invisible on one service and obvious across a fleet.
for (const id of ['marmot-pg', 'trino-hub-pg']) {
  assert(
    findingsFor(id).some((f) => f.kind === 'weak-password-encryption'),
    `${id} stores passwords as md5 and must say so`,
  )
}

// The second capture carries its own timestamp rather than borrowing the first one's freshness.
assert(
  findingsFor('marmot-pg').every((f) => f.source !== 'aiven_service_get' || f.capturedAt === '2026-09-15T08:20:00Z'),
  'facts read on the 15th must not claim the file-level capture time',
)
assert(
  findingsFor('pg-37c7de3b').every((f) => f.source !== 'aiven_service_get' || f.capturedAt === operationsCapturedAt),
  'the original captures keep their own, older timestamp',
)

// Capabilities come from what was captured, and say nothing where nothing was captured.
assert(capabilitiesFor('crm-pg')?.maxConnections === 25, 'the connection limit is a captured fact')
assert(capabilitiesFor('kafka-1b5cb1e7')?.failoverAvailable === true, 'three brokers can fail over')
assert(capabilitiesFor('crm-pg')?.failoverAvailable === false, 'one node cannot')
assert(capabilitiesFor('crm-pg')?.canAddDisk === false, 'hobbyist cannot buy disk on its own')
assert(
  capabilitiesFor('kafka-1b5cb1e7')?.canAddDisk === undefined,
  'no kafka rung was priced, and not knowing must not be reported as no',
)
assert(capabilitiesFor('analytics-agent-pg') === undefined, 'a service with no facts claims no capabilities')
// Worst first, so a reader who stops after one line has read the right one.
for (const serviceId of coveredServices()) {
  const severities = findingsFor(serviceId).map((f) => ({ danger: 0, caution: 1, info: 2 })[f.severity])
  assert(
    severities.every((s, i) => i === 0 || severities[i - 1] <= s),
    `${serviceId} findings must be ordered worst first`,
  )
}

// Every finding an agent might act on has a play attached. Advice with no play is just an opinion.
for (const serviceId of coveredServices()) {
  for (const finding of serviceContext(serviceId)?.findings ?? []) {
    if (finding.severity === 'info') continue
    assert(finding.runbook !== undefined, `${finding.kind} has no runbook`)
    assert(finding.runbook!.verify.length > 20, `${finding.kind} runbook must say how to verify the fix`)
    assert(finding.runbook!.rollback.length > 10, `${finding.kind} runbook must state rollback, even if it is "none"`)
  }
}

// A typo in `forFinding` would silently detach a play from its finding, so the kinds are pinned.
const kinds = [
  'stale-context',
  'disk-filling',
  'cpu-spikes',
  'open-to-internet',
  'single-node',
  'no-termination-protection',
  'pending-maintenance',
  'connector-down',
  'lag-against-retention',
  'weak-password-encryption',
  'powered-off',
  'backup-stale',
]
for (const book of runbooks) {
  assert(kinds.includes(book.forFinding), `runbook "${book.title}" points at unknown finding ${book.forFinding}`)
}
// The plays for trouble nobody has yet are the point of writing plays in advance.
for (const kind of ['connector-down', 'lag-against-retention', 'backup-stale']) {
  assert(
    runbooks.some((r) => r.forFinding === kind),
    `${kind} needs a runbook before the incident, not during it`,
  )
  assert(
    coveredServices().every((id) => !findingsFor(id).some((f) => f.kind === kind)),
    `${kind} is not currently firing, so the snapshot should not claim it is`,
  )
}

// Policy fails closed: a service nobody has classified or written a policy for allows only reading.
const unwritten = policyFor('analytics-agent-pg')
assert(
  !agentPolicies.some((p) => p.serviceId === 'analytics-agent-pg') && classificationFor('analytics-agent-pg') === undefined,
  'analytics-agent-pg is the unclassified, unwritten case this checks',
)
assert(unwritten.needsApproval.length === 0, 'an unwritten policy must not offer an approval path')
assert(unwritten.forbidden.includes('everything else'), 'an unwritten policy must forbid everything else')
assert(unwritten.allowed.join() === 'read metadata', 'an unwritten policy must allow reading only')
assert(unwritten.basis.includes('unclassified'), 'the document must say the policy came from nobody having decided')

// Classification is what decides the rest, so the three routes into a policy are pinned apart.
assert(
  policyFor('pg-37c7de3b').basis.startsWith('written for this service'),
  'a hand-written policy must override criticality and say that it did',
)
assert(policyFor('marmot-pg').basis.includes('standard'), 'marmot-pg has no written policy, so it derives from standard')
assert(
  policyFor('marmot-pg').allowed.includes('apply pending maintenance'),
  'standard services apply their own maintenance, since Aiven applies it at the deadline anyway',
)
assert(
  !policyFor('marmot-pg').allowed.includes('restart'),
  'standard is not permission to restart unattended',
)
// The whole point of classifying: the same operation sits in different columns as the cost rises.
assert(
  policyFor('os-ddec4cf-dhtest').allowed.includes('restart'),
  'a corroborated test service may be restarted unattended, or the classification changes nothing',
)
assert(
  policyFor('os-ddec4cf-dhtest').needsApproval.includes('delete the service'),
  'deletion waits for a human even at low criticality, because the classification is inferred',
)
for (const criticality of ['critical', 'important', 'standard'] as const) {
  const service = classifications.find((c) => c.criticality === criticality)
  if (!service) continue
  assert(
    !policyFor(service.serviceId).allowed.includes('restart'),
    `${criticality} must not allow an unattended restart`,
  )
}
for (const entry of classifications) {
  assert(entry.provenance === 'inferred', 'nothing in this project declares an environment, so nothing may claim to')
  assert(entry.evidence.length > 60, `${entry.serviceId} must say what its classification rests on`)
}
assert(
  classificationFor('os-ddec4cf-dhtest')?.evidence.includes('powered off'),
  'a name alone must never classify a service: the test cluster needs its corroborating evidence',
)

for (const policy of agentPolicies) {
  assert(policy.because.length > 40, `${policy.serviceId} policy must say why, not just what`)
  const overlap = policy.allowed.filter((a) => policy.forbidden.includes(a) || policy.needsApproval.includes(a))
  assert(!overlap.length, `${policy.serviceId} lists ${overlap.join(', ')} as both allowed and not`)
}

// The freeze outranks the findings, and it covers the moment the evidence was captured.
assert(freezeActive(), 'the summit freeze must be active at capture time')
assert(!freezeActive('2026-10-01T00:00:00Z'), 'the freeze must not be permanent')
assert(serviceContext('crm-pg')?.freeze.active === true, 'the document must carry the freeze, not just the findings')

// Cost: the fix for crm-pg is a plan change, and the document knows what it costs.
const crmPlan = planOptions('crm-pg')
assert(crmPlan.current?.plan === 'hobbyist', 'crm-pg runs on hobbyist, matched by price')
assert(crmPlan.options.length === 1 && crmPlan.options[0].plan === 'startup-4', 'startup-4 is the rung above')
close(crmPlan.options[0].extraUsdPerHour, 0.117, 0.0001, 'crm-pg upgrade cost an hour')
close(crmPlan.options[0].extraUsdPerMonth, 85.41, 0.01, 'crm-pg upgrade cost a month')
assert(crmPlan.options[0].canAddDisk, 'startup-4 can buy disk later, which is why it is the rung to pick')
assert(crmPlan.note.includes('cannot buy disk'), 'the note must explain why hobbyist forces a plan change')
assert(planOptions('pg-37c7de3b').current?.plan === 'startup-4', 'pg-37c7de3b runs on startup-4, matched by price')
assert(
  planOptions('kafka-1b5cb1e7').note.includes('cannot state its cost'),
  'no kafka prices were captured, and the document must admit that rather than guess',
)

// Contacts are observed, and platform actors are not people to page.
const contacts = contactsFor('pg-37c7de3b')
assert(contacts.some((c) => c.email === 'stan.dmitriev@aiven.io'), 'the technical contact must appear')
for (const serviceId of coveredServices()) {
  for (const contact of contactsFor(serviceId)) {
    assert(contact.email.includes('@'), `${contact.email} is not an address`)
    assert(!contact.email.startsWith('Aiven'), 'Aiven Automation is not somebody to page')
  }
}
// Under Node the edit store is empty, so no service has a declared owner here and the sentence
// has to say so rather than presenting the observed contacts as the answer.
assert(
  serviceContext('crm-pg')?.owners.length === 0 &&
    serviceContext('crm-pg')?.ownership.includes('observed rather than responsible'),
  'the document must not pass observed contacts off as declared ownership',
)

// Nothing here reads the clock, so the document is stable and the emitted JSON stays diffable.
assert(
  JSON.stringify(serviceContext('crm-pg')) === JSON.stringify(serviceContext('crm-pg')),
  'the document must be deterministic',
)
assert(
  serviceContext('crm-pg')?.captured.metrics === metricsCapturedAt,
  'every document states the capture it rests on',
)
assert(serviceContext('nonexistent-service') === undefined, 'an unknown service has no document')
assert(coveredServices().length === 8, `expected 8 covered services, got ${coveredServices().length}`)

// The panel offers a JSON link on every service page, so every service needs a document behind it.
assert(
  documentedServices().every((id) => serviceContext(id) !== undefined),
  'every documented service must produce a document, or its JSON link is a 404',
)
assert(
  coveredServices().every((id) => documentedServices().includes(id)),
  'a service with evidence must also be documented',
)
assert(
  documentedServices().length > coveredServices().length,
  'most services have no operational evidence, and their documents are the fail-closed case',
)

console.log(`agent-context ok: ${coveredServices().length} services, ${runbooks.length} runbooks`)
for (const serviceId of coveredServices()) {
  const doc = serviceContext(serviceId)!
  const worst = doc.findings[0]
  console.log(
    `  ${serviceId.padEnd(22)} ${String(doc.findings.length).padStart(2)} findings` +
      `${worst ? `, worst: ${worst.severity} ${worst.kind}` : ''}`,
  )
}
