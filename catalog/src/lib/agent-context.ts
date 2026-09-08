// One document per service, holding everything needed to decide whether to act on it: what was
// measured, how old the measurement is, what it implies, who to tell, what an agent may do, what
// the fix costs, and the play for each finding. The UI panel and the emitted JSON both read this,
// so a human and an agent are looking at the same facts rather than two drifting versions.
//
// Nothing here reads the clock. Every age is measured against the capture timestamp of the source
// it came from, which keeps the document deterministic — the emitted JSON is diffable, and a
// finding does not change meaning because a demo ran on a Tuesday.
//
// Imports are relative, as in lib/operations.ts, so this runs under plain node for the check and
// the emitter.
import { agentPolicies, changeFreeze, defaultPolicy, runbooks } from '../data/agent.ts'
import { catalog } from '../data/catalog.ts'
import { contextLog, contextLogCapturedAt } from '../data/context-log.ts'
import {
  connectorStatuses,
  connectorsCapturedAt,
  metricReadings,
  metricsCapturedAt,
  operationsCapturedAt,
  planLadder,
  serviceEvents,
  serviceFacts,
  topicHealth,
} from '../data/operations.ts'
import type { AgentPolicy, Finding, MetricReading, PlanRung, Runbook } from '../types.ts'
import { assetsForService, blastRadius, serviceById } from './catalog.ts'
import { lagOf } from './operations.ts'

const HOUR = 3_600_000
const DAY = 86_400_000

/** A reading is treated as stale once it is a day behind the capture it arrived in. */
const STALE_HOURS = 24
/** Below this many days of disk headroom, somebody should be planning. Below a third of it, acting. */
const HEADROOM_DAYS = 90

export interface DiskTrend {
  /** Percentage points a day, over the window the reading covers. */
  perDay: number
  windowDays: number
  /** Absent when the reading shows no growth, which is a fact rather than a missing value. */
  daysToFull?: number
  /** True when the window opens at service creation, so the initial data load inflates the rate. */
  includesInitialLoad: boolean
}

export interface Contact {
  email: string
  why: string
}

export interface PlanOption {
  plan: string
  usdPerHour: number
  diskGb: number
  extraUsdPerHour: number
  extraUsdPerMonth: number
  /** True when this rung can buy disk without another plan change later. */
  canAddDisk: boolean
}

export interface ServiceContext {
  serviceId: string
  name: string
  type: string
  /** Per source, because they were captured at different times and the differences matter. */
  captured: Record<string, string>
  policy: AgentPolicy
  freeze: { active: boolean; from: string; to: string; reason: string }
  contacts: Contact[]
  ownership: string
  findings: (Finding & { runbook?: Runbook })[]
  readings: (MetricReading & { staleHours: number; trend?: DiskTrend })[]
  dependents: ReturnType<typeof blastRadius>
  plan: { current?: PlanRung; options: PlanOption[]; note: string }
}

/**
 * Growth taken as `latest − min` across the window, then extrapolated flat to 100%.
 *
 * ponytail: a naive heuristic with two known ceilings. It assumes the low point came first, so a
 * vacuum or a compaction mid-window hides real growth, and it assumes today's rate holds. Upgrade
 * path when it needs to be trusted rather than glanced at: pull the per-point series with
 * `aiven_service_metrics_fetch` `metrics: ['disk_usage']` and fit a line through it.
 */
export function diskTrend(reading: MetricReading): DiskTrend {
  const windowDays = (Date.parse(reading.to) - Date.parse(reading.from)) / DAY
  const perDay = Math.max(0, reading.latest - reading.min) / windowDays
  const created = createdAt(reading.serviceId)
  return {
    perDay,
    windowDays,
    daysToFull: perDay > 0 ? (100 - reading.latest) / perDay : undefined,
    // A window that opens within an hour of the service being created starts at an empty disk, so
    // the first day of "growth" is really the initial load.
    includesInitialLoad:
      created !== undefined && Math.abs(Date.parse(reading.from) - Date.parse(created)) < HOUR,
  }
}

/** How far a reading's window ends before the capture it arrived in, in hours. */
export function stalenessHours(reading: MetricReading): number {
  return (Date.parse(metricsCapturedAt) - Date.parse(reading.to)) / HOUR
}

/** When the purpose log says this service was created, for services born inside the log. */
export function createdAt(serviceId: string): string | undefined {
  return contextLog
    .filter((c) => c.serviceId === serviceId && c.operation === 'create' && c.status === 'ok')
    .map((c) => c.createdAt)
    .sort()[0]
}

/** The written policy, or read-only. Unlisted means nobody has decided yet, so nothing is allowed. */
export function policyFor(serviceId: string): AgentPolicy {
  return agentPolicies.find((p) => p.serviceId === serviceId) ?? { serviceId, ...defaultPolicy }
}

export function runbookFor(kind: string): Runbook | undefined {
  return runbooks.find((r) => r.forFinding === kind)
}

/** Whether the freeze covers the moment the evidence was captured. */
export function freezeActive(at: string = metricsCapturedAt): boolean {
  return Date.parse(at) >= Date.parse(changeFreeze.from) && Date.parse(at) <= Date.parse(changeFreeze.to)
}

/**
 * Who to tell, from what can be observed rather than declared: the technical contacts Aiven holds,
 * and the people the event log shows actually changing this service.
 */
export function contactsFor(serviceId: string): Contact[] {
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const found = new Map<string, string>()

  for (const email of facts?.techEmails ?? []) {
    found.set(email, 'Technical contact on the service')
  }

  const changes = new Map<string, number>()
  for (const event of serviceEvents) {
    if (event.serviceId !== serviceId || !event.actor.includes('@')) continue
    changes.set(event.actor, (changes.get(event.actor) ?? 0) + 1)
  }
  for (const [email, count] of [...changes].sort((a, b) => b[1] - a[1])) {
    const change = `changed it ${count} ${count === 1 ? 'time' : 'times'} in the event log`
    found.set(email, found.has(email) ? `${found.get(email)}, and ${change}` : `Last touched it: ${change}`)
  }

  return [...found].map(([email, why]) => ({ email, why }))
}

/**
 * Why a cost is or is not on offer. Each way of not knowing gets its own sentence: "no prices were
 * captured" and "we could not tell which plan this is" are different problems to go and fix.
 */
function planNote(
  rungs: PlanRung[],
  current: PlanRung | undefined,
  hasFacts: boolean,
  serviceType: string | undefined,
): string {
  if (!rungs.length) {
    return `No plan prices were captured for ${serviceType ?? 'this service type'}, so a fix here cannot state its cost yet.`
  }
  if (!hasFacts) return 'No service facts were captured here, so there is no plan to price a fix against.'
  if (!current) return 'The current plan could not be matched to a captured price, so the cost of moving is unknown.'
  if (current.extraDiskUsdPerGbHour !== undefined) {
    return `On ${current.plan}, disk can be bought without changing plan at $${current.extraDiskUsdPerGbHour.toFixed(6)} per GB per hour.`
  }
  return `${current.plan} cannot buy disk on its own, so more space means the next plan up and the restart that comes with it.`
}

/** The rungs above the current one, priced. Only covers service types the ladder was captured for. */
export function planOptions(serviceId: string): ServiceContext['plan'] {
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const service = serviceById(serviceId)
  const rungs = planLadder.filter((r) => r.serviceType === service?.type)
  const current = rungs.find((r) => r.usdPerHour === facts?.planPriceUsdPerHour)

  const options = rungs
    .filter((r) => current !== undefined && r.usdPerHour > current.usdPerHour)
    .map((r) => ({
      plan: r.plan,
      usdPerHour: r.usdPerHour,
      diskGb: r.diskGb,
      extraUsdPerHour: Number((r.usdPerHour - (current?.usdPerHour ?? 0)).toFixed(4)),
      // 730 hours is the month Aiven bills by, not a calendar month.
      extraUsdPerMonth: Number(((r.usdPerHour - (current?.usdPerHour ?? 0)) * 730).toFixed(2)),
      canAddDisk: r.extraDiskUsdPerGbHour !== undefined,
    }))

  return {
    current,
    options,
    note: planNote(rungs, current, facts !== undefined, service?.type),
  }
}

/**
 * What is true about this service right now that changes what should happen next, worst first.
 * Every finding names its source and the moment that source was read, because a finding is worth
 * exactly as much as the freshness of the thing behind it.
 */
export function findingsFor(serviceId: string): Finding[] {
  const found: Finding[] = []
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const readings = metricReadings.filter((r) => r.serviceId === serviceId)

  // One finding for the service, not one per reading: the readings go stale together, because it is
  // the collection that fell behind rather than any single metric.
  const stale = readings.filter((r) => stalenessHours(r) > STALE_HOURS)
  if (stale.length) {
    const oldest = stale.reduce((a, b) => (stalenessHours(a) > stalenessHours(b) ? a : b))
    found.push({
      kind: 'stale-context',
      severity: 'caution',
      title: `Metrics are ${Math.round(stalenessHours(oldest))} hours behind the rest of this snapshot`,
      detail: `${stale.map((r) => r.metric.replace('_', ' ')).join(', ')} all end at ${oldest.to.replace('T', ' ').slice(0, 16)} UTC and cover ${Math.round(diskTrend(oldest).windowDays)} days rather than the usual seven. Anything derived from them is an estimate on old evidence, so re-read before acting.`,
      source: 'aiven_service_metrics_fetch',
      capturedAt: metricsCapturedAt,
    })
  }

  for (const reading of readings) {
    if (reading.metric === 'disk_usage') {
      const trend = diskTrend(reading)
      if (trend.daysToFull !== undefined && trend.daysToFull < HEADROOM_DAYS) {
        found.push({
          kind: 'disk-filling',
          severity: trend.daysToFull < HEADROOM_DAYS / 3 ? 'danger' : 'caution',
          title: `Disk is filling: about ${Math.round(trend.daysToFull)} days left at this rate`,
          detail: `${reading.series} is at ${reading.latest.toFixed(1)}%, up from ${reading.min.toFixed(1)}% across a ${Math.round(trend.windowDays)}-day window, or ${trend.perDay.toFixed(2)} points a day.${trend.includesInitialLoad ? ' The window opens when the service was created, so the initial load is inside that rate and the real figure is longer. Re-measure over a settled week before acting.' : ''}`,
          source: 'aiven_service_metrics_fetch',
          capturedAt: metricsCapturedAt,
        })
      }
    }

    // A high maximum with a low average is a query, not a trend. Worth saying out loud, so that
    // nobody — human or agent — resizes a service because of one spike.
    if (reading.metric === 'cpu_usage' && reading.max > 50 && reading.avg < 20) {
      found.push({
        kind: 'cpu-spikes',
        severity: 'info',
        title: 'CPU spikes on an otherwise idle service',
        detail: `${reading.max.toFixed(0)}% peak against a ${reading.avg.toFixed(0)}% average. That is work arriving in bursts, not a service running out of headroom, and it is not a reason to change the plan.`,
        source: 'aiven_service_metrics_fetch',
        capturedAt: metricsCapturedAt,
      })
    }
  }

  if (facts?.openToInternet) {
    found.push({
      kind: 'open-to-internet',
      severity: 'danger',
      title: 'Reachable from 0.0.0.0/0',
      detail: 'The ip filter allows every address, so the only thing between this service and the internet is its password.',
      source: 'aiven_service_get',
      capturedAt: operationsCapturedAt,
    })
  }

  if (facts?.nodeCount === 1) {
    found.push({
      kind: 'single-node',
      severity: 'caution',
      title: 'One node, so a restart is an outage',
      detail: 'There is nothing to fail over to. Every restart, plan change and platform update is downtime that has to be timed rather than absorbed.',
      source: 'aiven_service_get',
      capturedAt: operationsCapturedAt,
    })
  }

  if (facts && !facts.terminationProtection) {
    found.push({
      kind: 'no-termination-protection',
      severity: 'info',
      title: 'Termination protection is off',
      detail: 'Nothing stands between a deletion call and this service, which is a cheap gap to close.',
      source: 'aiven_service_get',
      capturedAt: operationsCapturedAt,
    })
  }

  if (facts?.pendingUpdates.length) {
    const soonest = [...facts.pendingUpdates].sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
    found.push({
      kind: 'pending-maintenance',
      severity: 'caution',
      title: `${facts.pendingUpdates.length} platform ${facts.pendingUpdates.length === 1 ? 'update' : 'updates'} queued, the first due ${soonest.deadline.slice(0, 10)}`,
      detail: `After each deadline Aiven applies the update itself. On a single node that is downtime at a time nobody chose. Earliest: ${soonest.description}`,
      source: 'aiven_service_get',
      capturedAt: operationsCapturedAt,
    })
  }

  for (const connector of connectorStatuses.filter((c) => c.serviceId === serviceId)) {
    if (connector.state === 'RUNNING' && connector.tasksRunning === connector.tasksTotal) continue
    found.push({
      kind: 'connector-down',
      severity: 'danger',
      title: `Connector ${connector.connector} is ${connector.state}`,
      detail: `${connector.tasksRunning} of ${connector.tasksTotal} tasks running.${connector.trace ? ` Trace: ${connector.trace}` : ''} Change data capture has stopped, and the topics look healthy from the outside until retention starts dropping records nobody read.`,
      source: 'aiven_kafka_connect_get_connector_status',
      capturedAt: connectorsCapturedAt,
    })
  }

  // Lag only matters against what the topic still keeps: a consumer halfway through the retained
  // window is one slow afternoon from losing records for good.
  for (const asset of assetsForService(serviceId)) {
    const health = topicHealth.find((h) => h.assetId === asset.id)
    if (!health) continue
    const { lag, retained } = lagOf(health)
    if (!retained || lag / retained < 0.5) continue
    found.push({
      kind: 'lag-against-retention',
      severity: lag / retained > 0.8 ? 'danger' : 'caution',
      title: `${health.consumerGroup} is ${Math.round((lag / retained) * 100)}% of the way through what ${asset.name} still keeps`,
      detail: `${lag.toLocaleString()} records behind, with ${retained.toLocaleString()} retained and ${health.retentionHours} hours of retention. When lag passes retention the records are gone, not delayed.`,
      source: 'aiven_kafka_topic_get',
      capturedAt: operationsCapturedAt,
    })
  }

  const order = { danger: 0, caution: 1, info: 2 }
  return found.sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * Every service gets a document, including the ones nobody has written a policy for: "is there
 * context for this service" has to have an answer, and for an unconsidered service the answer —
 * read-only, no evidence, here is what depends on it — is the useful one.
 */
export function documentedServices(): string[] {
  return catalog.services.map((service) => service.id)
}

/** The services with operational evidence behind them, rather than catalog metadata alone. */
export function coveredServices(): string[] {
  return [
    ...new Set([
      ...serviceFacts.map((f) => f.serviceId),
      ...agentPolicies.map((p) => p.serviceId),
      ...connectorStatuses.map((c) => c.serviceId),
      ...metricReadings.map((r) => r.serviceId),
    ]),
  ].filter((id) => serviceById(id) !== undefined)
}

export function serviceContext(serviceId: string): ServiceContext | undefined {
  const service = serviceById(serviceId)
  if (!service) return undefined

  return {
    serviceId,
    name: service.name,
    type: service.type,
    captured: {
      catalog: operationsCapturedAt,
      serviceFacts: operationsCapturedAt,
      metrics: metricsCapturedAt,
      connectors: connectorsCapturedAt,
      purposeLog: contextLogCapturedAt,
      policy: 'authored, not captured',
    },
    policy: policyFor(serviceId),
    freeze: { active: freezeActive(), ...changeFreeze },
    contacts: contactsFor(serviceId),
    ownership:
      "Observed, not declared: Marmot's asset_owners and teams tables are empty, so these are the people Aiven lists as contacts and the people the event log shows changing this service.",
    findings: findingsFor(serviceId).map((finding) => ({ ...finding, runbook: runbookFor(finding.kind) })),
    readings: metricReadings
      .filter((r) => r.serviceId === serviceId)
      .map((r) => ({
        ...r,
        staleHours: Number(stalenessHours(r).toFixed(1)),
        trend: r.metric === 'disk_usage' ? diskTrend(r) : undefined,
      })),
    dependents: blastRadius(serviceId),
    plan: planOptions(serviceId),
  }
}

export { changeFreeze, runbooks }
