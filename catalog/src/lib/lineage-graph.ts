import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { catalog } from '@/data/catalog'
import {
  assetById,
  columnLineage,
  isRuntime,
  serviceById,
  stackById,
} from '@/lib/catalog'
import { groupedLayout, layoutBoxes, neighborhood, reachable } from '@/lib/graph-math'
import type { Asset, Column, Integration, IntegrationType, LineageEdge, LineageKind, Service } from '@/types'

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

/**
 * One dataset drawn as its column list, so a column-level edge can land on the column it actually
 * describes. Every column keeps a handle on both sides — an edge whose handle is missing is
 * silently dropped — but `into`/`outOf` say which of them an edge actually arrives at, so the
 * other stays invisible instead of leaving a mark with no line attached.
 */
export type SchemaNodeData = {
  label: string
  subtitle: string
  kind: string
  markType?: string
  entityId: string
  /** The asset whose page this graph is embedded in, so it can be picked out of its neighbours. */
  focused: boolean
  /** Whether a dataset-level edge lands on the header, which is where those without a column go. */
  assetInto: boolean
  assetOutOf: boolean
  columns: { name: string; type: string; constraint: Column['constraint']; into: boolean; outOf: boolean }[]
}

/** Handle id for edges with no column of their own, so they attach to the header instead. */
export const ASSET_HANDLE = '__asset'

// SchemaNode renders these exact sizes; keeping them here means the layout and the component
// cannot drift apart. Height grows with the column list rather than being fixed.
export const SCHEMA_WIDTH = 264
export const SCHEMA_HEADER = 48
export const SCHEMA_ROW = 24
const SCHEMA_BODY_PADDING = 6

export function schemaNodeHeight(columns: number): number {
  return SCHEMA_HEADER + (columns ? columns * SCHEMA_ROW + SCHEMA_BODY_PADDING : 0)
}

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

export type SchemaGraph = {
  nodes: Node<SchemaNodeData>[]
  edges: Edge[]
  /** Whether another hop in that direction would add anything, so the offer can be withheld. */
  moreUpstream: boolean
  moreDownstream: boolean
}

/**
 * Draws a set of assets as column lists joined by the given lineage rows, and lays them out. Both
 * the lineage neighbourhood and the schema's data model are this same picture over a different
 * choice of assets and rows, so the handle wiring lives here once.
 */
function schemaPicture(
  assets: Asset[],
  rows: LineageEdge[],
  focusId?: string,
): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } {
  // A recorded column the asset's own column list does not contain would reference a handle that
  // never renders, and React Flow silently drops such an edge. Falling back to the header keeps
  // the link visible instead.
  const handleFor = (asset: string, column: string | undefined) =>
    column && assetById(asset)?.columns.some((item) => item.name === column) ? column : ASSET_HANDLE

  const edges = rows.map((row) =>
    styledEdge(lineageFlow[row.kind], {
      id: row.id,
      source: row.sourceAssetId,
      target: row.destAssetId,
      sourceHandle: handleFor(row.sourceAssetId, row.sourceColumn),
      targetHandle: handleFor(row.destAssetId, row.destColumn),
      animated: row.confidence === 'column',
    }),
  )

  // Taken from the built edges rather than the raw lineage, so the header fallback above is
  // reflected too and no handle is drawn without a line arriving at it.
  const arrivesAt = new Set(edges.map((edge) => `${edge.target}.${edge.targetHandle}`))
  const leavesFrom = new Set(edges.map((edge) => `${edge.source}.${edge.sourceHandle}`))

  const nodes: Node<SchemaNodeData>[] = assets.map((asset) => ({
    id: asset.id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      label: asset.name,
      subtitle: `${asset.kind} · ${asset.serviceId}`,
      kind: asset.kind,
      markType: serviceById(asset.serviceId)?.type,
      entityId: asset.id,
      focused: asset.id === focusId,
      assetInto: arrivesAt.has(`${asset.id}.${ASSET_HANDLE}`),
      assetOutOf: leavesFrom.has(`${asset.id}.${ASSET_HANDLE}`),
      columns: asset.columns.map((column) => ({
        name: column.name,
        type: column.type,
        constraint: column.constraint,
        into: arrivesAt.has(`${asset.id}.${column.name}`),
        outOf: leavesFrom.has(`${asset.id}.${column.name}`),
      })),
    },
  }))

  const placed = layoutBoxes(
    nodes.map((node) => ({
      id: node.id,
      width: SCHEMA_WIDTH,
      height: schemaNodeHeight(node.data.columns.length),
    })),
    edges,
    { nodesep: 28, ranksep: 140 },
  )

  return {
    nodes: nodes.map((node) => {
      const spot = placed.get(node.id)
      return { ...node, position: { x: spot?.x ?? 0, y: spot?.y ?? 0 } }
    }),
    edges,
  }
}

/**
 * The tables of one schema joined by their foreign keys: the relational model, as opposed to the
 * pipeline the lineage view walks. Returns nothing when no foreign key touches these assets, which
 * is how the page knows not to offer the view — most schemas here are topics, engine tables or
 * append-only logs with no relationships to draw.
 */
export function buildModelGraph(assets: Asset[]): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } {
  const ids = new Set(assets.map((asset) => asset.id))
  const keys = catalog.lineage.filter(
    (row) => row.kind === 'fk' && (ids.has(row.sourceAssetId) || ids.has(row.destAssetId)),
  )
  if (!keys.length) return { nodes: [], edges: [] }

  // A key pointing out of the schema brings its target in: half a relationship is not a model.
  const outside = keys
    .flatMap((row) => [row.sourceAssetId, row.destAssetId])
    .filter((id) => !ids.has(id))
    .map(assetById)
    .filter((asset): asset is Asset => Boolean(asset))

  // Only the tables that take part. A schema's unrelated tables are already listed under Contains,
  // and drawing them here as detached boxes would say less than the list does.
  const related = new Set(keys.flatMap((row) => [row.sourceAssetId, row.destAssetId]))
  return schemaPicture([...assets, ...outside].filter((asset) => related.has(asset.id)), keys)
}

/**
 * The neighbourhood of one asset, drawn column to column. This is the honest picture for a
 * pipeline whose lineage is recorded per column: buildDatasetGraph collapses the 11 links between a
 * topic and its ClickHouse table into a single arrow, which then disagrees with the count beside it.
 *
 * Nodes are assets, not asset-columns, so a table appears once with its whole column list. Edges
 * carry the column names as handle ids; anything recorded only at dataset level lands on the
 * header handle instead.
 *
 * `up` and `down` are hops followed in each direction, defaulting to the direct neighbours.
 */
export function buildSchemaGraph(
  assetId: string,
  { up = 1, down = 1 }: { up?: number; down?: number } = {},
): SchemaGraph {
  const focus = assetById(assetId)
  if (!focus) return { nodes: [], edges: [], moreUpstream: false, moreDownstream: false }

  const links = catalog.lineage.map((edge) => ({ source: edge.sourceAssetId, target: edge.destAssetId }))
  const upstream = reachable(links, assetId, up, 'backward')
  const downstream = reachable(links, assetId, down, 'forward')
  const ids = new Set([...upstream, ...downstream])

  // Every edge between two included assets, not only those touching the focus: with more than one
  // hop in view, the links among the neighbours are part of the same story.
  const touching = catalog.lineage.filter(
    (edge) => ids.has(edge.sourceAssetId) && ids.has(edge.destAssetId),
  )
  const assets = [...ids].map(assetById).filter((asset): asset is Asset => Boolean(asset))

  // An unfollowed edge hanging off the boundary is what makes another hop worth offering. Measured
  // against everything on screen, not just this direction's own set, so a hop that would only
  // re-draw a dataset the other direction already reached is not offered.
  const moreUpstream = links.some((link) => upstream.has(link.target) && !ids.has(link.source))
  const moreDownstream = links.some((link) => downstream.has(link.source) && !ids.has(link.target))

  return { ...schemaPicture(assets, touching, assetId), moreUpstream, moreDownstream }
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
