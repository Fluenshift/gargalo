import { describe, expect, it } from 'vitest'
import {
  TEMPLATES,
  createSystem,
  defaultTraffic,
  deleteSystem,
  duplicateSystem,
  exportFileName,
  exportSystem,
  importSystem,
  levelOf,
  loadSystems,
  renameSystem,
  updateDesign,
  updateTraffic,
  validateTraffic,
} from './freeMode'
import type { FreeSystem, Traffic } from './freeMode'
import { runLevel } from './sim/engine'
import { canConnect } from './sim/model'
import type { Architecture } from './sim/model'

const traffic = (patch: Partial<Traffic> = {}): Traffic => ({ ...defaultTraffic(), ...patch })
const lone: Architecture = {
  nodes: [{ id: 'client', kind: 'client' }, { id: 'server', kind: 'server' }, { id: 'db', kind: 'db' }],
  edges: [{ source: 'client', target: 'server' }, { source: 'server', target: 'db' }],
}
const design = {
  nodes: [
    { id: 'client', type: 'component', position: { x: 0, y: 0 }, data: { kind: 'client' } },
    { id: 'server', type: 'component', position: { x: 200, y: 0 }, data: { kind: 'server' } },
  ],
  edges: [{ id: 'client->server', source: 'client', target: 'server' }],
}
const wrap = (system: unknown, extra: object = {}) => JSON.stringify({ format: 'gargalo-sistema', version: 1, system, ...extra })
const good = () => ({ name: 'Meu sistema', traffic: defaultTraffic(), design: null })

describe('CRUD', () => {
  it('creates, renames, duplicates and deletes', () => {
    let { list, system } = createSystem([], { name: '  Loja   do  Zé ' })
    expect(system.name).toBe('Loja do Zé')
    expect(createSystem(list).system.name).toBe('Sistema 2')
    list = renameSystem(list, system.id, 'Outro nome')
    expect(list[0].name).toBe('Outro nome')
    expect(renameSystem(list, system.id, '   ')).toBe(list)
    const copy = duplicateSystem(list, system.id)
    expect(copy.list).toHaveLength(2)
    expect(copy.system!.id).not.toBe(system.id)
    expect(copy.system!.name).toBe('Outro nome (cópia)')
    expect(copy.system!.traffic).toEqual(system.traffic)
    expect(copy.system!.traffic).not.toBe(system.traffic)
    list = deleteSystem(copy.list, system.id)
    expect(list.map((s) => s.id)).toEqual([copy.system!.id])
    expect(duplicateSystem(list, 'nope').system).toBeNull()
  })

  it('persists as one JSON list and drops garbage when loading', () => {
    const { list } = createSystem([], { name: 'A', traffic: traffic({ rps: -5 }) })
    const loaded = loadSystems(JSON.stringify([...list, { name: 3 }, 'x', null, { ...list[0] }]))
    // The negative rps survives (the player is still editing it); the garbage and the repeated id do not.
    expect(loaded).toEqual(list)
    expect(loadSystems('{')).toEqual([])
    expect(loadSystems(null)).toEqual([])
    expect(loadSystems('{"a":1}')).toEqual([])
  })

  it('updates traffic and cleans the design it is given', () => {
    const { list, system } = createSystem([])
    const t = traffic({ rps: 900 })
    expect(updateTraffic(list, system.id, t)[0].traffic.rps).toBe(900)
    expect(updateDesign(list, system.id, design)[0].design?.nodes).toHaveLength(2)
    expect(updateDesign(list, system.id, { nodes: [{ id: 'x' }], edges: [] })).toBe(list)
    expect(updateDesign(list, system.id, 'lixo')).toBe(list)
  })
})

describe('traffic validation', () => {
  it('accepts the default and every template', () => {
    expect(validateTraffic(defaultTraffic())).toEqual([])
    for (const t of TEMPLATES) expect(validateTraffic(t.traffic), t.id).toEqual([])
  })

  it('refuses zero, negative and absurd rps', () => {
    expect(validateTraffic(traffic({ rps: 0 }))[0]).toMatch(/maiores que zero/)
    expect(validateTraffic(traffic({ rps: -10 }))[0]).toMatch(/maiores que zero/)
    expect(validateTraffic(traffic({ rps: NaN }))).not.toEqual([])
    expect(validateTraffic(traffic({ rps: 2e9 }))).not.toEqual([])
  })

  it('wants the mix to add up to 100%, within the tolerance', () => {
    expect(validateTraffic(traffic({ mix: { static: 0.3, read: 0.5, write: 0.3 } }))[0]).toMatch(/somar 100%.*110%/)
    expect(validateTraffic(traffic({ mix: { static: 0.3, read: 0.5, write: 0.2005 } }))).toEqual([])
    expect(validateTraffic(traffic({ mix: { static: 0.3, read: 0.5, write: 0.21 } }))).not.toEqual([])
    expect(validateTraffic(traffic({ mix: { static: -0.2, read: 0.9, write: 0.3 } }))[0]).toMatch(/negativa/)
  })

  it('checks duration, spikes and failures', () => {
    expect(validateTraffic(traffic({ durationS: 5 }))).not.toEqual([])
    expect(validateTraffic(traffic({ spikes: [{ from: 10, to: 10, rps: 100 }] }))[0]).toMatch(/Pico 1/)
    expect(validateTraffic(traffic({ spikes: [{ from: 10, to: 90, rps: 100 }] }))[0]).toMatch(/Pico 1/)
    expect(validateTraffic(traffic({ spikes: [{ from: 10, to: 20, rps: 0 }] }))[0]).toMatch(/Pico 1/)
    expect(validateTraffic(traffic({ failures: [{ kind: 'client', index: 0, from: 1, to: 5 }] }))[0]).toMatch(/Falha 1/)
    expect(validateTraffic(traffic({ failures: [{ kind: 'server', index: -1, from: 1, to: 5 }] }))[0]).toMatch(/Falha 1/)
    expect(validateTraffic(traffic({ hotKey: 2 }))).not.toEqual([])
  })
})

describe('levelOf', () => {
  it('has goals that never fail and runs through the engine', () => {
    const level = levelOf({ id: 'a', name: 'A', traffic: traffic(), design: null })
    expect(level.goals).toEqual({ minAvailability: 0, maxP99Ms: Infinity, maxCost: Infinity })
    const { summary } = runLevel(lone, { ...level, traffic: [{ from: 0, rps: 50000 }] })
    expect(summary.availability).toBeLessThan(0.5)
    expect(summary.passed.all).toBe(true)
  })

  it('turns spikes into phases', () => {
    const level = levelOf({ id: 'a', name: 'A', design: null, traffic: traffic({ rps: 100, spikes: [{ from: 10, to: 20, rps: 900 }, { from: 15, to: 25, rps: 400 }] }) })
    expect(level.traffic).toEqual([{ from: 0, rps: 100 }, { from: 10, rps: 900 }, { from: 20, rps: 400 }, { from: 25, rps: 100 }])
  })

  it('does not throw on traffic that cannot run yet', () => {
    const bad = traffic({ rps: NaN, durationS: -4, spikes: [{ from: 5, to: 1, rps: 3 }] })
    expect(() => levelOf({ id: 'a', name: 'A', traffic: bad, design: null })).not.toThrow()
  })
})

describe('templates', () => {
  it('has at least three, each with a question and a distinct id', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3)
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    for (const t of TEMPLATES) expect(t.question.length).toBeGreaterThan(20)
  })

  it('draws only links the board allows and runs through the engine, with and without the start', () => {
    for (const t of TEMPLATES) {
      const system = createSystem([], { name: t.name, traffic: t.traffic, question: t.question }).system
      const level = levelOf(system)
      expect(level.briefing).toContain(t.question)
      const arch = t.start ?? { nodes: [{ id: 'client', kind: 'client' as const }], edges: [] }
      for (const e of arch.edges) expect(canConnect({ nodes: arch.nodes, edges: [] }, e.source, e.target), `${t.id} ${e.source}->${e.target}`).toBe(true)
      expect(() => runLevel(arch, level), t.id).not.toThrow()
      const { summary } = runLevel(arch, level)
      expect(summary.passed.all, t.id).toBe(true)
    }
  })

  it('give the player something to solve: the start drops requests', () => {
    for (const t of TEMPLATES.filter((x) => x.start)) {
      const { summary } = runLevel(t.start!, levelOf({ id: 'a', name: 'A', traffic: t.traffic, design: null }))
      expect(summary.availability, t.id).toBeLessThan(0.99)
    }
  })
})

describe('export and import', () => {
  it('round-trips a system with a new id', () => {
    const made = createSystem([], { name: 'Loja', traffic: TEMPLATES[3].traffic, question: TEMPLATES[3].question, design }).system
    const back = importSystem(exportSystem(made))
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.system.id).not.toBe(made.id)
    const { id: _a, ...rest } = back.system
    const { id: _b, ...orig } = made
    expect(rest).toEqual(orig)
  })

  it('names the file after the system', () => {
    expect(exportFileName({ name: 'Encurtador de URL ção' } as FreeSystem)).toBe('gargalo-encurtador-de-url-cao.json')
    expect(exportFileName({ name: '???' } as FreeSystem)).toBe('gargalo-sistema.json')
  })

  it('rejects garbage with a clear message and never throws', () => {
    const cases: unknown[] = [
      '', 'não é json', '[]', 'null', '42', '{}', wrap(null), wrap('x'), wrap([]), wrap({}),
      JSON.stringify({ format: 'outra-coisa', version: 1, system: good() }),
      wrap(good(), { version: 2 }),
      wrap({ ...good(), name: '   ' }),
      wrap({ ...good(), name: 7 }),
      wrap({ ...good(), traffic: 'x' }),
      wrap({ ...good(), traffic: { ...defaultTraffic(), rps: '500' } }),
      wrap({ ...good(), traffic: { ...defaultTraffic(), spikes: 'x' } }),
      wrap({ ...good(), traffic: { ...defaultTraffic(), failures: [{ kind: 'nada', index: 0, from: 1, to: 2 }] } }),
      wrap({ ...good(), design: { nodes: [], edges: [] } }),
      wrap({ ...good(), design: { nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { kind: 'client' } }], edges: [{ source: 'a', target: 'b' }] } }),
      wrap({ ...good(), design: 'lixo' }),
      'x'.repeat(2_000_000),
    ]
    for (const c of cases) {
      const r = importSystem(c as string)
      expect(r.ok, String(c).slice(0, 60)).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10)
    }
    expect(importSystem(undefined as unknown as string).ok).toBe(false)
  })

  it('rejects a bad mix and a negative rps', () => {
    const mix = importSystem(wrap({ ...good(), traffic: { ...defaultTraffic(), mix: { static: 0.5, read: 0.5, write: 0.5 } } }))
    expect(!mix.ok && mix.error).toMatch(/somar 100%/)
    const rps = importSystem(wrap({ ...good(), traffic: { ...defaultTraffic(), rps: -1 } }))
    expect(!rps.ok && rps.error).toMatch(/maiores que zero/)
  })

  it('ignores an id that comes in the file', () => {
    const r = importSystem(wrap({ ...good(), id: 'roubado', extra: 1 }))
    expect(r.ok && r.system.id).not.toBe('roubado')
  })
})
