import {
  AppWindowIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FolderIcon,
  LayersIcon,
  PlugIcon,
  SheetIcon,
  TableIcon,
  WavesIcon,
  type LucideIcon,
} from 'lucide-react'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { assetDescription } from '@/lib/catalog-edits'
import { serviceById, typeLabel, type TreeNode } from '@/lib/catalog'
import type { AssetKind } from '@/types'
import { cn } from '@/lib/utils'

// Exhaustive so a new AssetKind cannot reach the tree without an icon.
const assetIcons: Record<AssetKind, LucideIcon> = {
  table: TableIcon,
  clickhouse_table: TableIcon,
  topic: WavesIcon,
  schema: FolderIcon,
  connector: PlugIcon,
  application: AppWindowIcon,
  catalog: LayersIcon,
  dataset: SheetIcon,
}

const row =
  'flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-left text-sm text-sidebar-foreground/90 outline-none select-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring'

const rowSelected = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'

function matchesQuery(node: TreeNode, q: string): boolean {
  if (!q) return true
  if (
    node.label.toLowerCase().includes(q) ||
    (node.asset && assetDescription(node.asset.id, node.asset.description).toLowerCase().includes(q))
  )
    return true
  return Boolean(node.children?.some((child) => matchesQuery(child, q)))
}

function TreeBranch({
  node,
  query,
  selectedId,
  openIds,
  onSelect,
  onToggle,
}: {
  node: TreeNode
  query: string
  selectedId?: string
  openIds: Set<string>
  onSelect: (node: TreeNode) => void
  onToggle: (id: string, open: boolean) => void
}) {
  if (!matchesQuery(node, query)) return null
  const selected = selectedId === node.id
  // Services get their Aiven mark; everything below is a muted glyph so the service stays the
  // most prominent level of the tree.
  const service = node.kind === 'service' ? serviceById(node.serviceId) : undefined
  const Glyph = node.asset ? assetIcons[node.asset.kind] : node.kind === 'database' ? DatabaseIcon : FolderIcon
  const mark = service ? (
    <ServiceIcon type={service.type} label={typeLabel(service.type)} size={16} />
  ) : (
    <Glyph className="size-3.5 shrink-0 text-muted-foreground" />
  )
  if (!node.children?.length) {
    return (
      <button type="button" className={cn(row, selected && rowSelected)} onClick={() => onSelect(node)}>
        {/* Keeps leaf labels aligned with the labels of branches that have a chevron. */}
        <span className="size-3.5 shrink-0" />
        {mark}
        <span className="truncate">{node.label}</span>
      </button>
    )
  }
  const open = openIds.has(node.id) || Boolean(query)
  return (
    <details
      open={open}
      // A filter force-opens matching branches; that is transient, so it must not
      // be recorded as expansion or clearing the filter would leave the tree open.
      onToggle={(event) => {
        if (!query) onToggle(node.id, event.currentTarget.open)
      }}
    >
      <summary
        className={cn(row, 'list-none [&::-webkit-details-marker]:hidden', selected && rowSelected)}
        onClick={() => onSelect(node)}
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        {mark}
        <span className="truncate">{node.label}</span>
      </summary>
      <div className="ml-[13px] flex flex-col border-l border-sidebar-border pl-1.5">
        {node.children.map((child) => (
          <TreeBranch
            key={child.id}
            node={child}
            query={query}
            selectedId={selectedId}
            openIds={openIds}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    </details>
  )
}

export function CatalogTree({
  nodes,
  query,
  selectedId,
  openIds,
  onSelect,
  onToggle,
}: {
  nodes: TreeNode[]
  query: string
  selectedId?: string
  openIds: Set<string>
  onSelect: (node: TreeNode) => void
  onToggle: (id: string, open: boolean) => void
}) {
  return (
    <div className="flex flex-col">
      {nodes.map((node) => (
        <TreeBranch
          key={node.id}
          node={node}
          query={query}
          selectedId={selectedId}
          openIds={openIds}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
