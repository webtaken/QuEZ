export type TreeNode = { id: string; parentId: string | null; createdAt: Date }

function byCreatedAt(a: TreeNode, b: TreeNode): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime()
  return d !== 0 ? d : a.id.localeCompare(b.id)
}

export function childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort(byCreatedAt)
}

export function descendToLeaf(nodes: TreeNode[], startId: string): string {
  let current = startId
  for (;;) {
    const kids = childrenOf(nodes, current)
    if (kids.length === 0) return current
    current = kids[kids.length - 1].id // newest
  }
}

export function buildActivePath(nodes: TreeNode[], activeLeafId: string | null): string[] {
  if (!activeLeafId) return []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (!byId.has(activeLeafId)) return []
  const path: string[] = []
  let cursor: string | null = activeLeafId
  const guard = new Set<string>()
  while (cursor) {
    if (guard.has(cursor)) break // cycle guard
    guard.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    path.push(node.id)
    cursor = node.parentId
  }
  return path.reverse()
}

export function siblingInfo(
  nodes: TreeNode[],
  nodeId: string,
  _activeLeafId: string
): { index: number; count: number; siblingIds: string[] } {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { index: 0, count: 0, siblingIds: [] }
  const sibs = childrenOf(nodes, node.parentId)
  const siblingIds = sibs.map((s) => s.id)
  return { index: siblingIds.indexOf(nodeId), count: sibs.length, siblingIds }
}

export function switchSibling(
  nodes: TreeNode[],
  forkChildId: string,
  dir: -1 | 1,
  activeLeafId: string
): string | null {
  const { index, siblingIds } = siblingInfo(nodes, forkChildId, activeLeafId)
  const target = index + dir
  if (target < 0 || target >= siblingIds.length) return null
  return descendToLeaf(nodes, siblingIds[target])
}
