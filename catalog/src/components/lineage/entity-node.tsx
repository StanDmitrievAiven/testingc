import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import {
  ASSET_HANDLE,
  SCHEMA_HEADER,
  SCHEMA_ROW,
  SCHEMA_WIDTH,
  type EntityNodeData,
  type SchemaNodeData,
} from '@/lib/lineage-graph'
import { typeLabel } from '@/lib/catalog'
import { cn } from '@/lib/utils'

export type EntityFlowNode = Node<EntityNodeData, 'entity'>

export type ServiceGroupFlowNode = Node<EntityNodeData, 'serviceGroup'>

export type SchemaFlowNode = Node<SchemaNodeData, 'schema'>

export function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  return (
    <div
      className={cn(
        // Fixed size on purpose: the dagre layout reserves exactly this box, and a node that grew
        // with its label would overflow the container it was placed in.
        'flex h-[56px] w-[228px] cursor-grab items-center gap-2 rounded-lg border bg-card px-2.5 active:cursor-grabbing',
        selected ? 'border-foreground' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} />
      {data.markType ? <ServiceIcon type={data.markType} label={typeLabel(data.markType)} size={20} /> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{data.label}</div>
        <div className="truncate text-xs text-muted-foreground">{data.subtitle}</div>
      </div>
      {/* Running is the norm, so only the exception earns a badge. */}
      {data.state === 'POWEROFF' ? <Badge variant="outline">Off</Badge> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/**
 * A dataset drawn as its column list, so column-level edges can land on the column they describe.
 *
 * Folding hides the rows with height rather than unmounting them: the handles have to stay in the
 * DOM or React Flow would drop every edge attached to them. Collapsed, they all measure to the same
 * point, which reads as the links bundling into the node.
 */
export function SchemaNode({ id, data, selected }: NodeProps<SchemaFlowNode>) {
  const [open, setOpen] = useState(true)
  const updateNodeInternals = useUpdateNodeInternals()

  return (
    <div
      className={cn(
        'cursor-grab overflow-hidden rounded-lg border bg-card active:cursor-grabbing',
        selected ? 'border-foreground' : 'border-border',
        // The asset whose page this is, so it is findable among its neighbours.
        data.focused && 'ring-2 ring-ring',
      )}
      style={{ width: SCHEMA_WIDTH }}
    >
      <div className="relative flex items-center gap-2 px-2.5" style={{ height: SCHEMA_HEADER }}>
        <Handle
          id={ASSET_HANDLE}
          type="target"
          position={Position.Left}
          className={cn(!data.assetInto && 'opacity-0')}
        />
        {data.markType ? <ServiceIcon type={data.markType} label={typeLabel(data.markType)} size={20} /> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{data.label}</div>
          <div className="truncate text-xs text-muted-foreground">{data.subtitle}</div>
        </div>
        {data.columns.length ? (
          <button
            type="button"
            // nodrag keeps the toggle from starting a drag; stopPropagation keeps it from
            // navigating, since a click on the node body opens that asset.
            className="nodrag rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={open ? `Hide ${data.label} columns` : `Show ${data.label} columns`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              setOpen((was) => !was)
              // React Flow caches where each handle is, so the fold has to say they moved — after
              // the new size is laid out, and only on a toggle: announcing it on mount instead
              // pre-empts React Flow's own first measurement and no edge ever resolves.
              requestAnimationFrame(() => updateNodeInternals(id))
            }}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : null}
        <Handle
          id={ASSET_HANDLE}
          type="source"
          position={Position.Right}
          className={cn(!data.assetOutOf && 'opacity-0')}
        />
      </div>

      {/* Folding collapses each row to nothing rather than hiding the list, which is what makes the
          handles inside them stack at the node's edge. Zeroing only the list would leave the rows
          laid out where they were, and every edge would still point into the space below. */}
      {data.columns.length ? (
        <div className={cn('border-t py-[3px]', !open && 'border-t-0 py-0')}>
          {data.columns.map((column) => (
            <div
              key={column.name}
              className="relative flex items-center gap-2 overflow-hidden px-2.5"
              style={{ height: open ? SCHEMA_ROW : 0 }}
            >
              {/* Positioned against this row, which is what puts an edge on the right column. */}
              <Handle
                id={column.name}
                type="target"
                position={Position.Left}
                className={cn(!column.into && 'opacity-0')}
              />
              <span
                className={cn(
                  'truncate text-xs',
                  column.into || column.outOf ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {column.name}
              </span>
              {/* The key markers are what make this readable as a data model rather than a list. */}
              {column.constraint ? (
                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                  {column.constraint}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{column.type}</span>
              <Handle
                id={column.name}
                type="source"
                position={Position.Right}
                className={cn(!column.outOf && 'opacity-0')}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Container holding the datasets that belong to one service. Sized by the layout, not by content. */
export function ServiceGroupNode({ data, selected }: NodeProps<ServiceGroupFlowNode>) {
  return (
    <div
      className={cn(
        'size-full rounded-lg border border-dashed bg-muted/40',
        selected ? 'border-foreground' : 'border-border',
      )}
    >
      <div className="flex h-11 items-center gap-2 px-3">
        {data.markType ? <ServiceIcon type={data.markType} label={typeLabel(data.markType)} size={20} /> : null}
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
    </div>
  )
}
