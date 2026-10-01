// Which of Aiven's own events went through the purpose gate? Imports are relative rather than `@/`
// so gate-coverage.check.ts runs under plain node.
import { contextLog } from '../data/context-log.ts'
import type { ContextChange, ServiceEvent } from '../types.ts'

export type GateStatus = 'platform' | 'before-gate' | 'gated' | 'outside-gate'

/** The first purpose ever recorded. Before this, nothing could have been asked for a purpose. */
export const gateStart = contextLog.reduce((first, c) => (c.createdAt < first ? c.createdAt : first), contextLog[0].createdAt)

// The proxy records intent before it forwards the call, so the event follows the purpose. Aiven
// timestamps to the second, hence a little slack on the early side too.
// ponytail: time + service proximity, not an ID join. Two changes inside two minutes can cover each
// other's event; upgrade path is a correlation ID stamped by the proxy and carried on the event.
const EARLY_MS = 2_000
const LATE_MS = 120_000

export function gateStatus(
  event: ServiceEvent,
  changes: ContextChange[] = contextLog,
): { status: GateStatus; change?: ContextChange } {
  // A platform actor changed it without anyone asking, so no purpose could exist.
  if (!event.actor.includes('@')) return { status: 'platform' }
  const at = Date.parse(event.at)
  if (event.at < gateStart) return { status: 'before-gate' }
  const change = changes.find((c) => {
    const delta = at - Date.parse(c.createdAt)
    // A refused call did not change anything, so it cannot account for an event.
    return c.serviceId === event.serviceId && c.status === 'ok' && delta >= -EARLY_MS && delta <= LATE_MS
  })
  return change ? { status: 'gated', change } : { status: 'outside-gate' }
}
