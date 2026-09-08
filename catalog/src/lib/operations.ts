// Reads of the operational snapshot in src/data/operations.ts. Imports are relative rather than
// `@/` so operations.check.ts runs under plain node; nothing here touches the catalog, which keeps
// it that way (blastRadius lives in lib/catalog.ts, where the catalog already is).
import { queryStats, serviceEvents, serviceFacts, topicHealth, totalQueryTimeMs } from '../data/operations.ts'
import type { QueryStat, ServiceEvent, ServiceFacts, TopicHealth } from '../types.ts'

/** Re-exported so views have one import for everything about the operational snapshot. */
export { operationsCapturedAt } from '../data/operations.ts'

export function eventsForService(serviceId: string): ServiceEvent[] {
  return serviceEvents
    .filter((event) => event.serviceId === serviceId)
    .sort((a, b) => b.at.localeCompare(a.at))
}

export function factsForService(serviceId: string): ServiceFacts | undefined {
  return serviceFacts.find((facts) => facts.serviceId === serviceId)
}

/** The recorded statements touching one table, heaviest first. `table` is the asset's bare name. */
export function workloadFor(serviceId: string, table: string): QueryStat[] {
  return queryStats
    .filter((stat) => stat.serviceId === serviceId && stat.tables.includes(table))
    .sort((a, b) => b.totalMs - a.totalMs)
}

/** Fraction of the service's total query time, so a heavy statement is visible as such. */
export function shareOfQueryTime(stat: QueryStat): number {
  return stat.totalMs / totalQueryTimeMs
}

export function topicHealthFor(assetId: string): TopicHealth | undefined {
  return topicHealth.find((health) => health.assetId === assetId)
}

/**
 * Consumer lag is the only number that says whether a pipeline is keeping up, and Aiven gives us
 * both operands rather than the difference. `retained` is how far back a replay could go: messages
 * before `earliestOffset` are already past the retention window and gone.
 */
export function lagOf(health: TopicHealth): { lag: number; retained: number; bytes: number } {
  return health.partitions.reduce(
    (totals, partition) => ({
      lag: totals.lag + partition.latestOffset - partition.consumerOffset,
      retained: totals.retained + partition.latestOffset - partition.earliestOffset,
      bytes: totals.bytes + partition.sizeBytes,
    }),
    { lag: 0, retained: 0, bytes: 0 },
  )
}

/** Durations here span sub-millisecond to tens of hours, so the unit has to move with the value. */
export function formatMs(ms: number): string {
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)} h`
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`
  return `${Math.round(bytes / 1024)} kB`
}
