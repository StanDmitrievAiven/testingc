import { catalog } from '@/data/catalog'
import type { Asset, LineageEdge, Service, Stack } from '@/types'

export function isRuntime(service: Service): boolean {
  return service.type === 'application'
}

export function managedServices(): Service[] {
  return catalog.services.filter((s) => !isRuntime(s))
}

export function runtimes(): Service[] {
  return catalog.services.filter(isRuntime)
}

export function serviceById(id: string): Service | undefined {
  return catalog.services.find((s) => s.id === id)
}

export function assetById(id: string): Asset | undefined {
  return catalog.assets.find((a) => a.id === id)
}

export function stackById(id: string): Stack | undefined {
  return catalog.stacks.find((s) => s.id === id)
}

export function assetsForService(serviceId: string): Asset[] {
  return catalog.assets.filter((a) => a.serviceId === serviceId)
}

export function stacksForService(serviceId: string): Stack[] {
  return catalog.stacks.filter((s) => s.memberIds.includes(serviceId))
}

export function stackMembers(stack: Stack): Service[] {
  return stack.memberIds.map(serviceById).filter((s): s is Service => Boolean(s))
}

export function integrationsFor(serviceId: string) {
  return catalog.integrations.filter(
    (i) => i.sourceServiceId === serviceId || i.destServiceId === serviceId,
  )
}

export function lineageForAsset(assetId: string): { up: LineageEdge[]; down: LineageEdge[] } {
  return {
    up: catalog.lineage.filter((e) => e.destAssetId === assetId),
    down: catalog.lineage.filter((e) => e.sourceAssetId === assetId),
  }
}

export function columnLineage(assetId: string, column: string): LineageEdge[] {
  const seen = new Set<string>()
  const out: LineageEdge[] = []
  const walk = (id: string, col: string) => {
    for (const edge of catalog.lineage) {
      const downstream = edge.sourceAssetId === id && edge.sourceColumn === col
      const upstream = edge.destAssetId === id && edge.destColumn === col
      if ((!downstream && !upstream) || seen.has(edge.id)) continue
      seen.add(edge.id)
      out.push(edge)
      if (downstream && edge.destColumn) walk(edge.destAssetId, edge.destColumn)
      if (upstream && edge.sourceColumn) walk(edge.sourceAssetId, edge.sourceColumn)
    }
  }
  walk(assetId, column)
  return out
}

export function searchAll(query: string) {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { services: catalog.services, assets: catalog.assets, stacks: catalog.stacks }
  }
  return {
    services: catalog.services.filter((s) =>
      [s.name, s.type, s.role, s.plan, s.notes].filter(Boolean).join(' ').toLowerCase().includes(q),
    ),
    assets: catalog.assets.filter((asset) =>
      [
        asset.name,
        asset.qualifiedName,
        asset.description,
        asset.schema,
        asset.kind,
        asset.serviceId,
        ...asset.tags,
        ...asset.columns.map((c) => `${c.name} ${c.type}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    ),
    stacks: catalog.stacks.filter((s) =>
      [s.name, s.kind, s.description, ...s.memberIds].join(' ').toLowerCase().includes(q),
    ),
  }
}

export function formatCount(n?: number): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    pg: 'PostgreSQL',
    kafka: 'Kafka',
    kafka_connect: 'Kafka Connect',
    clickhouse: 'ClickHouse',
    opensearch: 'OpenSearch',
    datahub: 'DataHub',
    application: 'Application',
  }
  return labels[type] ?? type
}

export const kindLabel: Record<string, string> = {
  table: 'Table',
  topic: 'Topic',
  clickhouse_table: 'CH table',
  schema: 'Schema',
  connector: 'Connector',
  application: 'App',
  catalog: 'Catalog',
  dataset: 'Dataset',
}

export type TreeNode = {
  id: string
  kind: 'service' | 'database' | 'schema' | 'asset'
  label: string
  serviceId: string
  asset?: Asset
  children?: TreeNode[]
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

function leaves(assets: Asset[]): TreeNode[] {
  return assets.map((asset) => ({
    id: asset.id,
    kind: 'asset',
    label: asset.name,
    serviceId: asset.serviceId,
    asset,
  }))
}

export function catalogTree(services: Service[] = catalog.services): TreeNode[] {
  const byService = groupBy(catalog.assets, (asset) => asset.serviceId)
  return services.map((service) => {
    const assets = byService.get(service.id) ?? []
    const node: TreeNode = {
      id: service.id,
      kind: 'service',
      label: service.name,
      serviceId: service.id,
    }
    // A service with nothing catalogued is a leaf, not an empty folder.
    if (!assets.length) return node
    let children: TreeNode[]
    if (service.type === 'pg') {
      children = [
        {
          id: `${service.id}:defaultdb`,
          kind: 'database',
          label: 'defaultdb',
          serviceId: service.id,
          children: [...groupBy(assets, (asset) => asset.schema ?? 'public')].map(([schema, items]) => ({
            id: `${service.id}:${schema}`,
            kind: 'schema',
            label: schema,
            serviceId: service.id,
            children: leaves(items),
          })),
        },
      ]
    } else if (service.type === 'clickhouse') {
      children = [...groupBy(assets, (asset) => asset.schema ?? 'default')].map(([db, items]) => ({
        id: `${service.id}:${db}`,
        kind: 'database',
        label: db,
        serviceId: service.id,
        children: leaves(items),
      }))
    } else if (service.type === 'kafka') {
      children = [...groupBy(assets, (asset) => asset.schema ?? 'topics')].map(([ns, items]) => ({
        id: `${service.id}:${ns}`,
        kind: 'schema',
        label: ns,
        serviceId: service.id,
        children: leaves(items),
      }))
    } else {
      children = leaves(assets)
    }
    return { ...node, children }
  })
}

export function findTreeNode(id: string, nodes = catalogTree()): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = node.children && findTreeNode(id, node.children)
    if (child) return child
  }
}

export function treeAncestors(id: string, nodes = catalogTree(), trail: string[] = []): string[] {
  for (const node of nodes) {
    const next = [...trail, node.id]
    if (node.id === id) return next
    if (node.children) {
      const hit = treeAncestors(id, node.children, next)
      if (hit.length) return hit
    }
  }
  return []
}

export const stats = {
  services: managedServices().length,
  runtimes: runtimes().length,
  stacks: catalog.stacks.length,
  running: catalog.services.filter((s) => s.state === 'RUNNING').length,
  assets: catalog.assets.length,
  columns: catalog.assets.reduce((n, a) => n + a.columns.length, 0),
  integrations: catalog.integrations.filter((i) => i.active).length,
  lineage: catalog.lineage.length,
}
