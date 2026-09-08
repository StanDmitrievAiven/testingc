import { useEffect } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { EntityNode, SchemaNode, ServiceGroupNode } from '@/components/lineage/entity-node'
import type { EntityNodeData, SchemaNodeData } from '@/lib/lineage-graph'
import { cn } from '@/lib/utils'

const nodeTypes = { entity: EntityNode, serviceGroup: ServiceGroupNode, schema: SchemaNode }

/**
 * The canvas is generic over its node data so the entity and schema builders each keep their own
 * shape; all it needs itself is the entityId it hands back on click.
 */
type CanvasNodeData = EntityNodeData | SchemaNodeData

function Canvas<T extends CanvasNodeData>({
  nodes: laidOut,
  edges,
  onSelect,
}: {
  nodes: Node<T>[]
  edges: Edge[]
  onSelect: (node: T) => void
}) {
  // A dragged node only moves if the change is fed back in, so positions live in local state.
  // The parent remounts this component whenever the graph itself changes (see `graphKey`), which
  // is what lets the laid-out nodes be an initial value with no syncing effect.
  const [nodes, , onNodesChange] = useNodesState(laidOut)
  const { fitView } = useReactFlow()
  const ready = useNodesInitialized()

  useEffect(() => {
    if (!ready) return
    const id = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: 240 })
    })
    return () => cancelAnimationFrame(id)
    // Deliberately not re-fitting on `nodes`: that would yank the viewport back on every drag.
  }, [ready, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.12}
      maxZoom={1.8}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelect(node.data)}
    >
      <Background gap={18} />
      <MiniMap pannable zoomable className="rounded-lg border" style={{ width: 132, height: 88 }} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function LineageCanvas<T extends CanvasNodeData>({
  nodes,
  edges,
  onSelect,
  className,
  graphKey,
}: {
  nodes: Node<T>[]
  edges: Edge[]
  onSelect: (node: T) => void
  className?: string
  graphKey?: string
}) {
  return (
    <div className={cn('h-full min-h-0 w-full overflow-hidden rounded-xl border bg-muted/20', className)}>
      <ReactFlowProvider>
        <Canvas key={graphKey} nodes={nodes} edges={edges} onSelect={onSelect} />
      </ReactFlowProvider>
    </div>
  )
}
