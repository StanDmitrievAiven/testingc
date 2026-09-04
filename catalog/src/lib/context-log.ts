import { catalog } from '@/data/catalog'
import { contextLog } from '@/data/context-log'
import type { ContextChange } from '@/types'

/** Where the Vite dev server forwards the local mcpproxy API. See vite.config.ts. */
const PROXY_API = '/mcpproxy/api'

function newestFirst(changes: ContextChange[]): ContextChange[] {
  return [...changes].sort((a, b) => b.version - a.version)
}

export function resourceKeyFor(serviceId: string): string {
  return `aiven:project/${catalog.project}/service/${serviceId}`
}

/** The committed snapshot: always available, as stale as the last `npm run context:import`. */
export function changesForService(serviceId: string): ContextChange[] {
  return newestFirst(contextLog.filter((change) => change.serviceId === serviceId))
}

/**
 * Reads the same history straight from the running proxy. Rejects when the proxy is not up — the
 * caller keeps the snapshot in that case, which is also what a built, deployed page always sees.
 */
export async function fetchLiveChanges(serviceId: string): Promise<ContextChange[]> {
  // Only the dev server proxies to mcpproxy. The deployed prototype has no proxy behind it, so it
  // does not chase one — the committed snapshot is the whole story there.
  if (!import.meta.env.DEV) throw new Error('mcpproxy is a dev-only source')
  const response = await fetch(`${PROXY_API}/history?key=${encodeURIComponent(resourceKeyFor(serviceId))}`)
  if (!response.ok) throw new Error(`mcpproxy responded ${response.status}`)
  const body = (await response.json()) as { versions?: Record<string, unknown>[] }
  // The proxy's own rows carry the store's column names and a few fields the timeline never shows.
  return newestFirst(
    (body.versions ?? []).map((row) => ({
      id: Number(row.id),
      serviceId: String(row.serviceName),
      version: Number(row.version),
      operation: String(row.operation),
      toolName: String(row.toolName),
      purpose: String(row.purpose ?? ''),
      status: row.status as ContextChange['status'],
      createdAt: String(row.createdAt),
      durationMs: row.durationMs == null ? undefined : Number(row.durationMs),
      errorText: row.errorText ? String(row.errorText) : undefined,
      clientName: String(row.clientName),
    })),
  )
}
