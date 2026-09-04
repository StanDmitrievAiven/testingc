import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { catalog } from '@/data/catalog'
import {
  assetById,
  columnLineage,
  isRuntime,
  serviceById,
  stackById,
} from '@/lib/catalog'
import { groupedLayout, layoutBoxes, neighborhood } from '@/lib/graph-math'
import type { Asset, Integration, IntegrationType, LineageKind, Service } from '@/types'

export type GraphLevel = 'services' | 'datasets' | 'columns'

/**
 * Integration types and lineage kinds are two vocabularies for the same handful of flows, so both
 * normalise into this one. A colour then means the same thing at every level of the graph.
 */
export type FlowKind =
  | 'cdc'
  | 'kafka_ingest'
  | 'pg_federate'
  | 'query_federation'
  | 'app_write'
  | 'metadata'
  | 'fk'

// Ordered roughly along the pipeline, because this doubles as the legend order. Only the five real
// data movements get a chart colour; metadata and foreign keys are not movement, so they stay
// neutral instead of competing for attention.
export const flowKinds: {
  kind: FlowKind
  label: string
  color: string
  dashed?: boolean
  /** Describes structure rather than moving data, so it is never animated. */
  structural?: boolean
}[] = [
  { kind: 'cdc', label: 'Change data capture', color: 'var(--chart-1)' },
  { kind: 'kafka_ingest', label: 'Kafka ingest', color: 'var(--chart-2)' },
  { kind: 'pg_federate', label: 'Postgres federation', color: 'var(--chart-3)' },
  { kind: 'query_federation', label: 'Query federation', color: 'var(--chart-4)' },
  { kind: 'app_write', label: 'Application I/O', color: 'var(--chart-5)' },
  { kind: 'metadata', label: 'Metadata', color: 'var(--muted-foreground)', dashed: true, structural: true },
  { kind: 'fk', label: 'Foreign key', color: 'var(--muted-foreground)', structural: true },
]

const flowStyles = new Map(flowKinds.map((flow) => [flow.kind, flow]))

// Both maps are exhaustive Records on purpose: adding a type to either vocabulary fails the build
// here rather than silently drawing an unlabelled, unfilterable edge.
const integrationFlow: Record<IntegrationType, FlowKind> = {
  debezium_cdc: 'cdc',
  kafka_connect: 'cdc',
  clickhouse_kafka: 'kafka_ingest',
  clickhouse_postgresql: 'pg_federate',
  trino_catalog: 'query_federation',
  application_service_credential: 'app_write',
  datahub_metadata_ingestion: 'metadata',
}

const lineageFlow: Record<LineageKind, FlowKind> = {
  cdc: 'cdc',
  kafka_ingest: 'kafka_ingest',
  pg_federate: 'pg_federate',
  query_federation: 'query_federation',
  app_write: 'app_write',
  app_read: 'app_write',
  metadata: 'metadata',
  fk: 'fk',
}

export type GraphResult = {
  nodes: Node<EntityNodeData>[]
  edges: Edge[]
  /** Edge count per flow, taken before `kinds` filtering so the legend can offer hidden kinds back. */
  counts: Record<FlowKind, number>
}

export type GraphOptions = {
  hideIsolated?: boolean
  focusId?: string
  /** Hops to walk out from `focusId`; `Infinity` for the whole connected component. */
  depth?: number
  kinds?: Set<FlowKind>
  /** Nest nodes inside a container per owning service instead of one flat layout. */
  grouped?: boolean
}

function emptyCounts(): Record<FlowKind, number> {
  return Object.fromEntries(flowKinds.map((flow) => [flow.kind, 0])) as Record<FlowKind, number>
}

export type EntityNodeData = {
  label: string
  subtitle: string
  kind: 'runtime' | 'service' | 'dataset' | 'column' | 'stack'
  state?: string
  type?: string
  hops?: number
  entityId: string
  column?: string
  /** Owning service, used to group dataset nodes into containers. */
  serviceId?: string
  /**
   * Service type for the Aiven mark. Always the *owning service's* type, never the asset kind,
   * so a table shows the PostgreSQL mark rather than falling back to a placeholder.
   */
  markType?: string
}

// Must match the fixed box EntityNode renders, or the layout will reserve the wrong space.
const NODE_WIDTH = 228
const NODE_HEIGHT = 56

function visualEnds(integration: Integration): { source: string; target: string } {
  if (integration.type === 'application_service_credential') {
    return { source: integration.destServiceId, target: integration.sourceServiceId }
  }
  return { source: integration.sourceServiceId, target: integration.destServiceId }
}

function layoutWithDagre<T extends EntityNodeData>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  const placed = layoutBoxes(
    nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges,
    { nodesep: 36, ranksep: 92 },
  )
  return nodes.map((node) => {
    const spot = placed.get(node.id)
    return { ...node, position: { x: spot?.x ?? 0, y: spot?.y ?? 0 } }
  })
}

/**
 * Lays datasets out inside a container per owning service, so one picture answers both "what flows
 * where" and "which service holds it". Containers are emitted before their children because React
 * Flow requires a parent to appear earlier in the node array.
 */
function layoutGrouped(nodes: Node<EntityNodeData>[], edges: Edge[]): Node<EntityNodeData>[] {
  const nested = groupedLayout(
    nodes.map((node) => ({ id: node.id, group: node.data.serviceId ?? node.id })),
    edges,
    { width: NODE_WIDTH, height: NODE_HEIGHT, padding: 16, header: 44 },
  )
  const offsets = new Map(nested.nodes.map((node) => [node.id, node]))

  const containers: Node<EntityNodeData>[] = nested.groups.map((group) => {
    const service = catalog.services.find((item) => item.id === group.id)
    return {
      id: `group:${group.id}`,
      type: 'serviceGroup',
      position: { x: group.x, y: group.y },
      style: { width: group.width, height: group.height },
      data: {
        label: service?.name ?? group.id,
        subtitle: service ? `${service.type} · ${service.role}` : 'Service',
        kind: 'service',
        type: service?.type,
        markType: service?.type,
        state: service?.state,
        entityId: group.id,
      },
    }
  })

  const children = nodes.map((node) => {
    const offset = offsets.get(node.id)
    return {
      ...node,
      parentId: `group:${node.data.serviceId ?? node.id}`,
      extent: 'parent' as const,
      position: { x: offset?.x ?? 0, y: offset?.y ?? 0 },
    }
  })

  return [...containers, ...children]
}

function styledEdge(flow: FlowKind, partial: Omit<Edge, 'markerEnd'> & { animated?: boolean }): Edge {
  const style = flowStyles.get(flow)
  const color = style?.color ?? 'var(--border)'
  return {
    ...partial,
    data: { ...partial.data, flow },
    // React Flow's animation dashes the stroke, which would collide with the dashed/solid channel
    // the two structural kinds rely on to tell each other apart at the same neutral colour.
    animated: partial.animated && !style?.structural,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    style: { stroke: color, strokeWidth: 1.6, strokeDasharray: style?.dashed ? '5 4' : undefined },
  }
}

/**
 * Shared tail of every builder: tally flows, apply the kind filter, narrow to the focused
 * neighbourhood, drop whatever that orphaned, then lay the survivors out.
 */
function finish(
  nodes: Node<EntityNodeData>[],
  edges: Edge[],
  options: GraphOptions | undefined,
  hideIsolated: boolean,
): GraphResult {
  // A focus id from another level would match nothing and blank the canvas, so it is ignored
  // unless the node is actually here.
  const focusId = options?.focusId && nodes.some((node) => node.id === options.focusId) ? options.focusId : undefined

  // Counted over the focused scope but *before* the kind filter, so the legend describes what is
  // in view while still showing a hidden flow's true size, which is what lets you bring it back.
  const scope = focusId ? neighborhood(edges, focusId, options?.depth ?? 1) : undefined
  const counts = emptyCounts()
  for (const edge of edges) {
    if (scope && !(scope.has(edge.source) && scope.has(edge.target))) continue
    const flow = edge.data?.flow as FlowKind | undefined
    if (flow) counts[flow] += 1
  }

  const kinds = options?.kinds
  const kept = kinds ? edges.filter((edge) => kinds.has(edge.data?.flow as FlowKind)) : edges

  let trimmed: { nodes: Node<EntityNodeData>[]; edges: Edge[] }
  if (focusId) {
    const reached = neighborhood(kept, focusId, options?.depth ?? 1)
    trimmed = {
      nodes: nodes.filter((node) => reached.has(node.id)),
      edges: kept.filter((edge) => reached.has(edge.source) && reached.has(edge.target)),
    }
  } else {
    // Hiding a flow strands nodes, so isolates are dropped after the filter rather than before it.
    trimmed = hideIsolated ? dropIsolates(nodes, kept) : { nodes, edges: kept }
  }

  const laidOut = options?.grouped
    ? layoutGrouped(trimmed.nodes, trimmed.edges)
    : layoutWithDagre(trimmed.nodes, trimmed.edges)

  return { nodes: laidOut, edges: trimmed.edges, counts }
}

function dropIsolates(nodes: Node<EntityNodeData>[], edges: Edge[]) {
  const linked = new Set<string>()
  for (const edge of edges) {
    linked.add(edge.source)
    linked.add(edge.target)
  }
  return {
    nodes: nodes.filter((node) => linked.has(node.id)),
    edges,
  }
}

function serviceNode(service: Service): Node<EntityNodeData> {
  return {
    id: service.id,
    type: 'entity',
    position: { x: 0, y: 0 },
    data: {
      label: service.name,
      subtitle: isRuntime(service) ? `Runtime · ${service.role}` : `${service.type} · ${service.role}`,
      kind: isRuntime(service) ? 'runtime' : 'service',
      state: service.state,
      type: service.type,
      markType: service.type,
      entityId: service.id,
    },
  }
}

export function buildServiceGraph(stackId?: string, options?: GraphOptions): GraphResult {
  const stack = stackId ? stackById(stackId) : undefined
  const allowed = stack ? new Set(stack.memberIds) : null
  const services = catalog.services.filter((service) => !allowed || allowed.has(service.id))
  const nodes = services.map(serviceNode)
  const known = new Set(nodes.map((node) => node.id))
  const edges = catalog.integrations
    .filter((integration) => integration.active || integration.type === 'debezium_cdc' || integration.type === 'trino_catalog')
    .map((integration) => {
      const ends = visualEnds(integration)
      return styledEdge(integrationFlow[integration.type], {
        id: integration.id,
        source: ends.source,
        target: ends.target,
        animated: integration.active,
      })
    })
    .filter((edge) => known.has(edge.source) && known.has(edge.target))

  return finish(nodes, edges, options, Boolean(options?.hideIsolated) && !options?.focusId && !stackId)
}

export function buildDatasetGraph(stackId?: string, options?: GraphOptions): GraphResult {
  const stack = stackId ? stackById(stackId) : undefined
  const allowedServices = stack ? new Set(stack.memberIds) : null
  const assets = catalog.assets.filter((asset) => {
    if (allowedServices && !allowedServices.has(asset.serviceId)) return false
    const hasLineage = catalog.lineage.some(
      (edge) => edge.sourceAssetId === asset.id || edge.destAssetId === asset.id,
    )
    if (!stackId && !hasLineage) return false
    return (
      hasLineage ||
      asset.columns.length > 0 ||
      asset.kind === 'topic' ||
      asset.kind === 'table' ||
      asset.kind === 'clickhouse_table' ||
      asset.kind === 'connector' ||
      asset.kind === 'application'
    )
  })

  const nodes: Node<EntityNodeData>[] = assets.map((asset) => ({
    id: asset.id,
    type: 'entity',
    position: { x: 0, y: 0 },
    data: {
      label: asset.name,
      subtitle: `${asset.kind} · ${asset.serviceId}`,
      kind: asset.kind === 'application' ? 'runtime' : 'dataset',
      type: asset.kind,
      hops: catalog.lineage.filter((edge) => edge.sourceAssetId === asset.id || edge.destAssetId === asset.id).length,
      entityId: asset.id,
      serviceId: asset.serviceId,
      markType: serviceById(asset.serviceId)?.type,
    },
  }))

  const known = new Set(assets.map((asset) => asset.id))
  const edges: Edge[] = []
  const seen = new Set<string>()

  for (const edge of catalog.lineage) {
    if (!known.has(edge.sourceAssetId) || !known.has(edge.destAssetId)) continue
    const key = `${edge.sourceAssetId}->${edge.destAssetId}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(
      styledEdge(lineageFlow[edge.kind], {
        id: `ds-${key}`,
        source: edge.sourceAssetId,
        target: edge.destAssetId,
        animated: edge.confidence === 'column',
      }),
    )
  }

  return finish(nodes, edges, options, Boolean(options?.hideIsolated) && !stackId)
}

export function buildColumnGraph(assetId: string, column: string, options?: GraphOptions): GraphResult {
  const hops = columnLineage(assetId, column)
  const ids = new Set<string>([assetId])
  for (const hop of hops) {
    ids.add(hop.sourceAssetId)
    ids.add(hop.destAssetId)
  }

  const assets = [...ids].map(assetById).filter((asset): asset is Asset => Boolean(asset))
  const nodeId = (asset: string, col?: string) => `${asset}:${col ?? '*'}`

  const nodes: Node<EntityNodeData>[] = assets.map((asset) => {
    const hop = hops.find((item) => item.sourceAssetId === asset.id || item.destAssetId === asset.id)
    const col =
      hop?.sourceAssetId === asset.id ? hop.sourceColumn : hop?.destAssetId === asset.id ? hop.destColumn : column
    const field = asset.columns.find((item) => item.name === col)
    return {
      id: nodeId(asset.id, col),
      type: 'entity',
      position: { x: 0, y: 0 },
      data: {
        label: `${asset.name}.${col ?? '•'}`,
        subtitle: field ? field.type : asset.serviceId,
        kind: 'column',
        type: asset.kind,
        markType: serviceById(asset.serviceId)?.type,
        entityId: asset.id,
        serviceId: asset.serviceId,
        column: col,
      },
    }
  })

  // Each hop here is distinct and few in number, so `via` stays on the edge as a label.
  const edges: Edge[] = hops.map((hop) =>
    styledEdge(lineageFlow[hop.kind], {
      id: hop.id,
      source: nodeId(hop.sourceAssetId, hop.sourceColumn),
      target: nodeId(hop.destAssetId, hop.destColumn),
      label: hop.via,
      animated: true,
    }),
  )

  return finish(nodes, edges, options, false)
}
