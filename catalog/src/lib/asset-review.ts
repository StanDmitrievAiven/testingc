// The two questions asked about a dataset at review time: should it still exist, and what is it
// costing. Both are per-asset, both are assembled from evidence that is mostly absent, and both are
// dangerous to answer confidently — which is why the shape of the answer matters more here than the
// answer does.
//
// Neither function ever returns a recommendation to delete anything. The strongest verdict on offer
// is "no sign of use", and the operator supplies the judgement. An agent that concludes a thing is
// unneeded and acts on it is the worst mistake available in this whole system: it is the one that
// does not roll back.
import { catalog } from '../data/catalog.ts'
import { serviceFacts, statementCoverage, topicHealth } from '../data/operations.ts'
import type { Asset } from '../types.ts'
import { assetById, assetsForService, lineageForAsset } from './catalog.ts'
import { lagOf, shareOfQueryTime, topicHealthFor, workloadFor } from './operations.ts'

/**
 * Deliberately three values with no fourth. "Safe to delete" is absent because nothing here can
 * establish it: this catalog sees Aiven's control plane, not the consumer that reads a topic
 * through a connection string somebody pasted into a cron job two years ago.
 */
export type DeleteVerdict = 'unsafe' | 'cannot tell' | 'no sign of use'

export interface Evidence {
  what: string
  found: string
  source: string
}

export interface DeletionReview {
  assetId: string
  verdict: DeleteVerdict
  because: string
  evidence: Evidence[]
}

/** Absent for an asset with nothing to attribute, which is not the same as an asset costing nothing. */
export interface AssetCost {
  usdPerMonth: number
  /** Of the service's bill, as a fraction, so the arithmetic is checkable. */
  share: number
  basis: 'retained bytes' | 'statement time'
  method: string
}

const HOURS_PER_MONTH = 730

/**
 * Edges that mean somebody downstream reads this asset. Foreign keys are excluded on purpose and
 * handled separately below: they point from the child to the parent, so an outbound one says this
 * table depends on another, which is the opposite of a reason to keep it.
 */
const readKinds = ['cdc', 'kafka_ingest', 'pg_federate', 'app_read', 'query_federation', 'metadata']

const names = (ids: string[]) => [...new Set(ids.map((id) => assetById(id)?.qualifiedName ?? id))].join(', ')

/**
 * Does anything use it. Four sources, each of which can only ever prove presence: a consumer group
 * that exists, a statement that names the table, a pipeline that reads it, a constraint that points
 * at it. None of them can prove absence, and the verdict below never claims they can.
 */
function usageEvidence(asset: Asset): { evidence: Evidence[]; used: string[]; blind: string[] } {
  const evidence: Evidence[] = []
  const used: string[] = []
  const blind: string[] = []

  const { up, down } = lineageForAsset(asset.id)
  const readers = down.filter((edge) => readKinds.includes(edge.kind))
  const writers = up.filter((edge) => edge.kind === 'app_write')
  // Inbound, not outbound: dropping a table that something references fails on the constraint,
  // while a table holding a reference of its own can be dropped without troubling the parent.
  const referencedBy = up.filter((edge) => edge.kind === 'fk')

  evidence.push({
    what: 'Downstream readers',
    found: readers.length
      ? `${readers.length} catalogued ${readers.length === 1 ? 'hop' : 'hops'} out: ${names(readers.map((edge) => edge.destAssetId))}`
      : 'None catalogued',
    source: 'this catalog, from connector configuration and schemas',
  })
  if (readers.length) used.push(`${readers.length} catalogued downstream ${readers.length === 1 ? 'reader' : 'readers'}`)

  if (writers.length) {
    evidence.push({
      what: 'Writers',
      found: `Written by ${names(writers.map((edge) => edge.sourceAssetId))}`,
      source: 'this catalog, from application configuration',
    })
    used.push(`an application writes into it`)
  }

  if (referencedBy.length) {
    evidence.push({
      what: 'Foreign keys pointing at it',
      found: `${referencedBy.length} referencing ${referencedBy.length === 1 ? 'table' : 'tables'}: ${names(referencedBy.map((edge) => edge.sourceAssetId))}`,
      source: 'pg_constraint',
    })
    used.push(`${referencedBy.length} foreign ${referencedBy.length === 1 ? 'key points' : 'keys point'} at it, so the drop fails on the constraint`)
  }

  if (asset.kind === 'topic') {
    const health = topicHealthFor(asset.id)
    if (health) {
      const { lag, retained } = lagOf(health)
      evidence.push({
        what: 'Consumer groups',
        found: `${health.consumerGroup} is reading it, ${lag.toLocaleString()} records behind out of ${retained.toLocaleString()} retained`,
        source: 'aiven_kafka_topic_get',
      })
      used.push(`consumer group ${health.consumerGroup}`)
    } else {
      evidence.push({
        what: 'Consumer groups',
        found: 'Not captured for this topic',
        source: 'aiven_kafka_topic_get, run for four topics only',
      })
      blind.push('no consumer group was read for this topic')
    }
  }

  if (asset.kind === 'table') {
    // Whether the tool was pointed at this service at all, which decides what silence means. The
    // detailed `queryStats` cannot answer it: those are the slowest statements, so a table absent
    // from them is merely not slow.
    const coverage = statementCoverage.find((c) => c.serviceId === asset.serviceId)
    const statements = workloadFor(asset.serviceId, asset.name)
    if (!coverage) {
      evidence.push({
        what: 'Recorded statements',
        found: 'pg_stat_statements was not read for this service',
        source: '—',
      })
      blind.push('no statement statistics were captured for this service')
    } else if (coverage.tablesSeen.includes(asset.name)) {
      const calls = statements.reduce((n, stat) => n + stat.calls, 0)
      evidence.push({
        what: 'Recorded statements',
        found: calls
          ? `Named by recorded statements, ${calls.toLocaleString()} calls across the ${statements.length} slowest`
          : `Named by at least one of the ${coverage.statements} recorded statements`,
        source: `pg_stat_statements, all ${coverage.statements} read ${coverage.capturedAt.slice(0, 10)}`,
      })
      used.push(calls ? `${calls.toLocaleString()} recorded calls` : 'a recorded statement names it')
    } else {
      evidence.push({
        what: 'Recorded statements',
        found: `None of the ${coverage.statements} statements recorded on this service name it`,
        source: `pg_stat_statements, all ${coverage.statements} read ${coverage.capturedAt.slice(0, 10)}`,
      })
    }
  }

  // The catch-all, and the one that matters most. A ClickHouse table, a Trino catalog and an
  // application have no usage telemetry in this snapshot at all, and without this they would fall
  // past every branch above into the most permissive verdict on offer — which is precisely the
  // failure the verdict scale exists to prevent. Absence of a tool is not absence of a reader.
  if (asset.kind !== 'topic' && asset.kind !== 'table') {
    evidence.push({
      what: 'Usage telemetry',
      found: `Nothing in this snapshot reports reads of a ${asset.kind.replace('_', ' ')}`,
      source: '—',
    })
    blind.push(`no tool here can see who reads a ${asset.kind.replace('_', ' ')}`)
  }

  // Stated rather than omitted, because an absent field reads as a zero. It is deliberately not a
  // blind spot: it applies to every asset equally, so counting it as one would make "cannot tell"
  // the only verdict this function can ever reach, and a review that always shrugs is not a review.
  // It belongs in the sentence instead, where it qualifies the answer rather than replacing it.
  evidence.push({
    what: 'Last write',
    found: 'Not captured. No tool in this snapshot reports a last-write or last-produce time.',
    source: '—',
  })

  return { evidence, used, blind }
}

export function deletionReview(assetId: string): DeletionReview | undefined {
  const asset = assetById(assetId)
  if (!asset) return undefined

  const { evidence, used, blind } = usageEvidence(asset)

  if (used.length) {
    return {
      assetId,
      verdict: 'unsafe',
      because: `Something is using it: ${used.join(', ')}. Deleting it breaks that, and the break is not reversible by re-creating an empty one.`,
      evidence,
    }
  }

  if (blind.length) {
    return {
      assetId,
      verdict: 'cannot tell',
      because: `Nothing here shows it being used, but ${blind.join(', and ')}. Absent evidence is not evidence of absence, so this is a question for somebody who knows the system rather than a verdict.`,
      evidence,
    }
  }

  return {
    assetId,
    verdict: 'no sign of use',
    because:
      'Nothing catalogued reads it, nothing references it, and none of the statements captured on this service name it. That is an argument for asking whoever owns it, not for deleting it: no last-write time exists anywhere in this snapshot, and a consumer connecting with a plain connection string leaves no trace here at all.',
    evidence,
  }
}

/**
 * What one dataset contributes to its service's bill. An estimate, and labelled as one everywhere
 * it surfaces: the plan price is fixed whatever the tables do, so this apportions a bill rather
 * than measuring a cost, and deleting the asset saves the stated amount only if the plan then
 * moves down a rung.
 */
export function costOf(assetId: string): AssetCost | undefined {
  const asset = assetById(assetId)
  if (!asset) return undefined
  const facts = serviceFacts.find((f) => f.serviceId === asset.serviceId)
  if (!facts) return undefined
  const monthly = facts.planPriceUsdPerHour * HOURS_PER_MONTH

  if (asset.kind === 'topic') {
    const health = topicHealthFor(assetId)
    if (!health) return undefined
    const bytes = lagOf(health).bytes
    // Against the disk it sits on, not against the other captured topics: a share of a sample
    // reads as a share of the whole and would inflate four topics into the entire broker.
    const diskBytes = facts.diskMb * 1024 * 1024
    const share = bytes / diskBytes
    return {
      usdPerMonth: Number((monthly * share).toFixed(2)),
      share: Number(share.toFixed(5)),
      basis: 'retained bytes',
      method: `${(bytes / 1024 ** 3).toFixed(2)} GB retained of the ${(diskBytes / 1024 ** 3).toFixed(0)} GB on this broker, applied to $${monthly.toFixed(2)} a month. Disk is one of several things the plan buys, so this is a floor rather than the full cost.`,
    }
  }

  const statements = workloadFor(asset.serviceId, asset.name)
  if (!statements.length) return undefined
  const share = statements.reduce((sum, stat) => sum + shareOfQueryTime(stat), 0)
  return {
    usdPerMonth: Number((monthly * share).toFixed(2)),
    share: Number(share.toFixed(5)),
    basis: 'statement time',
    method: `${(share * 100).toFixed(1)}% of the total statement time captured on this service, applied to $${monthly.toFixed(2)} a month. It apportions the bill by load rather than measuring what the table costs, and the bill does not fall until the plan does.`,
  }
}

/**
 * Datasets nothing appears to use, across the whole project. Only ever a list to review: the point
 * of surfacing them together is that a dead workflow is invisible one asset page at a time, and
 * twenty of them are a quarter's worth of paying for something nobody asked for.
 */
export function deadWorkflows(): { asset: Asset; review: DeletionReview; cost?: AssetCost }[] {
  return catalog.assets
    .map((asset) => ({ asset, review: deletionReview(asset.id)!, cost: costOf(asset.id) }))
    .filter((row) => row.review.verdict === 'no sign of use')
}

/** Every dataset on a service that something is demonstrably using, which is the inverse question. */
export function inUse(serviceId: string): Asset[] {
  return assetsForService(serviceId).filter((asset) => deletionReview(asset.id)?.verdict === 'unsafe')
}

/** How much of the project this can speak about at all, since most of it it cannot. */
export function reviewCoverage(): { assets: number; canSee: number; withConsumerData: number; withStatementData: number } {
  const withStatementData = catalog.assets.filter(
    (asset) => asset.kind === 'table' && statementCoverage.some((c) => c.serviceId === asset.serviceId),
  ).length
  return {
    assets: catalog.assets.length,
    canSee: withStatementData + topicHealth.length,
    withConsumerData: topicHealth.length,
    withStatementData,
  }
}
