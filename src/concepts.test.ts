import { describe, expect, it } from 'vitest'
import { CONCEPTS, GLOSSARY, splitTerms } from './concepts'
import type { Segment } from './concepts'
import { LEVELS } from './levels'
import { SPECS } from './sim/model'
import type { Kind } from './sim/model'

const terms = (segments: Segment[]) => segments.flatMap((s) => (typeof s === 'string' ? [] : [s.entry.id]))
const joined = (segments: Segment[]) => segments.map((s) => (typeof s === 'string' ? s : s.text)).join('')

describe('CONCEPTS', () => {
  it('covers every kind with all sections filled', () => {
    for (const kind of Object.keys(SPECS) as Kind[]) {
      const c = CONCEPTS[kind]
      expect(c, kind).toBeDefined()
      expect(c.whatIs.length, kind).toBeGreaterThan(0)
      expect(c.whenToUse.length, kind).toBeGreaterThan(0)
      for (const list of [c.gains, c.costs, c.mistakes]) {
        expect(list.length, kind).toBeGreaterThan(0)
        expect(list.length, kind).toBeLessThanOrEqual(3)
      }
    }
  })

  it('keeps texts short', () => {
    for (const [kind, c] of Object.entries(CONCEPTS)) {
      const all = [c.whatIs, c.whenToUse, ...c.gains, ...c.costs, ...c.mistakes]
      for (const t of all) expect(t.length, `${kind}: ${t}`).toBeLessThanOrEqual(160)
      expect(all.join(' ').length, kind).toBeLessThanOrEqual(900)
    }
  })
})

describe('GLOSSARY', () => {
  it('has unique ids and definitions', () => {
    const ids = GLOSSARY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of GLOSSARY) expect(e.definition.length, e.id).toBeGreaterThan(0)
  })

  it('includes the terms the game shows', () => {
    const names = GLOSSARY.map((e) => e.term)
    for (const t of ['p99', 'throughput', 'req/s', 'health check', 'utilização', 'latência', 'disponibilidade',
      'escalar horizontalmente', 'ponto único de falha', 'backpressure', 'backlog', 'consistência eventual',
      'atraso de replicação', 'leitura desatualizada']) {
      expect(names).toContain(t)
    }
  })
})

// What each level teaches: a piece (explained in CONCEPTS) or a term (in GLOSSARY).
const LEVEL_CONCEPTS: Record<string, string[]> = {
  'colocar-no-ar': ['db', 'sem-estado'],
  'primeiro-deploy': ['lb', 'escalar-horizontalmente'],
  'banco-nao-aguenta': ['cache', 'miss'],
  'imagens-pesadas': ['cdn', 'estaticos'],
  'caiu-de-madrugada': ['redundancia', 'ponto-unico', 'health-check'],
  'materia-na-tv': ['folga'],
  'checkout-travando': ['queue', 'assincrono'],
  'catalogo-gigante': ['replica', 'leitura-desatualizada'],
  'bot-de-precos': ['limiter', 'bot', 'rate-limit'],
  'pagamento-instavel': ['circuit-breaker', 'backoff', 'tempestade-retries'],
  'black-friday': ['folga', 'limiter', 'replica'],
  'transferencia-duplicada': ['idempotencia', 'falha-transitoria', 'retry'],
  'livro-razao': ['db', 'chave-quente', 'particao'],
  'clientes-na-europa': ['regiao', 'consistencia-forte', 'consistencia-eventual', 'latencia-entre-regioes'],
  'fechamento-do-mes': ['cap', 'failover', 'ativo-passivo'],
  'pedidos-em-loop': ['n-mais-um', 'db'],
  'catalogo-sem-paginacao': ['paginacao', 'server'],
  'extrato-lento': ['indice', 'db'],
}

describe('level concepts', () => {
  it('every level teaches something the concepts module explains', () => {
    const known = new Set([...Object.keys(CONCEPTS), ...GLOSSARY.map((e) => e.id)])
    for (const level of LEVELS) {
      const taught = LEVEL_CONCEPTS[level.id]
      expect(taught, level.id).toBeDefined()
      for (const id of taught) expect(known.has(id), `${level.id}: ${id}`).toBe(true)
    }
  })
})

describe('splitTerms', () => {
  it('marks terms and keeps the text intact', () => {
    const text = 'O p99 sobe quando a utilização passa de 80%.'
    const out = splitTerms(text)
    expect(terms(out)).toEqual(['p99', 'utilizacao'])
    expect(joined(out)).toBe(text)
  })

  it('ignores case and keeps the original spelling', () => {
    const out = splitTerms('Cache frio depois de reiniciar.')
    expect(out[0]).toEqual({ text: 'Cache frio', entry: GLOSSARY.find((e) => e.id === 'cache-frio') })
  })

  it('does not match inside longer words', () => {
    expect(terms(splitTerms('Bordado e latênciaX não são termos.'))).toEqual([])
  })

  it('prefers the longest form', () => {
    expect(terms(splitTerms('Serve arquivos estáticos.'))).toEqual(['estaticos'])
    expect(joined(splitTerms('Serve arquivos estáticos.'))).toBe('Serve arquivos estáticos.')
    expect(splitTerms('Serve arquivos estáticos.')[1]).toMatchObject({ text: 'arquivos estáticos' })
  })

  it('matches extra forms', () => {
    expect(terms(splitTerms('Escritas e misses vão ao banco.'))).toEqual(['miss'])
  })

  it('links each term once across calls sharing `seen`', () => {
    const seen = new Set<string>()
    expect(terms(splitTerms('p99 e p99', seen))).toEqual(['p99'])
    expect(terms(splitTerms('de novo o p99', seen))).toEqual([])
  })

  it('returns plain text when nothing matches', () => {
    expect(splitTerms('Nada aqui.')).toEqual(['Nada aqui.'])
    expect(splitTerms('')).toEqual([])
  })
})
