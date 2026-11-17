/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PAPER } from './theme'

// Reads the palette tokens straight from App.css, for both themes, and checks
// WCAG AA on the text/background pairs the game actually draws.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = read('./App.css')
const early = read('../public/theme.js')

/** The declarations inside the first `selector {` … `}` block. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block ${selector}`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = tokens(block(":root,\n[data-theme='light']"))
const dark = tokens(block("\n[data-theme='dark']"))
const darkBySystem = tokens(block(":root:not([data-theme='light'])"))

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`)
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** [foreground, background, minimum ratio, where it shows]. */
const PAIRS: [string, string, number, string][] = [
  // Body text (4.5:1).
  ['--ink', '--paper', 4.5, 'text everywhere'],
  ['--ink', '--sunk', 4.5, 'hovered rows'],
  ['--ink', '--wash', 4.5, 'level brief'],
  ['--ink-soft', '--paper', 4.5, 'secondary text, locked levels'],
  ['--ink-soft', '--sunk', 4.5, 'secondary text in a hovered row'],
  ['--ink-soft', '--wash', 4.5, 'secondary text on the brief'],
  ['--on-ink', '--ink', 4.5, 'toasts, current level, Users piece, menu hover, definitions'],
  ['--on-ink-soft', '--ink', 4.5, 'spec line on the Users piece'],
  ['--ok-wash', '--ink', 4.5, 'tick on the current level'],
  ['--on-accent', '--accent', 4.5, 'primary button'],
  ['--on-accent', '--accent-hover', 4.5, 'primary button, hovered'],
  ['--ok', '--paper', 4.5, 'passed goal'],
  ['--warm', '--paper', 4.5, 'warning in the debrief'],
  ['--hot', '--paper', 4.5, 'failed goal, errors, a piece down'],
  ['--ink', '--ok-wash', 4.5, 'text on a piece that is fine'],
  ['--ink', '--warm-wash', 4.5, 'text on a piece near its limit, breaker note'],
  ['--ink', '--hot-wash', 4.5, 'text on an overloaded piece'],
  // Controls and graphics (3:1).
  ['--focus', '--paper', 3, 'focus ring'],
  ['--accent', '--paper', 3, 'selected piece and link, current step'],
  ['--ink', '--paper', 3, 'ghost button border, handles'],
  ['--ink-soft', '--paper', 3, 'links between pieces'],
  ['--ok', '--track', 3, 'load bar on its track'],
  ['--warm', '--track', 3, 'near-limit bar on its track'],
  ['--hot', '--track', 3, 'overload bar on its track'],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_, palette) => {
  it.each(PAIRS)('%s on %s ≥ %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(min)
  })
})

describe('theme tokens', () => {
  it('the system dark block matches the picked dark block', () => {
    expect(darkBySystem).toEqual(dark)
  })

  it('both themes define the same palette', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
  })

  it('the browser-chrome colours match the paper tokens', () => {
    expect(PAPER.light).toBe(light['--paper'])
    expect(PAPER.dark).toBe(dark['--paper'])
    expect(early).toContain(PAPER.light)
    expect(early).toContain(PAPER.dark)
  })
})
