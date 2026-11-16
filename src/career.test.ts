import { describe, expect, it } from 'vitest'
import {
  COMPANIES,
  CURRENT_KEY,
  PASSED_KEY,
  companyOpen,
  levelStatus,
  loadProgress,
  nextLevel,
  pieceUnlock,
  stages,
  startArchitecture,
} from './career'
import type { Company } from './career'
import { BLACK_FRIDAY, LEVELS } from './levels'
import type { Level } from './sim/model'

const lvl = (id: string): Level => ({ ...LEVELS[0], id, title: id })

// A two-company career to exercise promotion and piece unlocking.
const career: Company[] = [
  { id: 'a', name: 'A', budget: '', levels: [lvl('a1'), lvl('a2')], boss: lvl('a-boss'), unlocks: ['server', 'db'] },
  { id: 'b', name: 'B', budget: '', levels: [lvl('b1')], boss: lvl('b-boss'), unlocks: ['cache'] },
]

const storage = (entries: Record<string, string>) => (key: string) => entries[key] ?? null

describe('career data', () => {
  it('the Startup has five levels and the TV report as its boss', () => {
    expect(COMPANIES[0].name).toBe('Startup')
    expect(COMPANIES[0].levels.map((l) => l.id)).toEqual([
      'colocar-no-ar',
      'primeiro-deploy',
      'banco-nao-aguenta',
      'imagens-pesadas',
      'caiu-de-madrugada',
    ])
    expect(COMPANIES[0].boss.id).toBe('materia-na-tv')
  })

  it('the E-commerce has four levels and Black Friday as its boss', () => {
    expect(COMPANIES[1].name).toBe('E-commerce')
    expect(COMPANIES[1].levels.map((l) => l.id)).toEqual([
      'checkout-travando',
      'catalogo-gigante',
      'bot-de-precos',
      'pagamento-instavel',
    ])
    expect(COMPANIES[1].boss).toBe(BLACK_FRIDAY)
  })

  it('the E-commerce unlocks the pieces its levels teach', () => {
    for (const kind of ['queue', 'worker', 'replica', 'limiter', 'gateway'] as const) {
      expect(pieceUnlock(kind, 0)).toMatchObject({ unlocked: false, by: { id: 'ecommerce' } })
      expect(pieceUnlock(kind, 1)).toEqual({ unlocked: true })
    }
  })

  it('every level belongs to exactly one company', () => {
    const ids = stages().map((s) => s.level.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(LEVELS.map((l) => l.id).sort())
  })

  it('the five current pieces are unlocked in the first company', () => {
    for (const kind of ['cdn', 'lb', 'server', 'cache', 'db'] as const)
      expect(pieceUnlock(kind, 0)).toEqual({ unlocked: true })
  })
})

describe('unlock rules', () => {
  it('levels open in order, starting with the first', () => {
    expect(levelStatus('a1', [], career)).toBe('open')
    expect(levelStatus('a2', [], career)).toBe('locked')
    expect(levelStatus('a2', ['a1'], career)).toBe('open')
    expect(levelStatus('a1', ['a1'], career)).toBe('done')
  })

  it('the boss opens only after all the company levels', () => {
    expect(levelStatus('a-boss', [], career)).toBe('locked')
    expect(levelStatus('a-boss', ['a1'], career)).toBe('locked')
    expect(levelStatus('a-boss', ['a1', 'a2'], career)).toBe('open')
  })

  it('the next company opens only after the boss is beaten', () => {
    expect(companyOpen(1, ['a1', 'a2'], career)).toBe(false)
    expect(levelStatus('b1', ['a1', 'a2'], career)).toBe('locked')
    expect(companyOpen(1, ['a1', 'a2', 'a-boss'], career)).toBe(true)
    expect(levelStatus('b1', ['a1', 'a2', 'a-boss'], career)).toBe('open')
    expect(levelStatus('b-boss', ['a1', 'a2', 'a-boss'], career)).toBe('locked')
  })

  it('pieces of a later company are locked and say which company unlocks them', () => {
    expect(pieceUnlock('server', 0, career)).toEqual({ unlocked: true })
    expect(pieceUnlock('cache', 0, career)).toEqual({ unlocked: false, by: career[1] })
    expect(pieceUnlock('cache', 1, career)).toEqual({ unlocked: true })
    expect(pieceUnlock('server', 1, career)).toEqual({ unlocked: true })
    expect(pieceUnlock('cdn', 1, career)).toEqual({ unlocked: false, by: undefined })
  })

  it('a level added before one already passed does not lock the rest', () => {
    const three: Company[] = [{ ...career[0], levels: [lvl('new'), lvl('a1'), lvl('a2')] }, career[1]]
    expect(levelStatus('new', ['a1'], three)).toBe('open')
    expect(levelStatus('a2', ['a1'], three)).toBe('open')
    expect(levelStatus('a-boss', ['a1'], three)).toBe('locked')
    expect(levelStatus('a-boss', ['a1', 'a2'], three)).toBe('open')
  })

  it('unknown levels are locked', () => {
    expect(levelStatus('nope', ['a1'], career)).toBe('locked')
  })
})

describe('starting architecture', () => {
  const [company] = career
  it('is just the users when nothing is set', () => {
    expect(startArchitecture({ company, level: lvl('x') })).toEqual({
      nodes: [{ id: 'client', kind: 'client' }],
      edges: [],
    })
  })

  it('a level inherits the company start, and its own start wins', () => {
    const start = { nodes: [{ id: 'db', kind: 'db' as const }], edges: [] }
    const own = { nodes: [{ id: 'client', kind: 'client' as const }, { id: 's', kind: 'server' as const }], edges: [] }
    expect(startArchitecture({ company: { ...company, start }, level: lvl('x') }).nodes.map((n) => n.id)).toEqual([
      'client',
      'db',
    ])
    expect(startArchitecture({ company: { ...company, start }, level: { ...lvl('x'), start: own } })).toBe(own)
  })

  it('Black Friday starts from what the Startup left, plus the payment API', () => {
    expect(startArchitecture({ company, level: BLACK_FRIDAY }).nodes.map((n) => n.kind)).toEqual([
      'client',
      'cdn',
      'lb',
      'server',
      'server',
      'server',
      'server',
      'cache',
      'db',
      'payment',
    ])
  })
})

describe('progress migration', () => {
  it('a new player starts at the first level', () => {
    expect(loadProgress(storage({}))).toEqual({ passed: [], current: 'colocar-no-ar' })
  })

  it('keeps the passed list saved before career mode', () => {
    const p = loadProgress(storage({ [PASSED_KEY]: '["primeiro-deploy","banco-nao-aguenta"]' }))
    expect(p.passed).toEqual(['primeiro-deploy', 'banco-nao-aguenta'])
    expect(levelStatus('primeiro-deploy', p.passed)).toBe('done')
    expect(levelStatus('banco-nao-aguenta', p.passed)).toBe('done')
  })

  it('a player who beat the old three levels finds the new ones open and Black Friday where it is now', () => {
    const p = loadProgress(
      storage({
        [PASSED_KEY]: '["primeiro-deploy","banco-nao-aguenta","black-friday"]',
        [CURRENT_KEY]: JSON.stringify('black-friday'),
      }),
    )
    expect(p.passed).toContain('black-friday')
    expect(levelStatus('colocar-no-ar', p.passed)).toBe('open')
    expect(levelStatus('imagens-pesadas', p.passed)).toBe('open')
    expect(levelStatus('caiu-de-madrugada', p.passed)).toBe('locked')
    expect(levelStatus('materia-na-tv', p.passed)).toBe('locked')
    // Black Friday is back as the E-commerce boss: the player lands on it, done, with the company open.
    expect(p.current).toBe('black-friday')
    expect(levelStatus('checkout-travando', p.passed)).toBe('open')
  })

  it('a level passed out of order stays done, and the skipped ones stay playable', () => {
    const p = loadProgress(storage({ [PASSED_KEY]: '["banco-nao-aguenta"]' }))
    expect(levelStatus('banco-nao-aguenta', p.passed)).toBe('done')
    expect(levelStatus('primeiro-deploy', p.passed)).toBe('open')
    expect(levelStatus('colocar-no-ar', p.passed)).toBe('open')
    expect(p.current).toBe('colocar-no-ar')
  })

  it('ignores corrupt or foreign data instead of crashing', () => {
    expect(loadProgress(storage({ [PASSED_KEY]: '{oops' })).passed).toEqual([])
    expect(loadProgress(storage({ [PASSED_KEY]: '{"a":1}' })).passed).toEqual([])
    expect(loadProgress(storage({ [PASSED_KEY]: '["primeiro-deploy",3,null,"primeiro-deploy"]' })).passed).toEqual([
      'primeiro-deploy',
    ])
  })

  it('reopens the level on screen only if it is still playable', () => {
    const passed = '["colocar-no-ar"]'
    expect(loadProgress(storage({ [PASSED_KEY]: passed, [CURRENT_KEY]: JSON.stringify('colocar-no-ar') })).current).toBe('colocar-no-ar')
    expect(loadProgress(storage({ [PASSED_KEY]: passed, [CURRENT_KEY]: JSON.stringify('materia-na-tv') })).current).toBe('primeiro-deploy')
    expect(loadProgress(storage({ [PASSED_KEY]: passed, [CURRENT_KEY]: JSON.stringify('apagada') })).current).toBe('primeiro-deploy')
  })

  it('ignores a corrupt level on screen', () => {
    expect(loadProgress(storage({ [PASSED_KEY]: '["colocar-no-ar"]', [CURRENT_KEY]: 'colocar-no-ar' })).current).toBe('primeiro-deploy')
    expect(loadProgress(storage({ [CURRENT_KEY]: '42' })).current).toBe('colocar-no-ar')
  })

  it('points at the last level when everything is done', () => {
    expect(nextLevel(LEVELS.map((l) => l.id))).toBe('fechamento-do-mes')
  })
})
