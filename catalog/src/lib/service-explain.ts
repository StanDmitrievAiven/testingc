// service_explain: one call that answers "what am I looking at, and what am I allowed to do to it".
//
// It is the decision document from agent-context.ts with the two things that document deliberately
// leaves out, because a person reading a page does not need them and an agent about to act does:
// the full data inventory down to column notes, and lineage in both directions rather than one hop
// downstream.
//
// Composed rather than re-derived. Every shared field is spread from `serviceContext`, so this can
// grow without the two ever disagreeing about a finding, a policy or a plan.
//
// The summary is the part that earns the name. Everything below it is also above it, in a paragraph,
// because a model that has to assemble twenty fields into a sentence before it can reason will
// sometimes assemble them wrong, and the assembling is cheap to do once here.
import { catalog } from '../data/catalog.ts'
import { tagDescription } from '../data/tags.ts'
import type { Asset, Column, Integration, LineageEdge } from '../types.ts'
import { serviceContext, type ServiceContext } from './agent-context.ts'
import { costOf, deletionReview, type AssetCost, type DeletionReview } from './asset-review.ts'
import { assetById, assetsForService, serviceById, typeLabel } from './catalog.ts'
import { assetDescription, columnDescription, tagsFor } from './catalog-edits.ts'
import { reachable } from './graph-math.ts'

/**
 * Tags that stop a read happening at all, and tags that only constrain what may be done with the
 * rows afterwards. The distinction is the whole point: "do not open this" and "do not copy this
 * into a ticket" are different instructions, and collapsing them produces an agent that either
 * ignores both or refuses everything.
 *
 * The reason text is not written here — it is the tag's own description, so the vocabulary stays
 * the single place that says what a tag means.
 */
const forbidsReading = ['agent-blocked', 'credentials', 'pci']
const constrainsUse = [
  'pii',
  'special-category',
  'sensitive',
  'gdpr-erasure',
  'data-residency',
  'internal-only',
  'pseudonymised',
]

export interface ExplainedColumn {
  name: string
  type: string
  constraint?: Column['constraint']
  nullable?: boolean
  note?: string
}

export interface ExplainedAsset {
  id: string
  name: string
  kind: Asset['kind']
  qualifiedName: string
  description: string
  rowCount?: number
  partitions?: number
  replication?: number
  tags: string[]
  columns: ExplainedColumn[]
  /** Whether anything is using it, with the evidence. Never a recommendation to remove it. */
  deletion: DeletionReview
  /** Absent where nothing can be attributed, which is not the same as free. */
  cost?: AssetCost
}

/** One lineage hop, flattened to names an agent can act on rather than graph node ids. */
export interface ExplainedEdge {
  from: string
  to: string
  fromService?: string
  toService?: string
  via: string
  kind: LineageEdge['kind']
  /** `column` means the mapping was read from a real schema; `dataset` means table level only. */
  confidence: LineageEdge['confidence']
  column?: string
}

export interface ExplainedLineage {
  upstreamServices: string[]
  downstreamServices: string[]
  /** Every service downstream at any depth, which is the real answer to "what breaks if I act". */
  reachesEventually: string[]
  inbound: ExplainedEdge[]
  outbound: ExplainedEdge[]
  /** Hops that stay inside this service, counted rather than listed: they break nobody else. */
  internalHops: number
  integrations: {
    type: Integration['type']
    /**
     * Which end of the integration this service is, which is not a data direction: a service is the
     * `source` of an application credential that an app then uses to write *into* it. The flow is
     * in `inbound` and `outbound`; this says how the connection is configured.
     */
    thisServiceIs: 'source' | 'destination'
    peer: string
    active: boolean
    description: string
  }[]
  note: string
}

export interface ExplainedData {
  datasets: number
  columns: number
  assets: ExplainedAsset[]
  note: string
}

export interface DataRule {
  assetId: string
  name: string
  tag: string
  reason: string
}

export interface ServiceExplain extends ServiceContext {
  /** Everything below, in one paragraph, for a reader that will only read one paragraph. */
  summary: string
  data: ExplainedData
  lineage: ExplainedLineage
  boundaries: {
    doNotRead: DataRule[]
    handleCarefully: DataRule[]
    note: string
  }
}

function explainAsset(asset: Asset): ExplainedAsset {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    qualifiedName: asset.qualifiedName,
    description: assetDescription(asset.id, asset.description),
    rowCount: asset.rowCount,
    partitions: asset.partitions,
    replication: asset.replication,
    tags: tagsFor(asset.id, asset.tags),
    columns: asset.columns.map((column) => ({
      name: column.name,
      type: column.type,
      constraint: column.constraint,
      nullable: column.nullable,
      note: columnDescription(asset.id, column.name, column.note ?? '') || undefined,
    })),
    deletion: deletionReview(asset.id)!,
    cost: costOf(asset.id),
  }
}

function explainEdge(edge: LineageEdge): ExplainedEdge {
  return {
    from: edge.sourceAssetId,
    to: edge.destAssetId,
    fromService: assetById(edge.sourceAssetId)?.serviceId,
    toService: assetById(edge.destAssetId)?.serviceId,
    via: edge.via,
    kind: edge.kind,
    confidence: edge.confidence,
    column: edge.sourceColumn,
  }
}

function lineageFor(serviceId: string): ExplainedLineage {
  const own = new Set(assetsForService(serviceId).map((asset) => asset.id))
  const inside = (id: string) => own.has(id)

  const inbound = catalog.lineage.filter((e) => inside(e.destAssetId) && !inside(e.sourceAssetId))
  const outbound = catalog.lineage.filter((e) => inside(e.sourceAssetId) && !inside(e.destAssetId))
  const internalHops = catalog.lineage.filter((e) => inside(e.sourceAssetId) && inside(e.destAssetId)).length

  const serviceOf = (id: string) => assetById(id)?.serviceId
  const others = (ids: string[]) => [...new Set(ids.map(serviceOf).filter((id): id is string => Boolean(id) && id !== serviceId))]

  // Transitive, because one hop answers the wrong question. Restarting a Postgres service stalls
  // the Kafka topics it feeds, and the ClickHouse tables behind those, and whoever reads those.
  const links = catalog.lineage.map((e) => ({ source: e.sourceAssetId, target: e.destAssetId }))
  const eventually = new Set<string>()
  for (const assetId of own) {
    for (const reached of reachable(links, assetId, Infinity, 'forward')) {
      const service = serviceOf(reached)
      if (service && service !== serviceId) eventually.add(service)
    }
  }

  return {
    upstreamServices: others(inbound.map((e) => e.sourceAssetId)),
    downstreamServices: others(outbound.map((e) => e.destAssetId)),
    reachesEventually: [...eventually].sort(),
    inbound: inbound.map(explainEdge),
    outbound: outbound.map(explainEdge),
    internalHops,
    integrations: catalog.integrations
      .filter((i) => i.sourceServiceId === serviceId || i.destServiceId === serviceId)
      .map((i) => ({
        type: i.type,
        thisServiceIs: i.sourceServiceId === serviceId ? ('source' as const) : ('destination' as const),
        peer: i.sourceServiceId === serviceId ? i.destServiceId : i.sourceServiceId,
        active: i.active,
        description: i.description,
      })),
    note:
      'Lineage is catalogued from connector configuration and schemas, not traced at runtime. A `dataset` confidence means the tables are known to be connected without the column mapping being read.',
  }
}

/** The rules that come from the data itself rather than from the operation being attempted. */
function dataRules(assets: ExplainedAsset[], tags: string[]): DataRule[] {
  return assets.flatMap((asset) =>
    asset.tags
      .filter((tag) => tags.includes(tag))
      .map((tag) => ({
        assetId: asset.id,
        name: asset.qualifiedName,
        tag,
        reason: tagDescription(tag) ?? 'Tagged here, with no description in the vocabulary.',
      })),
  )
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** Authored prose is inconsistently punctuated, and two sentences running together read as one. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`
}

/**
 * The brief. Written as sentences that drop out entirely when their fact is missing, so a service
 * nobody has captured reads as short rather than as a paragraph full of "unknown".
 */
function summarise(context: ServiceContext, data: ExplainedData, lineage: ExplainedLineage): string {
  const service = serviceById(context.serviceId)!
  const classified = context.classification
    ? `${context.classification.criticality} in ${context.classification.environment}`
    : 'not classified, so it is treated as production'

  const worst = context.findings[0]
  // Counted as assets rather than as rules: one table tagged both `credentials` and `agent-blocked`
  // produces two rules, and "6 of which" would read as six tables that do not exist.
  const blocked = new Set(dataRules(data.assets, forbidsReading).map((rule) => rule.assetId)).size
  const unused = data.assets.filter((asset) => asset.deletion.verdict === 'no sign of use').length
  const attributed = data.assets.reduce((sum, asset) => sum + (asset.cost?.usdPerMonth ?? 0), 0)

  return [
    `${context.name} is ${typeLabel(context.type)}, currently ${service.state}, ${classified}.`,
    sentence(service.notes ?? service.role),
    data.datasets
      ? `It holds ${data.datasets} catalogued ${data.datasets === 1 ? 'dataset' : 'datasets'} and ${data.columns} described columns.`
      : 'Nothing under it is catalogued, so there is no data inventory to reason about.',
    blocked
      ? `${blocked} of those ${blocked === 1 ? 'datasets holds' : 'datasets hold'} data an agent must not read.`
      : undefined,
    unused
      ? `${unused} ${unused === 1 ? 'shows' : 'show'} no sign of being used by anything this catalog can see, which is a question for their owner rather than a licence to remove them.`
      : undefined,
    attributed
      ? `Statement time and retained bytes account for $${attributed.toFixed(2)} a month of this service's bill.`
      : undefined,
    context.plan.downsize.verdict === 'fits'
      ? `A smaller plan fits: ${context.plan.downsize.because}`
      : context.plan.downsize.monthlyUsdForgone
        ? `A smaller plan would save $${context.plan.downsize.monthlyUsdForgone} a month but ${context.plan.downsize.verdict === 'would not fit' ? 'the data would not fit on it' : 'something contradicts the move'}.`
        : undefined,
    lineage.reachesEventually.length
      ? `Acting here eventually reaches ${list(lineage.reachesEventually)}.`
      : 'Nothing downstream depends on it.',
    context.findings.length
      ? `${context.findings.length} ${context.findings.length === 1 ? 'finding' : 'findings'}, worst: ${worst.title} (${worst.severity}).`
      : 'No findings against it.',
    context.policy.allowed.length
      ? `Unattended, an agent may ${list(context.policy.allowed)}.`
      : 'An agent may not change anything here unattended.',
    // Not "it must never X": the fallback policy forbids "everything else", which only reads as a
    // sentence in a frame that takes a list rather than a verb phrase.
    context.policy.forbidden.length ? `Forbidden: ${list(context.policy.forbidden)}.` : undefined,
    context.freeze.active ? `A change freeze is in force: ${sentence(context.freeze.reason)}` : undefined,
    `Policy basis: ${context.policy.basis}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

export function serviceExplain(serviceId: string): ServiceExplain | undefined {
  const context = serviceContext(serviceId)
  if (!context) return undefined

  const assets = assetsForService(serviceId).map(explainAsset)
  const data: ExplainedData = {
    datasets: assets.length,
    columns: assets.reduce((n, asset) => n + asset.columns.length, 0),
    assets,
    note:
      'Descriptions and tags as catalogued. Edits made in the browser live in that browser and are not in this file.',
  }
  const lineage = lineageFor(serviceId)

  return {
    ...context,
    summary: summarise(context, data, lineage),
    data,
    lineage,
    boundaries: {
      doNotRead: dataRules(assets, forbidsReading),
      handleCarefully: dataRules(assets, constrainsUse),
      note:
        'These come from the data, and apply to reads. What may be done to the service itself is in `policy`, and an operation absent from all three of its lists is one nobody has considered: treat it as forbidden.',
    },
  }
}
