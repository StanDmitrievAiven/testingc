import { useMemo, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon } from 'lucide-react'
import { LineageCanvas } from '@/components/lineage/lineage-canvas'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { catalog } from '@/data/catalog'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { ICON_SIZES } from '@/lib/aiven-service-icons/icons.js'
import { useCatalogEdits } from '@/lib/catalog-edits'
import { ASSET_HANDLE, buildModelGraph, buildSchemaGraph } from '@/lib/lineage-graph'
import {
  formatBytes,
  formatMs,
  lagOf,
  operationsCapturedAt,
  shareOfQueryTime,
  topicHealthFor,
  workloadFor,
} from '@/lib/operations'
import type { Asset, QueryStat, TopicHealth } from '@/types'
import {
  assetsUnder,
  findTreeNode,
  formatCount,
  isRuntime,
  kindLabel,
  lineageForAsset,
  serviceById,
  stacksForService,
  typeLabel,
  type TreeNode,
} from '@/lib/catalog'
import type { Navigate, Route } from '@/lib/routes'
import { cn } from '@/lib/utils'

function EditableText({
  value,
  onSave,
  label,
  multiline,
  placeholder,
}: {
  value: string
  onSave: (value: string) => void
  /** Names the field for the pencil's accessible label, e.g. "description". */
  label: string
  multiline?: boolean
  placeholder?: string
}) {
  // A null draft means "not editing", so the mode and the buffer are one piece of state and there
  // is nothing to re-sync when `value` changes underneath.
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <div className="group flex items-start gap-1" onDoubleClick={() => setDraft(value)}>
        {/* The hint stays on one line even in a cramped table cell; real text wraps as written. */}
        <span className={cn('py-1 text-sm', value ? 'whitespace-pre-wrap' : 'whitespace-nowrap text-muted-foreground')}>
          {value || placeholder}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit ${label}`}
          title="Edit (or double-click)"
          className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setDraft(value)}
        >
          <PencilIcon />
        </Button>
      </div>
    )
  }

  const submit = () => {
    if (draft !== value) onSave(draft)
    setDraft(null)
  }

  return (
    <form
      className="flex flex-col items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft(null)
      }}
    >
      {multiline ? (
        <Textarea
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          // Enter is a newline in a textarea, so submitting from the keyboard needs the modifier.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
        />
      ) : (
        <Input autoFocus value={draft} placeholder={placeholder} onValueChange={setDraft} />
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Inspector({ node, navigate }: { node: TreeNode; navigate: Navigate }) {
  const [tab, setTab] = useState('overview')
  const service = serviceById(node.serviceId)
  const asset = node.asset
  const hops = asset ? lineageForAsset(asset.id) : { up: [], down: [] }
  const connected = hops.up.length + hops.down.length
  const stacks = stacksForService(node.serviceId)
  const edits = useCatalogEdits()
  // A folder describes itself now; only a service node still speaks for its service.
  const description = asset
    ? edits.assetDescription(asset.id, asset.description)
    : (node.description ?? service?.notes ?? service?.role ?? 'Folder in the project catalog.')

  // Both are captured per resource, so a table with no recorded statements and every non-topic
  // simply never offers the tab.
  const workload = asset ? workloadFor(asset.serviceId, asset.name) : []
  const health = asset ? topicHealthFor(asset.id) : undefined

  // Relational folders only: the builder returns nothing when no foreign key joins these tables,
  // which is most of them here — topics, engine tables and append-only logs have no model to draw.
  const model = useMemo(() => (asset ? null : buildModelGraph(assetsUnder(node))), [asset, node])

  const tabs = asset
    ? [
        { value: 'overview', label: 'Overview' },
        { value: 'columns', label: `Columns · ${asset.columns.length}` },
        { value: 'lineage', label: `Lineage · ${connected}` },
        ...(workload.length ? [{ value: 'workload', label: `Workload · ${workload.length}` }] : []),
        ...(health ? [{ value: 'delivery', label: 'Delivery' }] : []),
      ]
    : [
        { value: 'overview', label: 'Overview' },
        { value: 'contains', label: `Contains · ${node.children?.length ?? 0}` },
        ...(model?.edges.length ? [{ value: 'model', label: 'Data model' }] : []),
      ]
  // The inspector stays mounted while you browse the tree, so the open tab can outlive the node
  // that offered it.
  const active = tabs.some((item) => item.value === tab) ? tab : 'overview'

  const identifier = asset?.qualifiedName ?? (node.id.includes(':') ? node.id.replace(':', ' · ') : undefined)

  const facts: [string, string][] = asset
    ? [
        ['Service', service?.name ?? node.serviceId],
        ['Type', service ? typeLabel(service.type) : '—'],
        ['Schema', asset.schema ?? '—'],
        ['Columns', String(asset.columns.length)],
        ['Rows', formatCount(asset.rowCount)],
        ...(asset.partitions != null ? ([['Partitions', String(asset.partitions)]] as [string, string][]) : []),
        ...(asset.replication != null ? ([['Replication', String(asset.replication)]] as [string, string][]) : []),
      ]
    : [
        ['Kind', node.kind],
        ['Service', service?.name ?? node.serviceId],
        ['Type', service ? typeLabel(service.type) : '—'],
        ['Plan', service?.plan ?? '—'],
        ['Children', String(node.children?.length ?? 0)],
        ['State', service?.state ?? '—'],
      ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {service ? (
          <ServiceIcon type={service.type} label={typeLabel(service.type)} size={ICON_SIZES.detailHeader} />
        ) : null}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-large-heading">{node.label}</h1>
            <Badge variant="secondary" className="capitalize">
              {asset ? (kindLabel[asset.kind] ?? asset.kind) : node.kind}
            </Badge>
          </div>
          {/* Folder ids are `service:folder`; a service's own id is just the title again, so it is dropped. */}
          {identifier ? <code className="font-mono text-xs text-muted-foreground">{identifier}</code> : null}
        </div>
      </div>

      {asset ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Description</span>
          <EditableText
            multiline
            label="description"
            value={description}
            placeholder="Add a description"
            onSave={(value) => edits.setAssetDescription(asset.id, value)}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {asset?.tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {asset.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {service ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(service.type === 'application' ? { page: 'application', id: service.id } : { page: 'service', id: service.id })
            }
          >
            Open service
          </Button>
        ) : null}
        {asset ? (
          <Button size="sm" onClick={() => navigate({ page: 'lineage', assetId: asset.id, column: asset.columns[0]?.name })}>
            Open lineage
          </Button>
        ) : null}
        {stacks.map((stack) => (
          <Button key={stack.id} variant="outline" size="sm" onClick={() => navigate({ page: 'stack', id: stack.id })}>
            Stack: {stack.name}
          </Button>
        ))}
      </div>

      <Tabs value={active} onValueChange={(value) => setTab(String(value))}>
        <TabsList variant="line">
          {tabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {facts.map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-base">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
        </TabsContent>

        {asset ? (
          <TabsContent value="columns" className="pt-4">
            {asset.columns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Constraint</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {asset.columns.map((col) => (
                    <TableRow key={col.name}>
                      <TableCell className="font-medium">{col.name}</TableCell>
                      <TableCell className="font-mono text-xs">{col.type}</TableCell>
                      <TableCell>{col.nullable === false ? 'no' : 'yes'}</TableCell>
                      <TableCell>{col.constraint ?? '—'}</TableCell>
                      <TableCell>
                        <EditableText
                          label={`${col.name} description`}
                          value={edits.columnDescription(asset.id, col.name, col.note ?? '')}
                          placeholder="Add description"
                          onSave={(value) => edits.setColumnDescription(asset.id, col.name, value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">This asset has no columns recorded.</p>
            )}
          </TabsContent>
        ) : null}

        {asset ? (
          <TabsContent value="lineage" className="pt-4">
            {/* Keyed by asset so walking to a neighbour starts from its own neighbourhood again
                rather than inheriting however far the last one was expanded. */}
            {active === 'lineage' ? <AssetLineage key={asset.id} asset={asset} navigate={navigate} /> : null}
          </TabsContent>
        ) : null}

        {workload.length ? (
          <TabsContent value="workload" className="pt-4">
            <WorkloadPanel stats={workload} />
          </TabsContent>
        ) : null}

        {health ? (
          <TabsContent value="delivery" className="pt-4">
            <DeliveryPanel health={health} />
          </TabsContent>
        ) : null}

        {!asset ? (
          <TabsContent value="contains" className="pt-4">
            {node.children?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Contents</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {node.children.map((child) => (
                    <TableRow
                      key={child.id}
                      className="cursor-pointer"
                      onClick={() => navigate({ page: 'catalog', assetId: child.id })}
                    >
                      <TableCell>
                        <div className="font-medium">{child.label}</div>
                        {child.asset ? (
                          <div className="text-xs text-muted-foreground">
                            {edits.assetDescription(child.asset.id, child.asset.description)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {child.asset ? (kindLabel[child.asset.kind] ?? child.asset.kind) : child.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {child.asset
                          ? `${child.asset.columns.length} columns`
                          : `${child.children?.length ?? 0} items`}
                      </TableCell>
                      <TableCell className="text-right">
                        {child.asset ? formatCount(child.asset.rowCount) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing catalogued under this folder.</p>
            )}
          </TabsContent>
        ) : null}

        {model?.edges.length ? (
          <TabsContent value="model" className="pt-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {model.nodes.length} related {model.nodes.length === 1 ? 'table' : 'tables'} joined by{' '}
                {model.edges.length} foreign {model.edges.length === 1 ? 'key' : 'keys'}. Tables with no
                relationships are under Contains. Drag to rearrange, fold a column list with its chevron, or
                click a table to open it.
              </p>
              <div className="h-[520px]">
                <LineageCanvas
                  graphKey={`model-${node.id}`}
                  nodes={model.nodes}
                  edges={model.edges}
                  onSelect={(entity) => navigate({ page: 'catalog', assetId: entity.entityId })}
                />
              </div>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}

function WorkloadPanel({ stats }: { stats: QueryStat[] }) {
  const heaviest = stats[0]
  const share = shareOfQueryTime(heaviest)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        What actually runs against this table, from <code className="font-mono text-xs">pg_stat_statements</code>,
        cumulative since the counters were last reset. The heaviest statement has taken{' '}
        <span className="font-medium text-foreground">{formatMs(heaviest.totalMs)}</span> of database time, which is{' '}
        {(share * 100).toFixed(1)}% of everything this service has run.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Statement</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Mean</TableHead>
            <TableHead className="text-right">Slowest</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((stat) => {
            const stake = shareOfQueryTime(stat)
            return (
              <TableRow key={stat.id}>
                <TableCell>
                  <pre className="max-w-[46ch] whitespace-pre-wrap font-mono text-xs">{stat.sql}</pre>
                </TableCell>
                <TableCell className="text-right">{formatCount(stat.calls)}</TableCell>
                {/* A statement averaging over 100ms is the one worth looking at first. */}
                    <TableCell className={cn('text-right', stat.meanMs > 100 && 'font-medium text-warning')}>
                  {formatMs(stat.meanMs)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{formatMs(stat.maxMs)}</TableCell>
                <TableCell className="text-right">{formatMs(stat.totalMs)}</TableCell>
                <TableCell className="text-right">
                  {stake < 0.001 ? '<0.1%' : `${(stake * 100).toFixed(1)}%`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DeliveryPanel({ health }: { health: TopicHealth }) {
  const { lag, retained, bytes } = lagOf(health)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Consumer group <code className="font-mono text-xs">{health.consumerGroup}</code>{' '}
        {lag === 0 ? (
          <span className="font-medium text-foreground">is level with the log</span>
        ) : (
          <span className="font-medium text-foreground">is {formatCount(lag)} messages behind</span>
        )}
        . Retention is {health.retentionHours} hours, so about {formatCount(retained)} messages ({formatBytes(bytes)})
        can still be replayed — anything older has already been deleted.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partition</TableHead>
            <TableHead className="text-right">Earliest</TableHead>
            <TableHead className="text-right">Latest</TableHead>
            <TableHead className="text-right">Consumer at</TableHead>
            <TableHead className="text-right">Lag</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">In sync</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {health.partitions.map((partition) => (
            <TableRow key={partition.partition}>
              <TableCell className="font-medium">{partition.partition}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {partition.earliestOffset.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">{partition.latestOffset.toLocaleString()}</TableCell>
              <TableCell className="text-right">{partition.consumerOffset.toLocaleString()}</TableCell>
              <TableCell className="text-right">{partition.latestOffset - partition.consumerOffset}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatBytes(partition.sizeBytes)}</TableCell>
              <TableCell className="text-right">
                {partition.isr}/{health.replication}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Replication {health.replication} with min in-sync replicas {health.minInsyncReplicas}. Offsets move
        constantly; these were read at {new Date(operationsCapturedAt).toLocaleString()}.
      </p>
    </div>
  )
}

function AssetLineage({ asset, navigate }: { asset: Asset; navigate: Navigate }) {
  // Hops followed in each direction, drawn column to column. One hop is the direct neighbourhood,
  // which is all most assets have; the webshop pipeline runs app to Postgres to topic to
  // ClickHouse, so the buttons below open it up a hop at a time in whichever direction has more.
  const [depth, setDepth] = useState({ up: 1, down: 1 })
  const graph = buildSchemaGraph(asset.id, depth)

  if (!graph.edges.length) {
    return <p className="text-sm text-muted-foreground">No lineage recorded for this asset.</p>
  }

  // The count beside the tab is a count of links, so the sentence has to say which kind they are,
  // or 11 links between two datasets reads as 11 missing nodes.
  const perColumn = graph.edges.filter((edge) => edge.sourceHandle !== ASSET_HANDLE).length
  const perDataset = graph.edges.length - perColumn
  const others = graph.nodes.length - 1
  const expanded = depth.up > 1 || depth.down > 1

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {perColumn ? `${perColumn} column-level ${perColumn === 1 ? 'link' : 'links'}` : 'No column-level links'}
        {perDataset ? ` and ${perDataset} recorded only at dataset level` : ''}, across {others}{' '}
        {others === 1 ? 'other dataset' : 'other datasets'}
        {expanded ? `, ${depth.up} up and ${depth.down} down from ${asset.name}` : ''}. Drag to
        rearrange, fold a column list with its chevron, or click a node to walk to it.
      </p>

      {/* Only offered while there is something left to reach, so an exhausted direction says so by
          having no button rather than by redrawing the same graph. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!graph.moreUpstream}
          onClick={() => setDepth((was) => ({ ...was, up: was.up + 1 }))}
        >
          <ArrowLeftIcon />
          {graph.moreUpstream ? 'Further upstream' : 'No more upstream'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!graph.moreDownstream}
          onClick={() => setDepth((was) => ({ ...was, down: was.down + 1 }))}
        >
          {graph.moreDownstream ? 'Further downstream' : 'No more downstream'}
          <ArrowRightIcon />
        </Button>
        {expanded ? (
          <Button size="sm" variant="ghost" onClick={() => setDepth({ up: 1, down: 1 })}>
            Direct neighbours only
          </Button>
        ) : null}
      </div>

      {/* Taller once expanded: three hops of column lists do not read at the height two do. */}
      <div className={expanded ? 'h-[620px]' : 'h-[460px]'}>
        <LineageCanvas
          // Remounts on every depth change so the new nodes get laid out rather than piled at
          // the origin. Drag positions are the cost, and re-laying out is the point of the click.
          graphKey={`asset-${asset.id}-${depth.up}-${depth.down}`}
          nodes={graph.nodes}
          edges={graph.edges}
          onSelect={(entity) => navigate({ page: 'catalog', assetId: entity.entityId })}
        />
      </div>
    </div>
  )
}

export function CatalogPage({ navigate, assetId }: { navigate: Navigate; assetId?: string }) {
  const selected = assetId ? findTreeNode(assetId) : undefined
  const service = selected ? serviceById(selected.serviceId) : undefined
  const serviceRoute: Route | undefined = service
    ? isRuntime(service)
      ? { page: 'application', id: service.id }
      : { page: 'service', id: service.id }
    : undefined

  return (
    <>
      <PageHeader
        crumbs={[
          { label: catalog.project, onClick: () => navigate({ page: 'overview' }) },
          ...(service && serviceRoute
            ? [{ label: service.name, onClick: () => navigate(serviceRoute) }]
            : []),
          { label: selected?.label ?? 'Catalog' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {selected ? (
          <Inspector node={selected} navigate={navigate} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Pick an asset</EmptyTitle>
              <EmptyDescription>
                Use the explorer to browse service → database → schema → table, or a Kafka topic.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  )
}
