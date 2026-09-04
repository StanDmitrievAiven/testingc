import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import type { EntityNodeData } from '@/lib/lineage-graph'
import { typeLabel } from '@/lib/catalog'
import { cn } from '@/lib/utils'

export type EntityFlowNode = Node<EntityNodeData, 'entity'>

export type ServiceGroupFlowNode = Node<EntityNodeData, 'serviceGroup'>

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
