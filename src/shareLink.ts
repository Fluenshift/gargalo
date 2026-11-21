// A passed phase can be sent as a link: the level id and the player's design ride in the URL.
// The URL is untrusted input, so the design goes through the same `parseDesign` as a saved one.

import { findStage } from './career'
import { parseDesign } from './savedDesign'
import type { Level } from './sim/model'

/** Longest encoded design accepted; a 300-piece drawing is far below it. */
const MAX_ENCODED = 60_000

interface DrawnNode {
  id: string
  position: { x: number; y: number }
  data: unknown
}

interface DrawnEdge {
  id: string
  source: string
  target: string
  data?: unknown
}

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string) => {
  const bin = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Query string (with the leading "?") that opens `levelId` with this drawing. */
export function encodeShare(levelId: string, design: { nodes: DrawnNode[]; edges: DrawnEdge[]; fixes?: Record<string, string> }): string {
  const slim = {
    nodes: design.nodes.map((n) => ({ id: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: design.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.data ? { data: e.data } : {}) })),
    ...(design.fixes && Object.keys(design.fixes).length ? { fixes: design.fixes } : {}),
  }
  return `?${new URLSearchParams({ fase: levelId, d: toBase64Url(JSON.stringify(slim)) })}`
}

/** The shared level and a design the board can draw, or null for anything else. */
export function decodeShare(search: string): { level: Level; design: NonNullable<ReturnType<typeof parseDesign>> } | null {
  const params = new URLSearchParams(search)
  const levelId = params.get('fase')
  const encoded = params.get('d')
  const level = levelId ? findStage(levelId)?.level : undefined
  if (!level || !encoded || encoded.length > MAX_ENCODED) return null
  try {
    const design = parseDesign(fromBase64Url(encoded), level)
    return design && { level, design }
  } catch {
    // Not base64 or not UTF-8.
    return null
  }
}
