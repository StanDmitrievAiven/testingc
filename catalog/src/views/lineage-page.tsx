import { useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LineageCanvas } from '@/components/lineage/lineage-canvas'
import { PageHeader } from '@/components/page-header'
import { catalog } from '@/data/catalog'
import { assetById, isRuntime, serviceById } from '@/lib/catalog'
import {
  buildColumnGraph,
  buildDatasetGraph,
  buildServiceGraph,
  flowKinds,
  type EntityNodeData,
  type FlowKind,
  type GraphLevel,
} from '@/lib/lineage-graph'
import type { Navigate } from '@/lib/routes'
import { cn } from '@/lib/utils'

const featuredColumns = [
  { assetId: 'pg.public.customers', column: 'email' },
  { assetId: 'pg.public.orders', column: 'total' },
  { assetId: 'pg.public.order_items', column: 'product_id' },
  { assetId: 'pg.marketing.campaigns', column: 'budget_eur' },
]

const stackItems = [
  { label: 'All stacks', value: 'all' },
  ...catalog.stacks.map((stack) => ({ label: stack.name, value: stack.id })),
]

export function LineagePage({
  navigate,
  stackId,
  assetId,
  column,
}: {
  navigate: Navigate
  stackId?: string
  assetId?: string
  column?: string
}) {
  // The URL decides the level, and a manual pick only overrides it for that same URL. Otherwise
  // arriving from ⌘K or the catalog with a column would leave the toggle on whatever was last
  // clicked, and the deep link would look like it did nothing.
  const urlKey = `${assetId ?? ''}|${column ?? ''}`
  const [picked, setPicked] = useState<{ urlKey: string; level: GraphLevel }>()
  const level: GraphLevel =
    picked?.urlKey === urlKey ? picked.level : column ? 'columns' : assetId ? 'datasets' : 'services'
  const setLevel = (next: GraphLevel) => setPicked({ urlKey, level: next })
  const [hideIsolated, setHideIsolated] = useState(true)
  const [hidden, setHidden] = useState<Set<FlowKind>>(new Set())
  const [focus, setFocus] = useState<{ id: string; label: string; kind: EntityNodeData['kind'] }>()
  const [depth, setDepth] = useState(1)
  const [grouped, setGrouped] = useState(false)

  const graph = useMemo(() => {
    // An empty `hidden` means "no filter at all", which is cheaper than passing every kind.
    const kinds = hidden.size
      ? new Set(flowKinds.map((flow) => flow.kind).filter((kind) => !hidden.has(kind)))
      : undefined
    const options = { hideIsolated: hideIsolated && !stackId, kinds, focusId: focus?.id, depth }
    if (level === 'columns') return buildColumnGraph(assetId ?? 'pg.public.orders', column ?? 'total', options)
    // Grouping only means something where nodes have an owning service to be grouped into.
    if (level === 'datasets') return buildDatasetGraph(stackId, { ...options, grouped })
    return buildServiceGraph(stackId, options)
  }, [level, stackId, assetId, column, hideIsolated, hidden, focus, depth, grouped])

  const toggleKind = (kind: FlowKind) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(kind)) next.add(kind)
      return next
    })

  // Open the focused entity's own page: assets live in the catalog inspector, services do not.
  const openFocused = () => {
    if (!focus) return
    if (level === 'datasets') {
      navigate({ page: 'catalog', assetId: focus.id })
      return
    }
    navigate(focus.kind === 'runtime' ? { page: 'application', id: focus.id } : { page: 'service', id: focus.id })
  }

  const focusAsset = assetId ? assetById(assetId) : undefined

  return (
    <>
      <PageHeader
        crumbs={[
          { label: catalog.project, onClick: () => navigate({ page: 'overview' }) },
          { label: 'Lineage' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
          <ToggleGroup
            value={[level]}
            onValueChange={(value) => {
              const next = value[0] as GraphLevel | undefined
              if (!next) return
              setLevel(next)
              // A focus id belongs to one level's node set, so it cannot survive the switch.
              setFocus(undefined)
            }}
          >
            <ToggleGroupItem value="services">Services</ToggleGroupItem>
            <ToggleGroupItem value="datasets">Datasets</ToggleGroupItem>
            <ToggleGroupItem value="columns">Columns</ToggleGroupItem>
          </ToggleGroup>
          <Select
            items={stackItems}
            value={stackId ?? 'all'}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              setFocus(undefined)
              navigate({
                page: 'lineage',
                stackId: !next || next === 'all' ? undefined : String(next),
                assetId,
                column,
              })
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {stackItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {level !== 'columns' && !stackId && !focus ? (
            <Button size="sm" variant={hideIsolated ? 'default' : 'outline'} onClick={() => setHideIsolated((v) => !v)}>
              {hideIsolated ? 'Connected only' : 'Show isolated'}
            </Button>
          ) : null}
          {level === 'datasets' ? (
            <Button size="sm" variant={grouped ? 'default' : 'outline'} onClick={() => setGrouped((v) => !v)}>
              Group by service
            </Button>
          ) : null}
          {focus ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Focus: {focus.label}</Badge>
              <ToggleGroup
                value={[String(depth)]}
                onValueChange={(value) => {
                  const next = value[0]
                  if (next) setDepth(Number(next))
                }}
              >
                <ToggleGroupItem value="1">1 hop</ToggleGroupItem>
                <ToggleGroupItem value="2">2 hops</ToggleGroupItem>
                <ToggleGroupItem value={String(Infinity)}>All</ToggleGroupItem>
              </ToggleGroup>
              <Button size="sm" variant="outline" onClick={openFocused}>
                Open
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Clear focus" onClick={() => setFocus(undefined)}>
                <XIcon />
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {/* Grouping containers are chrome, not entities, so they are not counted. */}
            {graph.nodes.filter((node) => node.type !== 'serviceGroup').length} nodes · {graph.edges.length} edges
            {level === 'columns' && focusAsset ? ` · ${focusAsset.name}.${column ?? ''}` : ''}
          </p>
        </div>

        {/* Legend doubles as the filter: the swatch is drawn the same way as the edge it stands for. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-6 py-2">
          {flowKinds
            .filter((flow) => graph.counts[flow.kind] > 0)
            .map((flow) => {
              const on = !hidden.has(flow.kind)
              return (
                <button
                  key={flow.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(flow.kind)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on ? 'text-foreground' : 'text-muted-foreground/50 line-through',
                  )}
                >
                  <span
                    className="w-4 border-t-2"
                    style={{
                      borderColor: flow.color,
                      borderStyle: flow.dashed ? 'dashed' : 'solid',
                      opacity: on ? 1 : 0.3,
                    }}
                  />
                  {flow.label}
                  <span className="tabular-nums text-muted-foreground">{graph.counts[flow.kind]}</span>
                </button>
              )
            })}
        </div>

        {level === 'columns' ? (
          <div className="flex flex-wrap gap-1.5 border-b px-6 py-2">
            {featuredColumns.map((item) => (
              <Button
                key={`${item.assetId}.${item.column}`}
                size="sm"
                variant={assetId === item.assetId && column === item.column ? 'default' : 'outline'}
                onClick={() => navigate({ page: 'lineage', assetId: item.assetId, column: item.column, stackId })}
              >
                {item.assetId.split('.').slice(-1)[0]}.{item.column}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 p-4">
          <LineageCanvas
            graphKey={`${level}-${stackId ?? 'all'}-${assetId ?? ''}-${column ?? ''}-${hideIsolated}-${[...hidden].sort().join(',')}-${focus?.id ?? ''}-${depth}-${grouped}`}
            nodes={graph.nodes}
            edges={graph.edges}
            onSelect={(node) => {
              // At column level a click re-roots the graph on that column, which is this level's
              // own form of focus. Everywhere else it focuses the node in place.
              if (level === 'columns') {
                if (node.column) navigate({ page: 'lineage', assetId: node.entityId, column: node.column, stackId })
                return
              }
              // On a dataset canvas a 'service' node can only be a grouping container, since the
              // datasets themselves are 'dataset' or 'runtime'. Clicking it opens that service.
              if (level === 'datasets' && node.kind === 'service') {
                const service = serviceById(node.entityId)
                navigate(
                  service && isRuntime(service)
                    ? { page: 'application', id: node.entityId }
                    : { page: 'service', id: node.entityId },
                )
                return
              }
              setFocus({ id: node.entityId, label: node.label, kind: node.kind })
            }}
          />
        </div>
      </div>
    </>
  )
}
