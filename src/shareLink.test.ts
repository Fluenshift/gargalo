import { describe, expect, it } from 'vitest'
import { decodeShare, encodeShare } from './shareLink'
import { findStage } from './career'
import { LEVELS } from './levels'

const level = LEVELS[0]
const node = (id: string, kind: string, x = 0) => ({ id, type: 'component', position: { x, y: 10.4 }, data: { kind } })
const design = {
  nodes: [node('client', 'client'), node('server', 'server', 200)],
  edges: [{ id: 'client->server', source: 'client', target: 'server' }],
}
const query = (d: string, fase = level.id) => `?${new URLSearchParams({ fase, d })}`

describe('share link', () => {
  it('round-trips the level and the design', () => {
    expect(findStage(level.id)).toBeDefined()
    const out = decodeShare(encodeShare(level.id, design))
    expect(out?.level.id).toBe(level.id)
    expect(out?.design.nodes.map((n) => [n.id, n.position.x, n.position.y])).toEqual([
      ['client', 0, 10],
      ['server', 200, 10],
    ])
    expect(out?.design.edges).toEqual(design.edges)
  })

  it('rejects a tampered or invalid link', () => {
    const good = encodeShare(level.id, design)
    const d = new URLSearchParams(good).get('d')!
    expect(decodeShare('')).toBeNull()
    expect(decodeShare(good.replace(level.id, 'nao-existe'))).toBeNull()
    expect(decodeShare(query('!!not base64!!'))).toBeNull()
    expect(decodeShare(query(d.slice(0, -6)))).toBeNull()
    expect(decodeShare(query(btoa('{"nodes":[],"edges":[]}')))).toBeNull()
    const bad = { ...design, nodes: [design.nodes[0], { ...design.nodes[1], data: { kind: 'hacker' } }] }
    expect(decodeShare(encodeShare(level.id, bad))).toBeNull()
    expect(decodeShare(query('A'.repeat(70_000)))).toBeNull()
  })
})
