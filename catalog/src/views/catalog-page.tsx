import { useState } from 'react'
import { PencilIcon } from 'lucide-react'
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
import { buildDatasetGraph } from '@/lib/lineage-graph'
import type { Asset, LineageEdge } from '@/types'
import {
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
  const description = asset
    ? edits.assetDescription(asset.id, asset.description)
    : (service?.notes ?? service?.role ?? 'Folder in the project catalog.')

  const tabs = asset
    ? [
        { value: 'overview', label: 'Overview' },
        { value: 'columns', label: `Columns · ${asset.columns.length}` },
        { value: 'lineage', label: `Lineage · ${connected}` },
      ]
    : [
        { value: 'overview', label: 'Overview' },
        { value: 'contains', label: `Contains · ${node.children?.length ?? 0}` },
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
            {active === 'lineage' ? <AssetLineage asset={asset} hops={hops} navigate={navigate} /> : null}
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
      </Tabs>
    </div>
  )
}

function AssetLineage({
  asset,
  hops,
  navigate,
}: {
  asset: Asset
  hops: { up: LineageEdge[]; down: LineageEdge[] }
  navigate: Navigate
}) {
  // buildDatasetGraph drops assets that have no lineage, and an unmatched focus id falls back to
  // the whole project graph — so an asset with no hops must never reach the canvas.
  if (!hops.up.length && !hops.down.length) {
    return <p className="text-sm text-muted-foreground">No lineage recorded for this asset.</p>
  }
  // One hop keeps the embedded canvas readable, and clicking a node re-centres the graph on it, so
  // the neighbourhood is walked a hop at a time. The lineage page is there for the whole picture.
  const graph = buildDatasetGraph(undefined, { focusId: asset.id, depth: 1 })

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {hops.up.length} upstream · {hops.down.length} downstream. Direct neighbours of {asset.name} — drag to
        rearrange, click a node to walk to it.
      </p>
      <div className="h-[400px]">
        <LineageCanvas
          graphKey={`asset-${asset.id}`}
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
