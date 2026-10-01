// Where the problem comes from, as opposed to where the data comes from.
//
// The sharpest point from the user research: lineage tells you the information's origin and says
// nothing about the fault's origin. The worked example is a symptom in ClickHouse whose cause is in
// the Postgres ingestion two hops upstream — a chain this catalog has
// drawn accurately for weeks while never once joining it to the health data sitting beside it.
//
// So this walks the chain backwards from the thing that looks wrong and asks, at each hop, whether
// anything here could explain it. Two rules make the answer worth having:
//
//   1. Only findings that could plausibly cause a *data* symptom count. A service open to the
//      internet is a serious finding and it has never once made a table stale. Counting every
//      danger as a candidate cause produces a diagnosis that is always confident and usually wrong.
//   2. "Healthy" requires having looked. A hop with no captured facts is `unknown`, never `ok`,
//      because an unexamined hop reported as fine is how a walk sends somebody to the wrong team.
import { catalog } from '../data/catalog.ts'
import type { LineageEdge } from '../types.ts'
import { findingsFor } from './agent-context.ts'
import { assetById, serviceById } from './catalog.ts'
import { lagOf, topicHealthFor } from './operations.ts'
import { connectorStatuses, metricReadings, serviceFacts } from '../data/operations.ts'

export type HopHealth = 'ok' | 'degraded' | 'unknown'

/**
 * Finding kinds that can make data late, wrong or missing. The list is short on purpose, and two
 * plausible-looking candidates were removed after watching them fire:
 *
 * `cpu-spikes` named a ClickHouse service as the cause of a stale Trino table while its own detail
 * text said the burst was normal and not worth acting on. `disk-filling` is a forecast — days to
 * full — and a forecast cannot be the cause of a symptom that is already here.
 *
 * Everything else the catalog finds is real and is not a cause of this: exposure to the internet,
 * termination protection, md5 hashing and a stale reading have never made a table late.
 */
const causesDataProblems = ['connector-down', 'lag-against-retention', 'powered-off']

/** Foreign keys are structure, not flow: nothing arrives through a constraint. */
const flows = (edge: LineageEdge) => edge.kind !== 'fk'

export interface HopVerdict {
  health: HopHealth
  why: string
  findings: { kind: string; severity: string; title: string }[]
}

export interface Hop extends HopVerdict {
  assetId: string
  name: string
  serviceId: string
  serviceName: string
  /** Hops upstream of the symptom. 1 feeds it directly. */
  distance: number
  /** How data moves from here towards the symptom. */
  via: string
  /** Delay on this hop, where anything measures it. Absent is honest; zero would not be. */
  delay?: { behindRecords: number; retainedRecords: number; measures: string }
}

export interface Diagnosis {
  assetId: string
  name: string
  chain: Hop[]
  /**
   * The most upstream hop that could explain the symptom, which is the one to fix. Not the nearest:
   * a lagging consumer fed by a stopped connector is a symptom with a symptom, and restarting the
   * consumer is a morning spent watching it fall behind again.
   */
  cause?: Hop
  verdict: string
  freshness: string
  boundary: string
}

/** The real health lookup. Injectable so a check can break a hop on purpose. */
export function hopHealth(serviceId: string): HopVerdict {
  const relevant = findingsFor(serviceId).filter((finding) => causesDataProblems.includes(finding.kind))
  const findings = relevant.map((finding) => ({ kind: finding.kind, severity: finding.severity, title: finding.title }))

  if (relevant.length) {
    return {
      health: 'degraded',
      why: relevant.map((finding) => finding.detail).join(' '),
      findings,
    }
  }

  // A connector's health is its task state, not its service facts — Kafka Connect services have no
  // disk or plan worth reading, and this is the hop most likely to be the answer.
  const connector = connectorStatuses.find((status) => status.serviceId === serviceId)
  if (connector) {
    return {
      health: connector.state === 'RUNNING' && connector.tasksRunning === connector.tasksTotal ? 'ok' : 'degraded',
      why: `${connector.connector} is ${connector.state} with ${connector.tasksRunning} of ${connector.tasksTotal} tasks running.`,
      findings,
    }
  }

  // Nothing found is only good news if something looked. These two branches are the difference
  // between "this hop is fine" and "nobody has read this hop since the seventh".
  const looked = serviceFacts.some((f) => f.serviceId === serviceId) || metricReadings.some((r) => r.serviceId === serviceId)
  return looked
    ? { health: 'ok', why: 'Nothing captured here explains a data problem.', findings: [] }
    : {
        health: 'unknown',
        why: 'No facts or metrics were captured for this service, so it cannot be cleared or blamed.',
        findings: [],
      }
}

/**
 * The same walk with one service broken on purpose.
 *
 * This exists twice over. The check needs it, because the real pipeline is healthy — connector
 * running, consumer lag in single records — so the branch that names a cause would otherwise ship
 * having never run against the real graph. And the UI needs it, because a diagnosis tool that can
 * only ever say "nothing found" teaches nobody what it does.
 *
 * Used in the interface it is labelled as a simulation everywhere it appears. A hypothetical that
 * reads like a reading is worse than no feature.
 */
export function withBreak(serviceId: string, reason: string): (id: string) => HopVerdict {
  return (id) =>
    id === serviceId
      ? {
          health: 'degraded',
          why: reason,
          findings: [{ kind: 'simulated', severity: 'danger', title: 'Simulated fault, not a reading' }],
        }
      : hopHealth(id)
}

/**
 * The thing carrying an edge, where the catalog holds it as an asset of its own. Connectors are
 * recorded both ways — as a `connector` asset and as the `via` label on every edge they move data
 * along — and only the label is in the graph. Without this the walk cannot name the single most
 * likely cause of a stalled pipeline, which is the connector rather than either database it joins.
 */
function carrierOf(edge: LineageEdge) {
  return catalog.assets.find((asset) => asset.kind === 'connector' && edge.via.includes(asset.name))
}

/** Breadth-first upstream, nearest first, ignoring cycles and stopping at a sensible depth. */
function walkUp(assetId: string, maxDepth: number): { assetId: string; distance: number; via: string }[] {
  const seen = new Set([assetId])
  const out: { assetId: string; distance: number; via: string }[] = []
  let frontier = [assetId]

  for (let distance = 1; distance <= maxDepth && frontier.length; distance++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of catalog.lineage.filter((e) => e.destAssetId === id && flows(e))) {
        // The carrier sits on the edge, so it shares the distance of the hop it delivers to and is
        // not itself walked through: nothing flows into a connector, it reaches around to pull.
        const carrier = carrierOf(edge)
        if (carrier && !seen.has(carrier.id)) {
          seen.add(carrier.id)
          out.push({ assetId: carrier.id, distance, via: edge.via })
        }
        if (seen.has(edge.sourceAssetId)) continue
        seen.add(edge.sourceAssetId)
        out.push({ assetId: edge.sourceAssetId, distance, via: edge.via })
        next.push(edge.sourceAssetId)
      }
    }
    frontier = next
  }
  return out
}

/** What, if anything, measures the delay at this hop. Only Kafka does, and only where it was read. */
function delayAt(assetId: string): Hop['delay'] {
  const health = topicHealthFor(assetId)
  if (!health) return undefined
  const { lag, retained } = lagOf(health)
  return {
    behindRecords: lag,
    retainedRecords: retained,
    measures: `${health.consumerGroup} against what the topic still keeps, read from aiven_kafka_topic_get`,
  }
}

export function diagnose(
  assetId: string,
  options: { maxDepth?: number; healthOf?: (serviceId: string) => HopVerdict } = {},
): Diagnosis | undefined {
  const asset = assetById(assetId)
  if (!asset) return undefined
  const { maxDepth = 6, healthOf = hopHealth } = options

  const chain: Hop[] = walkUp(assetId, maxDepth)
    .map(({ assetId: id, distance, via }) => {
      const hop = assetById(id)!
      return {
        assetId: id,
        name: hop.qualifiedName,
        serviceId: hop.serviceId,
        serviceName: serviceById(hop.serviceId)?.name ?? hop.serviceId,
        distance,
        via,
        delay: delayAt(id),
        ...healthOf(hop.serviceId),
      }
    })
    .sort((a, b) => a.distance - b.distance)

  const degraded = chain.filter((hop) => hop.health === 'degraded')
  const cause = degraded.sort((a, b) => b.distance - a.distance)[0]
  const unknown = chain.filter((hop) => hop.health === 'unknown')

  return {
    assetId,
    name: asset.qualifiedName,
    chain,
    cause,
    verdict: verdictFor(asset.qualifiedName, chain, degraded, unknown, cause),
    freshness: freshnessFor(chain),
    // Requirement and limitation in one sentence, because the limitation is the useful half: an
    // agent that thinks it checked the consumer will stop looking at the place the fault usually is.
    boundary:
      'The walk stops where Aiven can see: the last hop inside the platform. Whatever reads the end of this chain — a dashboard, a job, somebody\'s notebook — is invisible here, and is where a symptom nothing upstream explains usually turns out to live.',
  }
}

function verdictFor(
  name: string,
  chain: Hop[],
  degraded: Hop[],
  unknown: Hop[],
  cause?: Hop,
): string {
  if (!chain.length) {
    return `Nothing feeds ${name} in this catalog, so there is no upstream chain to blame. If it looks wrong, the cause is in whatever writes it or in the thing reading it.`
  }
  const scale = `${chain.length} ${chain.length === 1 ? 'hop' : 'hops'} upstream across ${new Set(chain.map((hop) => hop.serviceId)).size} services`

  if (cause) {
    const others = degraded.filter((hop) => hop.assetId !== cause.assetId)
    return [
      `Start at ${cause.name} on ${cause.serviceName}, ${cause.distance} ${cause.distance === 1 ? 'hop' : 'hops'} upstream: ${cause.why}`,
      others.length
        ? `${others.length} nearer ${others.length === 1 ? 'hop is' : 'hops are'} also degraded (${others.map((hop) => hop.name).join(', ')}), which is what an upstream fault looks like on the way down. Fix the furthest one first.`
        : undefined,
      `Checked ${scale}.`,
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (unknown.length === chain.length) {
    return `Nothing upstream of ${name} has been captured — ${scale}, none of it read — so this cannot tell you anything yet. The chain is drawn; the health is missing.`
  }
  return [
    `No hop upstream of ${name} explains it. Checked ${scale}.`,
    unknown.length
      ? `${unknown.length} of them could not be assessed at all (${[...new Set(unknown.map((hop) => hop.serviceName))].join(', ')}), so this is "nothing found" rather than "nothing wrong".`
      : 'Every hop was assessed and every one is clean.',
    'Look at whatever reads this, or at the query producing the symptom.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Requirement 3 asked for end-to-end staleness composed from the hops. It cannot be honestly
 * composed: nothing in this snapshot times a hop, so the parts would be guesses and the total a
 * guess with a decimal point. What is measurable is stated, and the gap is named as a gap.
 */
function freshnessFor(chain: Hop[]): string {
  const measured = chain.filter((hop) => hop.delay)
  if (!measured.length) {
    return 'No hop in this chain measures its own delay, so there is no end-to-end figure. Consumer lag is the only latency this project captures, and there is no Kafka hop here to read it from.'
  }
  const worst = measured.sort((a, b) => b.delay!.behindRecords - a.delay!.behindRecords)[0]!
  return `${measured.length} of ${chain.length} hops report a delay. The largest is ${worst.name}, ${worst.delay!.behindRecords.toLocaleString()} records behind out of ${worst.delay!.retainedRecords.toLocaleString()} retained (${worst.delay!.measures}). That is a position, not a duration: nothing here times a hop, so these cannot be added into an end-to-end age.`
}
