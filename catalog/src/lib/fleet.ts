// The view across services rather than into one.
//
// Every finding in `agent-context.ts` looks at a single service, which means the thing nobody can
// see is the pattern: seven services open to the same address range, two databases on the same
// deprecated password scheme, four services whose evidence was read a week before the rest. Each is
// invisible one page at a time and obvious in a list, and the list is what an SRE holding a fleet
// actually opens first.
//
// The second half of this file is less flattering and more useful: how much of the fleet we know
// anything about at all. Coverage is deliberately pessimistic — an unset field counts as missing,
// never as a default — because the question it answers is whether an agent should be trusted to act
// here, and "we never looked" has to rank as worse than "we looked and it was fine".
import { catalog } from '../data/catalog.ts'
import { classificationFor } from '../data/classification.ts'
import { metricsCapturedAt, operationsCapturedAt, serviceFacts } from '../data/operations.ts'
import type { Classification, Finding } from '../types.ts'
// Coverage lives with the service document rather than here: it is a property of one service that
// this page happens to add up, and the agent document needs it too.
import { contactsFor, coverageFor, findingsFor, type Coverage } from './agent-context.ts'
import { deadWorkflows, reviewCoverage } from './asset-review.ts'
import { serviceById } from './catalog.ts'

export { coverageFor }

/** A finding about the fleet, which is to say one that cannot be seen from any single service. */
export interface FleetFinding extends Omit<Finding, 'objective'> {
  /** Everything it covers, so the count is checkable rather than asserted. */
  serviceIds: string[]
}

export interface FleetRow {
  serviceId: string
  name: string
  type: string
  state: string
  environment?: Classification['environment']
  criticality?: Classification['criticality']
  findings: number
  worst?: Finding
  coverage: Coverage
  /** How many of the five coverage dimensions are present. */
  known: number
}

const severityRank = { danger: 0, caution: 1, info: 2 } as const
/**
 * Unclassified sorts with `important` rather than last. It is the same fail-closed rule the policy
 * uses: a service nobody has classified is one nobody has thought about, and guessing it is
 * unimportant is the guess that costs something.
 */
const criticalityRank = { critical: 0, important: 1, standard: 2, low: 3 } as const
const unclassifiedRank = criticalityRank.important

/**
 * Every service, worst first. The tiebreak is criticality and then finding count, because in this
 * project seven services are open to the internet and a board where everything is red first is a
 * board that has not been sorted at all.
 */
export function fleetRows(): FleetRow[] {
  return catalog.services
    .map((service) => {
      const findings = findingsFor(service.id)
      const classification = classificationFor(service.id)
      const coverage = coverageFor(service.id)
      return {
        serviceId: service.id,
        name: service.name,
        type: service.type,
        state: service.state,
        environment: classification?.environment,
        criticality: classification?.criticality,
        findings: findings.length,
        worst: findings[0],
        coverage,
        known: Object.values(coverage).filter(Boolean).length,
      }
    })
    .sort(
      (a, b) =>
        severityRank[a.worst?.severity ?? 'info'] - severityRank[b.worst?.severity ?? 'info'] ||
        (a.findings === 0 ? 1 : 0) - (b.findings === 0 ? 1 : 0) ||
        (a.criticality ? criticalityRank[a.criticality] : unclassifiedRank) -
          (b.criticality ? criticalityRank[b.criticality] : unclassifiedRank) ||
        b.findings - a.findings ||
        a.name.localeCompare(b.name),
    )
}

/** The latest moment any of these services was read, which is the age of the claim about them. */
function newestCapture(serviceIds: string[]): string {
  return serviceIds
    .map((id) => serviceFacts.find((f) => f.serviceId === id)?.capturedAt ?? operationsCapturedAt)
    .sort()
    .at(-1) as string
}

export function fleetFindings(): FleetFinding[] {
  const found: FleetFinding[] = []
  const withFacts = serviceFacts.map((f) => f.serviceId).filter((id) => serviceById(id) !== undefined)
  const name = (id: string) => serviceById(id)?.name ?? id

  const open = serviceFacts.filter((f) => f.openToInternet).map((f) => f.serviceId)
  if (open.length > 1) {
    found.push({
      kind: 'fleet-open-to-internet',
      severity: 'danger',
      title: `${open.length} of ${withFacts.length} captured services accept connections from 0.0.0.0/0`,
      detail: `${open.map(name).join(', ')}. One service open to the world is a decision; every service open to the world is a default nobody chose, and it is the kind of thing that is invisible one service page at a time.`,
      serviceIds: open,
      source: 'aiven_service_get',
      capturedAt: newestCapture(open),
    })
  }

  const md5 = serviceFacts.filter((f) => f.passwordEncryption && f.passwordEncryption !== 'scram-sha-256')
  if (md5.length) {
    found.push({
      kind: 'fleet-weak-password-encryption',
      severity: 'caution',
      title: `${md5.length} Postgres services still store passwords as md5`,
      detail: `${md5.map((f) => name(f.serviceId)).join(', ')}. scram-sha-256 has been the Postgres default since version 14 and md5 is deprecated upstream. Nobody chose this per service, which is exactly why it only shows up across a fleet.`,
      serviceIds: md5.map((f) => f.serviceId),
      source: 'aiven_service_get',
      capturedAt: newestCapture(md5.map((f) => f.serviceId)),
    })
  }

  const unprotected = serviceFacts.filter((f) => !f.terminationProtection).map((f) => f.serviceId)
  if (unprotected.length) {
    found.push({
      kind: 'fleet-no-termination-protection',
      severity: 'caution',
      title: `${unprotected.length} of ${withFacts.length} captured services can be deleted with one call`,
      detail: `${unprotected.map(name).join(', ')}. Termination protection is a flag with no restart and no cost, and it is the only thing that makes an accidental delete fail rather than succeed.`,
      serviceIds: unprotected,
      source: 'aiven_service_get',
      capturedAt: newestCapture(unprotected),
    })
  }

  // Not a security finding: a coverage one. It says how much of this project an agent is allowed to
  // reason about at all, which is the first thing to know before trusting any of the rest.
  const unknown = catalog.services.filter((s) => !coverageFor(s.id).policy).map((s) => s.id)
  if (unknown.length) {
    found.push({
      kind: 'fleet-unclassified',
      severity: 'info',
      title: `${unknown.length} of ${catalog.services.length} services have no classification and no policy`,
      detail: `Each one resolves to read-only, which is the safe answer and not a useful one: an agent asked to help with any of them can only look. Classifying a service is the cheapest way to make it actionable, and it is the gap to close before any of the rest of this is worth automating.`,
      serviceIds: unknown,
      source: 'this catalog',
      capturedAt: operationsCapturedAt,
    })
  }

  // A dead workflow is invisible on its own page — one unused table looks like a table — and
  // obvious in a list. Deliberately `info`: nothing here is broken, and the finding exists to
  // start a conversation with an owner rather than to nominate anything for deletion.
  const dead = deadWorkflows()
  if (dead.length) {
    const coverage = reviewCoverage()
    const holding = [...new Set(dead.map((row) => row.asset.serviceId))]
    const sensitive = dead.filter((row) => row.asset.tags.some((tag) => tag === 'credentials' || tag === 'agent-blocked'))
    found.push({
      kind: 'fleet-dead-workflow',
      severity: 'info',
      title: `${dead.length} datasets are named by nothing that reads them`,
      detail: `${dead
        .slice(0, 6)
        .map((row) => row.asset.name)
        .join(', ')}${dead.length > 6 ? `, and ${dead.length - 6} more` : ''}. No catalogued reader, no foreign key pointing at them, and no statement naming them in the full capture from their service.${sensitive.length ? ` ${sensitive.map((row) => row.asset.name).join(' and ')} also ${sensitive.length === 1 ? 'holds' : 'hold'} credentials, so ${sensitive.length === 1 ? 'it is' : 'they are'} a secret nothing appears to need.` : ''} This can only see ${coverage.canSee} of ${coverage.assets} assets at all, and none of it proves nobody reads them — a consumer with a connection string leaves no trace here.`,
      serviceIds: holding,
      source: 'pg_stat_statements read in full, aiven_kafka_topic_get, this catalog',
      capturedAt: newestCapture(holding),
    })
  }

  const unowned = catalog.services.filter((s) => contactsFor(s.id).length === 0).map((s) => s.id)
  if (unowned.length) {
    found.push({
      kind: 'fleet-no-contact',
      severity: 'caution',
      title: `${unowned.length} of ${catalog.services.length} services have nobody to tell`,
      detail: `No technical contact on the service, and nobody in its event log. An agent that finds a real problem on one of these has nowhere to escalate, which turns a finding into a dead end at the worst possible moment.`,
      serviceIds: unowned,
      source: 'aiven_service_get, aiven_project_get_event_logs',
      capturedAt: operationsCapturedAt,
    })
  }

  // Evidence ages at different rates across a fleet because it is gathered at different times.
  const newest = [operationsCapturedAt, metricsCapturedAt, ...serviceFacts.map((f) => f.capturedAt ?? '')]
    .filter(Boolean)
    .sort()
    .at(-1) as string
  const olderThanADay = serviceFacts.filter(
    (f) => (Date.parse(newest) - Date.parse(f.capturedAt ?? operationsCapturedAt)) / 86_400_000 > 1,
  )
  if (olderThanADay.length) {
    found.push({
      kind: 'fleet-stale-evidence',
      severity: 'info',
      title: `${olderThanADay.length} services were last read ${Math.round((Date.parse(newest) - Date.parse(olderThanADay[0].capturedAt ?? operationsCapturedAt)) / 86_400_000)} days before the newest capture here`,
      detail: `${olderThanADay.map((f) => name(f.serviceId)).join(', ')}. Their findings are still true as of when they were read, which is not the same as being true now. This is the difference between a catalog and a monitor, and it is worth stating rather than smoothing over.`,
      serviceIds: olderThanADay.map((f) => f.serviceId),
      source: 'capture timestamps in this snapshot',
      capturedAt: newest,
    })
  }

  return found.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}

/** Coverage across the project, per dimension, with the count that makes each percentage checkable. */
export function fleetCoverage(): {
  services: number
  dimensions: { name: string; have: number; of: number; note: string }[]
} {
  const services = catalog.services
  const count = (has: (id: string) => boolean) => services.filter((s) => has(s.id)).length
  return {
    services: services.length,
    dimensions: [
      {
        name: 'Operational facts',
        have: count((id) => coverageFor(id).facts),
        of: services.length,
        note: 'Plan, nodes, exposure, backups and queued maintenance, from aiven_service_get.',
      },
      {
        name: 'Metrics',
        have: count((id) => coverageFor(id).metrics),
        of: services.length,
        note: 'Disk, CPU and memory. Without these there is no headroom and no capacity finding.',
      },
      {
        name: 'Classification',
        have: count((id) => coverageFor(id).classified),
        of: services.length,
        note: 'Environment and criticality. Unclassified services fall back to read-only.',
      },
      {
        name: 'Somebody to tell',
        have: count((id) => coverageFor(id).contact),
        of: services.length,
        note: 'A technical contact, or anyone visible in the event log. Observed, never declared.',
      },
      {
        name: 'Described assets',
        have: catalog.assets.filter((a) => a.description.length > 0).length,
        of: catalog.assets.length,
        note: 'Tables, topics and applications carrying a description rather than a name alone.',
      },
    ],
  }
}
