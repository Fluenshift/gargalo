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

const COMPANIES = ['startup', 'ecommerce', 'fintech', 'streaming']
const TINT = Number(/color-mix\(in srgb, var\(--company\) (\d+)%, var\(--paper\)\)/.exec(css)?.[1]) / 100

/** color-mix(in srgb, a p, b): a straight mix of the 8-bit channels. */
function mix(a: string, b: string, p: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('')}`
}

/** Adds each company's --company-<id>-wash, the tint [data-company] puts behind the brief and the career card head. */
const withWashes = (palette: Record<string, string>) => ({
  ...palette,
  ...Object.fromEntries(COMPANIES.map((c) => [`--company-${c}-wash`, mix(palette[`--company-${c}`], palette['--paper'], TINT)])),
})

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
  // Company line colours: the eyebrow on paper, the career name and current step on paper or a hovered row.
  ...COMPANIES.flatMap((c): [string, string, number, string][] => [
    [`--company-${c}`, '--paper', 4.5, `${c} eyebrow, career name`],
    [`--company-${c}`, '--sunk', 4.5, `${c} colour in a hovered row`],
    ['--ink', `--company-${c}-wash`, 4.5, `brief tinted by ${c}`],
    ['--ink-soft', `--company-${c}-wash`, 4.5, `secondary text on the ${c} tint`],
  ]),
  // Code tokens in the Oficina editor (paper) and on its current line (sunk).
  ...['--code-keyword', '--code-string', '--code-number', '--code-type', '--code-function', '--ink-soft'].flatMap(
    (t): [string, string, number, string][] => [
      [t, '--paper', 4.5, 'code token'],
      [t, '--sunk', 4.5, 'code token on the current line'],
    ],
  ),
]

describe.each([
  ['light', withWashes(light)],
  ['dark', withWashes(dark)],
])('%s theme contrast', (_, palette) => {
  it.each(PAIRS)('%s on %s ≥ %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(min)
  })
})

describe('theme tokens', () => {
  it('reads the company tint from App.css', () => {
    expect(TINT).toBeGreaterThan(0)
  })


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
