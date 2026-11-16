import { describe, expect, it } from 'vitest'
import { ECOMMERCE_LEVELS } from '../levels'
import { levelRegions } from './model'
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
