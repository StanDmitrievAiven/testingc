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
import { agentPolicies, changeFreeze, defaultPolicy, policyByCriticality, runbooks } from '../data/agent.ts'
import { catalog } from '../data/catalog.ts'
import { classificationFor } from '../data/classification.ts'
import { deviationsFor } from '../data/deviations.ts'
import { objectiveFor, objectives } from '../data/objectives.ts'
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
import type {
  Deviation,
  PendingUpdate,
  AgentPolicy,
  Classification,
  Finding,
  MetricReading,
  Objective,
  Owner,
  PlanRung,
  Runbook,
  ServiceFacts,
} from '../types.ts'
import { assetsForService, blastRadius, serviceById } from './catalog.ts'
import { ownersFor, provenanceOf, type Provenance } from './catalog-edits.ts'
import { lagOf } from './operations.ts'

const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * Every number a finding fires on now comes from `data/objectives.ts`, which states the target, the
 * reasoning, an owner and the date somebody last looked at it. A finding whose objective has been
 * deleted does not fire at all: an undeclared threshold is the thing this replaced, so falling back
 * to a hidden constant would quietly restore it.
 */
function objectiveTarget(id: string, serviceType?: string): Objective | undefined {
  return objectiveFor(id, serviceType)
}

/** When these facts were read. Later captures carry their own, rather than borrowing the file's. */
function factsCapturedAt(facts: ServiceFacts | undefined): string {
  return facts?.capturedAt ?? operationsCapturedAt
}

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

export interface ResolvedPolicy extends AgentPolicy {
  /** Where the rule came from. A derived rule and a written one age differently and fail differently. */
  basis: string
}

/**
 * What this plan can actually do, which is the other half of "is it supposed to handle that?".
 * Only what was captured: whether a bigger plan offers a second node is not in the ladder, so it is
 * not claimed here.
 */
export interface Capability {
  nodes: number
  /** True today, rather than a statement about what the tier could offer. */
  failoverAvailable: boolean
  diskGb: number
  maxConnections?: number
  /** From the plan ladder: whether disk can grow without a plan change and its restart. */
  canAddDisk?: boolean
  backupsRetained?: number
  latestBackupAt?: string
  source: string
}

/**
 * How much is known about a service, counted pessimistically: an unset field is missing, never a
 * default. It sits in the document so an agent can decline on thin context rather than discovering
 * the thinness halfway through an action.
 */
export interface Coverage {
  /** Operational facts captured from `aiven_service_get`. */
  facts: boolean
  metrics: boolean
  classified: boolean
  /** A policy that came from somewhere, rather than the read-only fallback. */
  policy: boolean
  /** Anyone at all to tell, declared or observed. */
  contact: boolean
}

export function coverageFor(serviceId: string): Coverage {
  return {
    facts: serviceFacts.some((f) => f.serviceId === serviceId),
    metrics: metricReadings.some((r) => r.serviceId === serviceId),
    classified: classificationFor(serviceId) !== undefined,
    policy: agentPolicies.some((p) => p.serviceId === serviceId) || classificationFor(serviceId) !== undefined,
    contact: contactsFor(serviceId).length > 0,
  }
}

export interface ServiceContext {
  serviceId: string
  name: string
  type: string
  coverage: Coverage
  /** Per source, because they were captured at different times and the differences matter. */
  captured: Record<string, string>
  /** Absent where nobody has classified it, which is itself the thing to report. */
  classification?: Classification
  /** The definitions of healthy in force here, so an agent evaluates what a person reads. */
  objectives: Objective[]
  capabilities?: Capability
  policy: ResolvedPolicy
  freeze: { active: boolean; from: string; to: string; reason: string }
  /**
   * Declared in this catalog, and never folded into `contacts`. The two answer different questions:
   * an owner accepted responsibility, a contact merely appeared in an audit log. An agent that
   * escalates to the second while believing it has reached the first wakes up the wrong person.
   */
  owners: Owner[]
  contacts: Contact[]
  ownership: string
  findings: (Finding & { runbook?: Runbook })[]
  readings: (MetricReading & { staleHours: number; trend?: DiskTrend })[]
  dependents: ReturnType<typeof blastRadius>
  /** Both directions, as one block: scaling up is not the only move, and it is the only one costed elsewhere. */
  plan: { current?: PlanRung; options: PlanOption[]; downsize: RightSizing; note: string }
  lifecycle: Lifecycle
  /** Whether this service's description is somebody's, the snapshot's, or an unreviewed draft. */
  descriptionReview: Provenance
  /** How this managed service is not the upstream project. Authored, and internal entries withheld. */
  deviations: Deviation[]
}

export interface QueuedUpdate extends PendingUpdate {
  /** What it does to availability, which is the question the console does not answer. */
  impact: string
  takes: string
  /** Stated plainly where Aiven has not set one, since "no deadline" and "unknown" differ. */
  deadlineNote: string
}

export interface Lifecycle {
  /** RUNNING, REBUILDING, POWEROFF — a fact with a capture time, not only a badge. */
  state: string
  stateReadAt?: string
  stateMeans: string
  /** Absent where no facts were captured, rather than presented as an empty window. */
  maintenanceWindow?: string
  updates: QueuedUpdate[]
  note: string
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

/**
 * What an agent may do here, and where that came from. Three sources in falling order of
 * specificity: a policy written for this service, the table its criticality maps to, or — for a
 * service nobody has classified — read-only. The order matters more than the contents: a fleet
 * whose rules are hand-written per service is a fleet whose rules quietly disagree with each other.
 */
export function policyFor(serviceId: string): ResolvedPolicy {
  const authored = agentPolicies.find((p) => p.serviceId === serviceId)
  if (authored) {
    return { ...authored, basis: 'written for this service, overriding what its criticality would give it' }
  }

  const classification = classificationFor(serviceId)
  if (classification) {
    return {
      serviceId,
      ...policyByCriticality[classification.criticality],
      basis: `derived from ${classification.criticality} criticality in a ${classification.environment} environment`,
    }
  }

  return {
    serviceId,
    ...defaultPolicy,
    basis: 'unclassified, so the most cautious setting rather than a convenient one',
  }
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
    downsize: downsizeFor(serviceId),
    note: planNote(rungs, current, facts !== undefined, service?.type),
  }
}

export interface RightSizing {
  verdict: 'fits' | 'would not fit' | 'contradicted' | 'cannot tell' | 'already smallest' | 'no smaller rung priced'
  smaller?: PlanRung
  /** Only ever set alongside `fits`, so a saving can never be quoted for a move that should not happen. */
  monthlyUsdSaved?: number
  /** What the saving would have been, when something blocks it. The number is the reason it is tempting. */
  monthlyUsdForgone?: number
  because: string
}

/**
 * Whether a smaller plan would do, and what stops it.
 *
 * Pure, and separate from the snapshot on purpose. Nothing in this project currently passes — the
 * one service with a cheaper rung below it would land at ninety-two percent full on that rung — so
 * without a function that can be handed a hypothetical, the branch that recommends a downsize would
 * ship having never once run.
 *
 * The bias is deliberate: every way of not knowing returns a refusal rather than a recommendation.
 * Being wrong about a downsize costs a migration, an outage and the trust that made anyone listen.
 */
export function assessDownsize(input: {
  /** The whole ladder for this service type, so "no ladder" and "bottom of the ladder" stay distinct. */
  rungs: PlanRung[]
  current?: PlanRung
  hasFacts: boolean
  /** Peak disk in gigabytes, not the percentage, since the percentage is of the current plan. */
  usedGb?: number
  peaks: { name: string; percent: number }[]
  /** Findings that argue against shrinking, by title. A service running out of disk is not a candidate. */
  contradictions: string[]
  /** Most of the smaller disk that may be in use after the move. */
  diskTarget: number
  /** The highest peak of any resource that still allows the move. */
  peakTarget: number
}): RightSizing {
  const { rungs, current, hasFacts, usedGb, peaks, contradictions, diskTarget, peakTarget } = input

  // Each way of not knowing gets its own sentence, because each is a different thing to go and fix.
  if (!rungs.length) {
    return { verdict: 'no smaller rung priced', because: 'No plan prices were captured for this service type, so a cheaper rung cannot be priced even if one exists.' }
  }
  if (!hasFacts) {
    return { verdict: 'cannot tell', because: 'No service facts were captured here, so there is no current plan to compare a smaller one against.' }
  }
  if (!current) {
    return { verdict: 'cannot tell', because: 'The current plan could not be matched to a captured price, so there is nothing to compare a smaller one against.' }
  }

  const smaller = rungs.filter((rung) => rung.usdPerHour < current.usdPerHour).sort((a, b) => b.usdPerHour - a.usdPerHour)[0]
  if (!smaller) {
    return { verdict: 'already smallest', because: `${current.plan} is the cheapest rung captured for this service type, so there is nothing below it to move to.` }
  }

  const saving = Number(((current.usdPerHour - smaller.usdPerHour) * 730).toFixed(2))
  const forgone = { monthlyUsdForgone: saving, smaller }

  if (usedGb === undefined) {
    return { verdict: 'cannot tell', ...forgone, because: `${smaller.plan} would save $${saving} a month, but no disk reading was captured here, so whether the data fits is unknown. Unknown is not a yes.` }
  }

  const wouldBeFull = (usedGb / smaller.diskGb) * 100
  if (wouldBeFull > diskTarget) {
    return {
      verdict: 'would not fit',
      ...forgone,
      because: `${usedGb.toFixed(1)} GB would be ${wouldBeFull.toFixed(0)}% of ${smaller.plan}'s ${smaller.diskGb} GB, past the ${diskTarget}% this is allowed to leave. The $${saving} a month is real and so is the disk-full incident that follows it.`,
    }
  }

  const over = peaks.filter((peak) => peak.percent > peakTarget)
  if (over.length || contradictions.length) {
    const reasons = [
      ...over.map((peak) => `${peak.name} peaked at ${peak.percent.toFixed(0)}%, past the ${peakTarget}% ceiling`),
      ...contradictions,
    ]
    return {
      verdict: 'contradicted',
      ...forgone,
      because: `The data fits, but ${reasons.join('; and ')}. A load that peaks here will peak on a smaller plan too, and meet it with less.`,
    }
  }

  return {
    verdict: 'fits',
    smaller,
    monthlyUsdSaved: saving,
    because: `${usedGb.toFixed(1)} GB is ${wouldBeFull.toFixed(0)}% of ${smaller.plan}'s ${smaller.diskGb} GB and nothing peaked past ${peakTarget}%. Moving down saves $${saving} a month. It is still a plan change with a restart, so it wants a window rather than an afternoon.`,
  }
}

/** The same question asked of a real service, with the numbers fetched from the snapshot. */
export function downsizeFor(serviceId: string): RightSizing {
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const service = serviceById(serviceId)
  const rungs = planLadder.filter((r) => r.serviceType === service?.type)
  const current = rungs.find((r) => r.usdPerHour === facts?.planPriceUsdPerHour)

  const peakOf = (metric: string) => metricReadings.find((r) => r.serviceId === serviceId && r.metric === metric)?.max
  const diskPeak = peakOf('disk_usage')
  const peaks = [
    { name: 'CPU', percent: peakOf('cpu_usage') },
    { name: 'Memory', percent: peakOf('mem_usage') },
  ].filter((p): p is { name: string; percent: number } => p.percent !== undefined)

  return assessDownsize({
    rungs,
    current,
    hasFacts: facts !== undefined,
    usedGb: diskPeak !== undefined && facts ? (facts.diskMb / 1024) * (diskPeak / 100) : undefined,
    peaks,
    // Its own findings, minus the ones that have nothing to say about size.
    contradictions: findingsFor(serviceId)
      .filter((f) => f.kind === 'disk-filling' || f.kind === 'cpu-sustained')
      .map((f) => f.title.toLowerCase()),
    diskTarget: objectiveFor('downsize-headroom', service?.type)?.target ?? 67,
    peakTarget: objectiveFor('downsize-utilisation', service?.type)?.target ?? 60,
  })
}

/**
 * What is true about this service right now that changes what should happen next, worst first.
 * Every finding names its source and the moment that source was read, because a finding is worth
 * exactly as much as the freshness of the thing behind it.
 */
/**
 * What each service state means for somebody deciding whether to act. A newcomer testing the
 * console could not tell whether a state required action, and neither can an agent: `REBUILDING`
 * looks alarming and is routine, `POWEROFF` looks safe and means the data is still being paid for.
 */
const stateMeanings: Record<string, string> = {
  RUNNING: 'Serving traffic. Normal, and the only state in which most changes are safe to attempt.',
  REBUILDING:
    'New nodes are being built and service moved onto them. Expected during a plan change or maintenance, and not an incident. Wait for RUNNING rather than acting.',
  REBALANCING: 'Data is moving between nodes. Nothing is wrong; performance may be uneven until it finishes.',
  POWEROFF:
    'Deliberately stopped. It answers nothing, and the stored data and its backups remain, so it is not free. Powering on takes minutes.',
}

/**
 * Availability impact per kind of queued update, matched on what Aiven calls it. The platform says
 * what it will do and when it becomes mandatory; it does not say whether it will cost an outage,
 * which is the only part that decides who needs telling.
 */
export function updateImpact(description: string, nodes: number | undefined): { impact: string; takes: string } {
  const single = nodes === 1
  const text = description.toLowerCase()
  if (/upgrade|version/.test(text)) {
    return {
      impact: single
        ? 'A version upgrade on a single node is downtime for its whole duration, and it cannot be rolled back.'
        : 'Rolling across nodes, so brief connection resets rather than an outage. It cannot be rolled back.',
      takes: 'Ten minutes to an hour, depending on data size.',
    }
  }
  if (/security|patch|os |image/.test(text)) {
    return {
      impact: single
        ? 'The node is replaced, so this is a short outage on a service with nothing to fail over to.'
        : 'Nodes are replaced one at a time. Clients that reconnect will not notice; clients that hold one connection forever will.',
      takes: 'A few minutes per node.',
    }
  }
  return {
    impact: single
      ? 'Treat as downtime: with one node there is nothing to absorb a restart, whatever the update turns out to be.'
      : 'Probably a rolling restart. Confirm with support before a window is promised to anyone.',
    takes: 'Minutes, though this is an estimate rather than a stated duration.',
  }
}

/**
 * Service lifecycle as context rather than decoration: what state it is in, when that was read,
 * what the state means, and for anything queued, what it will cost to let it happen.
 */
export function lifecycleFor(serviceId: string): Lifecycle {
  const service = serviceById(serviceId)
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const state = service?.state ?? 'unknown'

  return {
    state,
    stateReadAt: factsCapturedAt(facts),
    stateMeans: stateMeanings[state] ?? 'Not a state this catalog has a description for. Check the console before acting.',
    maintenanceWindow:
      facts?.maintenanceDay && facts.maintenanceTime
        ? `${facts.maintenanceDay} at ${facts.maintenanceTime} UTC`
        : undefined,
    updates: (facts?.pendingUpdates ?? []).map((update) => ({
      ...update,
      ...updateImpact(update.description, facts?.nodeCount),
      deadlineNote: update.deadline
        ? `Mandatory after ${update.deadline}: Aiven applies it then, in its window rather than yours.`
        : 'No deadline set yet, so the window is still yours to choose. That changes without notice.',
    })),
    note: facts
      ? (facts.pendingUpdates ?? []).length
        ? 'Impact and duration are authored per kind of update, since Aiven states what and when but not what it costs.'
        : 'Nothing is queued as of this capture. Updates appear with little notice, so this is a reading rather than a promise.'
      : 'No facts were captured for this service, so its state is whatever the catalog last recorded and its queue is unknown.',
  }
}

/**
 * Documentation for each kind of finding. Checked against the live site — a link that 404s is
 * worse than no link, because it costs the reader a click to find that out. `docs.check.ts` holds
 * the verified set and fails if anything strays from it.
 */
const findingDocs: Record<string, string> = {
  'disk-filling': 'https://aiven.io/docs/platform/concepts/dynamic-disk-sizing',
  'open-to-internet': 'https://aiven.io/docs/platform/howto/restrict-access',
  'single-node': 'https://aiven.io/docs/products/postgresql/concepts/high-availability',
  'pending-maintenance': 'https://aiven.io/docs/platform/concepts/maintenance-window',
  'powered-off': 'https://aiven.io/docs/platform/concepts/service-power-cycle',
  'backup-stale': 'https://aiven.io/docs/platform/howto/console-fork-service',
  'weak-password-encryption': 'https://aiven.io/docs/tools/api',
  'connector-down': 'https://aiven.io/docs/products/postgresql/concepts/aiven-db-migrate',
  'lag-against-retention': 'https://aiven.io/docs/products/kafka/howto/create-topic',
  'cpu-spikes': 'https://aiven.io/docs/products/kafka/concepts/horizontal-vertical-scaling',
  'no-termination-protection': 'https://aiven.io/docs/tools/api',
  'stale-context': 'https://aiven.io/docs/tools/api',
}

export function findingsFor(serviceId: string): Finding[] {
  const found: Finding[] = []
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const readings = metricReadings.filter((r) => r.serviceId === serviceId)
  const service = serviceById(serviceId)
  const type = service?.type
  const factsAt = factsCapturedAt(facts)
  // A stopped service changes what several findings mean, so it is established once up front.
  const off = service?.state === 'POWEROFF'

  // One finding for the service, not one per reading: the readings go stale together, because it is
  // the collection that fell behind rather than any single metric.
  const freshness = objectiveTarget('evidence-freshness', type)
  const stale = freshness ? readings.filter((r) => stalenessHours(r) > freshness.target) : []
  if (stale.length && freshness) {
    const oldest = stale.reduce((a, b) => (stalenessHours(a) > stalenessHours(b) ? a : b))
    found.push({
      kind: 'stale-context',
      severity: 'caution',
      title: `Metrics are ${Math.round(stalenessHours(oldest))} hours behind the rest of this snapshot`,
      detail: `${stale.map((r) => r.metric.replace('_', ' ')).join(', ')} all end at ${oldest.to.replace('T', ' ').slice(0, 16)} UTC and cover ${Math.round(diskTrend(oldest).windowDays)} days rather than the usual seven. The freshness objective allows ${freshness.target} ${freshness.unit}. Anything derived from them is an estimate on old evidence, so re-read before acting.`,
      objective: freshness.id,
      source: 'aiven_service_metrics_fetch',
      capturedAt: metricsCapturedAt,
    })
  }

  const headroom = objectiveTarget('disk-headroom', type)
  const spike = objectiveTarget('cpu-spike', type)
  const sustained = objectiveTarget('cpu-sustained', type)

  for (const reading of readings) {
    if (reading.metric === 'disk_usage' && headroom) {
      const trend = diskTrend(reading)
      if (trend.daysToFull !== undefined && trend.daysToFull < headroom.target) {
        found.push({
          kind: 'disk-filling',
          severity: trend.daysToFull < (headroom.breach ?? 0) ? 'danger' : 'caution',
          title: `Disk is filling: about ${Math.round(trend.daysToFull)} days left at this rate`,
          detail: `${reading.series} is at ${reading.latest.toFixed(1)}%, up from ${reading.min.toFixed(1)}% across a ${Math.round(trend.windowDays)}-day window, or ${trend.perDay.toFixed(2)} points a day. The objective for ${type ?? 'this service type'} is ${headroom.target} ${headroom.unit}.${trend.includesInitialLoad ? ' The window opens when the service was created, so the initial load is inside that rate and the real figure is longer. Re-measure over a settled week before acting.' : ''}`,
          objective: headroom.id,
          source: 'aiven_service_metrics_fetch',
          capturedAt: metricsCapturedAt,
        })
      }
    }

    // A high maximum with a low average is a query, not a trend. Worth saying out loud, so that
    // nobody — human or agent — resizes a service because of one spike.
    if (reading.metric === 'cpu_usage' && spike && sustained && reading.max > spike.target && reading.avg < sustained.target) {
      found.push({
        kind: 'cpu-spikes',
        severity: 'info',
        title: 'CPU spikes on an otherwise idle service',
        detail: `${reading.max.toFixed(0)}% peak against a ${reading.avg.toFixed(0)}% average, so above the ${spike.target}% worth naming and below the ${sustained.target}% that would count as sustained. That is work arriving in bursts, not a service running out of headroom, and it is not a reason to change the plan.`,
        objective: spike.id,
        source: 'aiven_service_metrics_fetch',
        capturedAt: metricsCapturedAt,
      })
    }
  }

  if (facts?.openToInternet) {
    found.push({
      kind: 'open-to-internet',
      // A stopped service has nothing listening, so calling this exploitable today would be false.
      // It is a danger that has been paused, not a danger that has been dealt with.
      severity: off ? 'caution' : 'danger',
      title: off ? 'Open to 0.0.0.0/0 the moment it powers on' : 'Reachable from 0.0.0.0/0',
      detail: off
        ? 'The ip filter allows every address. Nothing answers while the service is powered off, so this is dormant rather than exploitable — and it stops being dormant the instant somebody starts it, which is the wrong moment to find out.'
        : 'The ip filter allows every address, so the only thing between this service and the internet is its password.',
      source: 'aiven_service_get',
      capturedAt: factsAt,
    })
  }

  if (off && facts) {
    found.push({
      kind: 'powered-off',
      severity: 'caution',
      title: `Powered off, with no backup since ${facts.latestBackupAt?.slice(0, 10) ?? 'the snapshot was taken'}`,
      detail: `Nothing is running and nothing depends on it in this catalog. A stopped service is ambiguous rather than safe: it is either finished with, in which case it should be deleted along with its ${facts.backupCount ?? 0} stored backups, or it is parked, in which case its open ip filter and ${facts.terminationProtection ? 'protected' : 'unprotected'} state are waiting for whoever starts it again.`,
      source: 'aiven_service_get',
      capturedAt: factsAt,
    })
  }

  // Vacuous on a stopped service: it cannot have an outage while it is already off, and the
  // powered-off finding above is the one worth reading.
  if (facts?.nodeCount === 1 && !off) {
    found.push({
      kind: 'single-node',
      severity: 'caution',
      title: 'One node, so a restart is an outage',
      detail: 'There is nothing to fail over to. Every restart, plan change and platform update is downtime that has to be timed rather than absorbed.',
      source: 'aiven_service_get',
      capturedAt: factsAt,
    })
  }

  if (facts && !facts.terminationProtection) {
    found.push({
      kind: 'no-termination-protection',
      severity: 'info',
      title: 'Termination protection is off',
      detail: 'Nothing stands between a deletion call and this service, which is a cheap gap to close.',
      source: 'aiven_service_get',
      capturedAt: factsAt,
    })
  }

  if (facts?.passwordEncryption && facts.passwordEncryption !== 'scram-sha-256') {
    found.push({
      kind: 'weak-password-encryption',
      severity: 'caution',
      title: `Passwords are stored as ${facts.passwordEncryption}`,
      detail: `scram-sha-256 is the stronger scheme and the one Postgres has defaulted to since version 14; md5 is deprecated upstream. Changing the setting is a one-line call, but existing hashes only convert when each password is reset, so the work is in the clients rather than the service.`,
      source: 'aiven_service_get',
      capturedAt: factsAt,
    })
  }

  const backups = objectiveTarget('backup-freshness', type)
  if (backups && facts?.latestBackupAt && !off) {
    const age = (Date.parse(factsAt) - Date.parse(facts.latestBackupAt)) / HOUR
    if (age > backups.target) {
      found.push({
        kind: 'backup-stale',
        severity: age > (backups.breach ?? Infinity) ? 'danger' : 'caution',
        title: `The newest backup is ${Math.round(age / 24)} days old`,
        detail: `Taken ${facts.latestBackupAt.slice(0, 10)}, against an objective of ${backups.target} ${backups.unit}. The restore point has moved without anything failing, which is how it is usually discovered too late.`,
        objective: backups.id,
        source: 'aiven_service_get',
        capturedAt: factsAt,
      })
    }
  }

  if (facts?.pendingUpdates.length) {
    // Aiven queues some updates without a deadline. Sorting undated ones last keeps the headline on
    // the one that actually runs out of time.
    const soonest = [...facts.pendingUpdates].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))[0]
    found.push({
      kind: 'pending-maintenance',
      severity: 'caution',
      title: soonest.deadline
        ? `${facts.pendingUpdates.length} platform ${facts.pendingUpdates.length === 1 ? 'update' : 'updates'} queued, the first due ${soonest.deadline.slice(0, 10)}`
        : `${facts.pendingUpdates.length} platform ${facts.pendingUpdates.length === 1 ? 'update' : 'updates'} queued, no deadline set yet`,
      detail: soonest.deadline
        ? `After each deadline Aiven applies the update itself. On a single node that is downtime at a time nobody chose. Earliest: ${soonest.description}`
        : `No deadline has been set, so this one waits for the maintenance window rather than forcing it. It still applies eventually, and doing it deliberately is cheaper than being surprised. Queued: ${soonest.description}`,
      source: 'aiven_service_get',
      capturedAt: factsAt,
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
  const lagHeadroom = objectiveTarget('consumer-lag-headroom', type)
  for (const asset of assetsForService(serviceId)) {
    const health = topicHealth.find((h) => h.assetId === asset.id)
    if (!health || !lagHeadroom) continue
    const { lag, retained } = lagOf(health)
    if (!retained) continue
    const share = (lag / retained) * 100
    if (share < lagHeadroom.target) continue
    found.push({
      kind: 'lag-against-retention',
      severity: share > (lagHeadroom.breach ?? Infinity) ? 'danger' : 'caution',
      title: `${health.consumerGroup} is ${Math.round(share)}% of the way through what ${asset.name} still keeps`,
      detail: `${lag.toLocaleString()} records behind, with ${retained.toLocaleString()} retained and ${health.retentionHours} hours of retention, against an objective of ${lagHeadroom.target} ${lagHeadroom.unit}. When lag passes retention the records are gone, not delayed.`,
      objective: lagHeadroom.id,
      source: 'aiven_kafka_topic_get',
      capturedAt: operationsCapturedAt,
    })
  }

  const order = { danger: 0, caution: 1, info: 2 }
  // Attached in one place rather than at each of the twelve sites above: a link is not part of
  // deciding whether a finding fires, and an operator who has to go and search for the page is
  // being asked to do the one thing this document exists to save them.
  return found
    .map((finding) => ({ ...finding, docUrl: findingDocs[finding.kind] }))
    .sort((a, b) => order[a.severity] - order[b.severity])
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

/** What the plan gives this service today, from the facts and the ladder rather than from the tier. */
export function capabilitiesFor(serviceId: string): Capability | undefined {
  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  if (!facts) return undefined
  const current = planOptions(serviceId).current
  return {
    nodes: facts.nodeCount,
    failoverAvailable: facts.nodeCount > 1,
    diskGb: Math.round(facts.diskMb / 1024),
    maxConnections: facts.maxConnections,
    // Undefined rather than false where no priced rung matched: not knowing is not the same as no.
    canAddDisk: current ? current.extraDiskUsdPerGbHour !== undefined : undefined,
    backupsRetained: facts.backupCount,
    latestBackupAt: facts.latestBackupAt,
    source: 'aiven_service_get',
  }
}

export function serviceContext(serviceId: string): ServiceContext | undefined {
  const service = serviceById(serviceId)
  if (!service) return undefined

  const facts = serviceFacts.find((f) => f.serviceId === serviceId)
  const owners = ownersFor(serviceId)

  return {
    serviceId,
    name: service.name,
    type: service.type,
    coverage: coverageFor(serviceId),
    classification: classificationFor(serviceId),
    // The one in force per id, so a Kafka document carries Kafka's disk objective and not both.
    objectives: [...new Set(objectives.map((o) => o.id))]
      .map((id) => objectiveFor(id, service.type))
      .filter((o): o is Objective => o !== undefined),
    capabilities: capabilitiesFor(serviceId),
    captured: {
      catalog: operationsCapturedAt,
      serviceFacts: factsCapturedAt(facts),
      metrics: metricsCapturedAt,
      connectors: connectorsCapturedAt,
      purposeLog: contextLogCapturedAt,
      policy: 'authored, not captured',
    },
    policy: policyFor(serviceId),
    freeze: { active: freezeActive(), ...changeFreeze },
    owners,
    contacts: contactsFor(serviceId),
    ownership: owners.length
      ? `Declared in this catalog: ${owners.map((owner) => `${owner.name} (${owner.kind})`).join(', ')}. The contacts below are a separate list, observed rather than agreed to, and escalation should start with the owner.`
      : "Nobody has been declared as an owner here, so the names below are observed rather than responsible: Marmot's asset_owners and teams tables are empty, and these are the people Aiven lists as contacts and the people the event log shows changing this service.",
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
    lifecycle: lifecycleFor(serviceId),
    descriptionReview: provenanceOf(serviceId) ?? {
      author: 'the catalog snapshot',
      at: '2026-09-15',
      state: 'accepted',
      sources: ['this catalog, authored when the project was walked'],
    },
    // Internal deviations are withheld here and nowhere else: this document is emitted to files an
    // agent fetches, and the UI reads them separately for the operator in front of it.
    deviations: deviationsFor(serviceById(serviceId)?.type),
  }
}

export { changeFreeze, runbooks }
