// Relative rather than `@/`, on the same grounds as lib/operations.ts: it lets this run under plain
// node, so the checks and the agent-context emitter can reuse blastRadius instead of copying it.
import { catalog, folderDescriptions } from '../data/catalog.ts'
import { serviceEvents, serviceFacts } from '../data/operations.ts'
import type { Asset, Column, LineageEdge, Owner, Service, Stack } from '../types.ts'
import { assetDescription, columnDescription, columnTagsFor, ownersFor, tagsFor } from './catalog-edits.ts'

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

export interface BlastRadius {
  datasets: number
  downstreamAssets: string[]
  downstreamServices: string[]
  credentialHolders: string[]
  stacks: string[]
}

/**
 * What stops working if this service does. Every part is already in the snapshot: the datasets it
 * holds, the datasets fed from them, the applications Aiven hands its credentials to, and the
 * stacks it belongs to. Lineage is mostly column-level, so destinations are deduplicated.
 */
export function blastRadius(serviceId: string): BlastRadius {
  const own = new Set(assetsForService(serviceId).map((asset) => asset.id))
  const downstream = catalog.lineage.filter(
    (edge) => own.has(edge.sourceAssetId) && !own.has(edge.destAssetId),
  )
  const destServices = downstream
    .map((edge) => assetById(edge.destAssetId)?.serviceId)
    .filter((id): id is string => Boolean(id) && id !== serviceId)

  return {
    datasets: own.size,
    downstreamAssets: [...new Set(downstream.map((edge) => edge.destAssetId))],
    downstreamServices: [...new Set(destServices)],
    credentialHolders: [
      ...new Set(
        catalog.integrations
          .filter((i) => i.sourceServiceId === serviceId && i.type === 'application_service_credential')
          .map((i) => i.destServiceId),
      ),
    ],
    stacks: stacksForService(serviceId).map((stack) => stack.name),
  }
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

/**
 * A match, with the field it matched on. Which field it was changes how a result reads: a hit on a
 * description is a different kind of answer from a hit on a name, and a search that cannot tell you
 * which one it found is asking you to guess.
 */
export interface Hit<T> {
  item: T
  why: string
  /** Carried on the hit so a result can warn before it is opened, not after. */
  tags: string[]
}

export interface SearchHits {
  services: Hit<Service>[]
  assets: Hit<Asset>[]
  columns: Hit<{ asset: Asset; column: Column }>[]
  stacks: Hit<Stack>[]
}

/** The tags that change what a reader or an agent should do, rather than merely describing. */
export const behaviourTags = ['agent-blocked', 'pii', 'credentials', 'secret']

function matched(q: string, fields: [label: string, value: string | undefined][]): string | undefined {
  // Ordered by how well the field explains the hit, so a name match never reports as a note match.
  for (const [label, value] of fields) {
    if (value && value.toLowerCase().includes(q)) return label
  }
  return undefined
}

/** `tag:pi` matches `pii` while it is still being typed, which is when filtering is most useful. */
function taggedWith(term: string, tags: string[]): string | undefined {
  const hit = tags.find((tag) => tag.startsWith(term))
  return hit ? `tag: ${hit}` : undefined
}

/**
 * Ownership matches through inheritance, so searching for a team finds the tables under the schema
 * they own rather than only the schema itself. The reason it matched says where it came from: a
 * hit through inheritance is a weaker claim than one set on the table.
 */
function ownedBy(term: string, id: string): string | undefined {
  const { owners, inheritedFrom } = resolveOwners(id)
  const hit = owners.find((owner) => owner.name.toLowerCase().includes(term))
  if (!hit) return undefined
  return inheritedFrom ? `owner: ${hit.name}, via ${displayName(inheritedFrom)}` : `owner: ${hit.name}`
}

/**
 * Search across everything the catalog knows, not only the names.
 *
 * Names are the worst thing to search when naming is the problem — the case that prompted this was
 * a set of Kafka topics called `F1_2` with no description anywhere. So descriptions, tags, column
 * notes and technical contacts are all searchable, and `tag:pii` filters to a tag across services.
 *
 * Tags come from the edit store where a person has set them, so a tag added in the UI is findable
 * immediately. Under Node the store reads empty, and search falls back to the snapshot.
 *
 * On exposure: this searches names and descriptions of tables and columns, which can themselves be
 * sensitive — a table named after a customer says something before anybody opens it. That is a
 * property of the catalog rather than of the search, but it is the search that makes it reachable,
 * so it is worth stating where somebody will read it.
 */
export function searchAll(query: string): SearchHits {
  const raw = query.trim().toLowerCase()
  const tagQuery = raw.startsWith('tag:') ? raw.slice(4).trim() : undefined
  const ownerQuery = raw.startsWith('owner:') ? raw.slice(6).trim() : undefined
  const q = tagQuery ?? ownerQuery ?? raw

  const assetTags = (asset: Asset) => tagsFor(asset.id, asset.tags)
  const serviceTags = (service: Service) => tagsFor(service.id)

  if (!q) {
    return {
      services: catalog.services.map((item) => ({ item, why: '', tags: serviceTags(item) })),
      assets: catalog.assets.map((item) => ({ item, why: '', tags: assetTags(item) })),
      columns: [],
      stacks: catalog.stacks.map((item) => ({ item, why: '', tags: [] })),
    }
  }

  const services: Hit<Service>[] = []
  for (const item of catalog.services) {
    const tags = serviceTags(item)
    const why = tagQuery
      ? taggedWith(q, tags)
      : ownerQuery
        ? ownedBy(q, item.id)
        : (taggedWith(q, tags) ??
          ownedBy(q, item.id) ??
          matched(q, [
            ['name', item.name],
            ['purpose', item.role],
            ['type', item.type],
            ['plan', item.plan],
            ['notes', item.notes],
            // Observed contacts, kept separate from declared owners: one is who touched it, the
            // other is who answers for it.
            ['contact', serviceFacts.find((f) => f.serviceId === item.id)?.techEmails.join(' ')],
          ]))
    if (why) services.push({ item, why, tags })
  }

  const assets: Hit<Asset>[] = []
  const columns: Hit<{ asset: Asset; column: Column }>[] = []
  for (const item of catalog.assets) {
    const tags = assetTags(item)
    const description = assetDescription(item.id, item.description)
    const why = tagQuery
      ? taggedWith(q, tags)
      : ownerQuery
        ? ownedBy(q, item.id)
        : (taggedWith(q, tags) ??
          ownedBy(q, item.id) ??
          matched(q, [
            ['name', item.name],
            ['path', item.qualifiedName],
            ['description', description],
            ['schema', item.schema],
            ['kind', item.kind],
            ['service', item.serviceId],
          ]))
    if (why) assets.push({ item, why, tags })

    // Columns are searched in their own right: the question is usually "where does this project
    // keep email addresses", and the answer is a column rather than the table holding it.
    for (const column of item.columns) {
      const columnTags = columnTagsFor(item.id, column.name)
      const note = columnDescription(item.id, column.name, column.note ?? '')
      // Columns have no owner of their own: ownership is a dataset-level answer, and a per-column
      // owner is a level of detail nobody maintains. An `owner:` search skips them entirely.
      const columnWhy = ownerQuery
        ? undefined
        : tagQuery
          ? taggedWith(q, columnTags)
          : (taggedWith(q, columnTags) ??
          matched(q, [
            ['name', column.name],
            ['description', note],
            ['type', column.type],
          ]))
      if (columnWhy) columns.push({ item: { asset: item, column }, why: columnWhy, tags: columnTags })
    }
  }

  const stacks: Hit<Stack>[] = []
  for (const item of catalog.stacks) {
    if (tagQuery || ownerQuery) continue
    const why = matched(q, [
      ['name', item.name],
      ['description', item.description],
      ['kind', item.kind],
      ['members', item.memberIds.join(' ')],
    ])
    if (why) stacks.push({ item, why, tags: [] })
  }

  return { services, assets, columns, stacks }
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
  /** Only folders carry one: services and assets already describe themselves. */
  description?: string
  asset?: Asset
  children?: TreeNode[]
}

export function folderDescription(id: string): string {
  return folderDescriptions[id] ?? 'Folder in the project catalog.'
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
          description: folderDescription(`${service.id}:defaultdb`),
          children: [...groupBy(assets, (asset) => asset.schema ?? 'public')].map(([schema, items]) => ({
            id: `${service.id}:${schema}`,
            kind: 'schema',
            label: schema,
            serviceId: service.id,
            description: folderDescription(`${service.id}:${schema}`),
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
        description: folderDescription(`${service.id}:${db}`),
        children: leaves(items),
      }))
    } else if (service.type === 'kafka') {
      children = [...groupBy(assets, (asset) => asset.schema ?? 'topics')].map(([ns, items]) => ({
        id: `${service.id}:${ns}`,
        kind: 'schema',
        label: ns,
        serviceId: service.id,
        description: folderDescription(`${service.id}:${ns}`),
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

/** Every asset below a node, so a database folder speaks for the schemas nested under it too. */
export function assetsUnder(node: TreeNode): Asset[] {
  return node.asset ? [node.asset] : (node.children ?? []).flatMap(assetsUnder)
}

export interface ResolvedOwners {
  owners: Owner[]
  /** Set when the owners came from further up the tree. Inheritance has to be shown as inheritance. */
  inheritedFrom?: string
}

/**
 * Who owns a thing, falling back up the tree: a table with no owner belongs to whoever owns its
 * schema, then its database, then the service. Without this, ownership means editing ninety-four
 * tables by hand, which is the reason ownership fields sit empty in every catalog that has one.
 *
 * The nearest owner wins, so setting one on a single table overrides the schema rather than adding
 * to it — the question being answered is "who do I tell", and two answers is worse than one.
 */
export function resolveOwners(id: string): ResolvedOwners {
  const own = ownersFor(id)
  if (own.length) return { owners: own }
  // The trail runs root-first and includes the node itself, so drop it and walk back up.
  for (const ancestor of treeAncestors(id).slice(0, -1).reverse()) {
    const inherited = ownersFor(ancestor)
    if (inherited.length) return { owners: inherited, inheritedFrom: ancestor }
  }
  return { owners: [] }
}

/**
 * People Aiven has actually seen on this project: its technical contacts, and whoever the event log
 * shows changing something. Offered as suggestions so the common case is a click, and kept as
 * suggestions only — being visible in an audit log is not the same as agreeing to own anything.
 */
export function observedPeople(): Owner[] {
  const emails = new Set([
    ...serviceFacts.flatMap((f) => f.techEmails),
    ...serviceEvents.map((event) => event.actor).filter((actor) => actor.includes('@')),
  ])
  return [...emails].sort().map((name) => ({ name, kind: 'person' as const }))
}

/** Everyone already named anywhere in this catalog, so the second assignment is one click. */
export function knownOwners(): Owner[] {
  const byName = new Map<string, Owner>()
  for (const id of [...catalog.services.map((s) => s.id), ...catalog.assets.map((a) => a.id), ...Object.keys(folderDescriptions)]) {
    for (const owner of ownersFor(id)) byName.set(owner.name.toLowerCase(), owner)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The name to show for anything ownable, since `pg-37c7de3b:public` is an id rather than a place. */
export function displayName(id: string): string {
  const service = serviceById(id)
  if (service) return service.name
  const asset = catalog.assets.find((a) => a.id === id)
  if (asset) return asset.name
  const label = (nodes: TreeNode[]): string | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node.label
      const hit = node.children ? label(node.children) : undefined
      if (hit) return hit
    }
    return undefined
  }
  return label(catalogTree()) ?? id
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
