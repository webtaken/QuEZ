import { describe, it, expect } from 'vitest'
import {
  childrenOf,
  descendToLeaf,
  buildActivePath,
  siblingInfo,
  switchSibling,
  type TreeNode,
} from './chat-tree'

// Tree:
//   U1 - A1 -+- U2  - A2
//           +- U2' -+- A2'
//                   +- A2''
const t = (id: string, parentId: string | null, ms: number): TreeNode => ({
  id,
  parentId,
  createdAt: new Date(ms),
})
const nodes: TreeNode[] = [
  t('U1', null, 1),
  t('A1', 'U1', 2),
  t('U2', 'A1', 3),
  t('A2', 'U2', 4),
  t('U2p', 'A1', 5),
  t('A2p', 'U2p', 6),
  t('A2pp', 'U2p', 7),
]

describe('childrenOf', () => {
  it('returns direct children sorted by createdAt', () => {
    expect(childrenOf(nodes, 'A1').map((n) => n.id)).toEqual(['U2', 'U2p'])
  })
  it('returns roots for null parent', () => {
    expect(childrenOf(nodes, null).map((n) => n.id)).toEqual(['U1'])
  })
})

describe('descendToLeaf', () => {
  it('follows newest child to a leaf', () => {
    expect(descendToLeaf(nodes, 'A1')).toBe('A2pp')
  })
  it('returns the node itself when it is a leaf', () => {
    expect(descendToLeaf(nodes, 'A2')).toBe('A2')
  })
})

describe('buildActivePath', () => {
  it('walks parents up from the leaf, root first', () => {
    expect(buildActivePath(nodes, 'A2pp')).toEqual(['U1', 'A1', 'U2p', 'A2pp'])
  })
  it('returns [] when the leaf is missing', () => {
    expect(buildActivePath(nodes, 'nope')).toEqual([])
  })
  it('returns [] for null leaf', () => {
    expect(buildActivePath(nodes, null)).toEqual([])
  })
})

describe('siblingInfo', () => {
  it('reports index/count among same-parent siblings', () => {
    expect(siblingInfo(nodes, 'U2p', 'A2pp')).toEqual({
      index: 1,
      count: 2,
      siblingIds: ['U2', 'U2p'],
    })
  })
  it('is 1/1 for an only child', () => {
    expect(siblingInfo(nodes, 'A1', 'A2pp')).toMatchObject({ index: 0, count: 1 })
  })
})

describe('switchSibling', () => {
  it('moves to the previous sibling and descends to its leaf', () => {
    expect(switchSibling(nodes, 'U2p', -1, 'A2pp')).toBe('A2')
  })
  it('returns null when moving out of range', () => {
    expect(switchSibling(nodes, 'U2p', 1, 'A2pp')).toBeNull()
  })
})
