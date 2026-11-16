import { describe, expect, it } from 'vitest'
import { ECOMMERCE_LEVELS } from '../levels'
import { endpointsOf, levelRegions } from './model'
import type { Level } from './model'

const base = ECOMMERCE_LEVELS[0]

describe('levelRegions', () => {
  it('is the home region only for a level without users or outages set', () => {
    expect(levelRegions(base)).toEqual(['sa'])
  })

  it('joins the regions of the users and of the outages, in a fixed order', () => {
    const level: Level = { ...base, users: { eu: 0.2, us: 0.8 }, regionOutages: [{ region: 'sa', from: 1, to: 2 }] }
    expect(levelRegions(level)).toEqual(['sa', 'us', 'eu'])
  })
})

describe('endpointsOf', () => {
  it('lists the mix as routes, busiest first, with the level names when it has them', () => {
    const level = { mix: { static: 0, read: 0.7, write: 0.3 }, endpoints: { write: 'POST /transferencias' } } as unknown as Level
    expect(endpointsOf(level).map((e) => [e.route, e.share])).toEqual([
      ['GET /produtos/:id', 0.7],
      ['POST /transferencias', 0.3],
    ])
  })
})
