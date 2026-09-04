// Pure graph maths, deliberately free of app imports so it stays runnable by `node` directly.
import dagre, { Graph } from '@dagrejs/dagre'

type Link = { source: string; target: string }

type Placed = { x: number; y: number; width: number; height: number }

/** Node ids within `depth` hops of `focusId`, walking links in either direction. */
export function neighborhood(links: readonly Link[], focusId: string, depth: number): Set<string> {
  const adjacency = new Map<string, string[]>()
  const link = (from: string, to: string) => {
    const list = adjacency.get(from)
    if (list) list.push(to)
    else adjacency.set(from, [to])
  }
  for (const edge of links) {
    link(edge.source, edge.target)
    link(edge.target, edge.source)
  }

  const reached = new Set([focusId])
  let frontier = [focusId]
  // Breadth-first, so `depth` counts hops rather than edges walked. Terminates on an empty
  // frontier, which is what makes depth: Infinity safe.
  for (let hop = 0; hop < depth && frontier.length; hop += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (reached.has(neighbor)) continue
        reached.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return reached
}

/** Dagre left-to-right, returning top-left corners rather than dagre's centres. */
export function layoutBoxes(
  boxes: readonly { id: string; width: number; height: number }[],
  links: readonly Link[],
  spacing: { nodesep: number; ranksep: number },
): Map<string, Placed> {
  const graph = new Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ...spacing, marginx: 0, marginy: 0 })
  for (const box of boxes) graph.setNode(box.id, { width: box.width, height: box.height })
  for (const link of links) {
    // Self-loops carry no ranking information and upset dagre, so they are skipped.
    if (link.source !== link.target && graph.hasNode(link.source) && graph.hasNode(link.target)) {
      graph.setEdge(link.source, link.target)
    }
  }
  dagre.layout(graph)

  const placed = new Map<string, Placed>()
  for (const box of boxes) {
    const node = graph.node(box.id)
    placed.set(box.id, {
      x: (node?.x ?? 0) - box.width / 2,
      y: (node?.y ?? 0) - box.height / 2,
      width: box.width,
      height: box.height,
    })
  }
  return placed
}

/**
 * Two-pass layout for nesting nodes inside their group: lay each group's members out on their own,
 * which gives the group its size, then lay the groups out against each other using only the links
 * that cross between them. Member coordinates come back relative to their group, which is what
 * React Flow wants from a child of a parent node.
 */
export function groupedLayout(
  nodes: readonly { id: string; group: string }[],
  links: readonly Link[],
  box: { width: number; height: number; padding: number; header: number },
): {
  groups: (Placed & { id: string })[]
  nodes: { id: string; group: string; x: number; y: number }[]
} {
  const groupOf = new Map(nodes.map((node) => [node.id, node.group]))
  const members = new Map<string, string[]>()
  for (const node of nodes) {
    const list = members.get(node.group)
    if (list) list.push(node.id)
    else members.set(node.group, [node.id])
  }

  const offsets = new Map<string, { x: number; y: number }>()
  const sizes: { id: string; width: number; height: number }[] = []

  for (const [group, ids] of members) {
    const inside = links.filter(
      (link) => groupOf.get(link.source) === group && groupOf.get(link.target) === group,
    )
    const placed = layoutBoxes(
      ids.map((id) => ({ id, width: box.width, height: box.height })),
      inside,
      { nodesep: 16, ranksep: 48 },
    )

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const spot of placed.values()) {
      minX = Math.min(minX, spot.x)
      minY = Math.min(minY, spot.y)
      maxX = Math.max(maxX, spot.x + spot.width)
      maxY = Math.max(maxY, spot.y + spot.height)
    }

    for (const [id, spot] of placed) {
      offsets.set(id, { x: spot.x - minX + box.padding, y: spot.y - minY + box.header })
    }
    sizes.push({
      id: group,
      width: maxX - minX + box.padding * 2,
      height: maxY - minY + box.header + box.padding,
    })
  }

  const crossed = new Set<string>()
  const between: Link[] = []
  for (const link of links) {
    const source = groupOf.get(link.source)
    const target = groupOf.get(link.target)
    if (!source || !target || source === target) continue
    const key = `${source}->${target}`
    if (crossed.has(key)) continue
    crossed.add(key)
    between.push({ source, target })
  }

  const placedGroups = layoutBoxes(sizes, between, { nodesep: 40, ranksep: 96 })

  return {
    groups: sizes.map((size) => ({ id: size.id, ...placedGroups.get(size.id)! })),
    nodes: nodes.map((node) => ({ ...node, ...offsets.get(node.id)! })),
  }
}
