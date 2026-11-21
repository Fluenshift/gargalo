import { describe, expect, it } from 'vitest'
import { parseNumber } from './numbers'

describe('parseNumber', () => {
  it.each([
    ['2400', 2400],
    ['2.400', 2400],
    ['1.000.000', 1_000_000],
    ['2.400,5', 2400.5],
    ['0,5', 0.5],
    ['2.5', 2.5],
    [' 12 ', 12],
    ['12,', 12],
  ])('reads %s as %s', (text, n) => {
    expect(parseNumber(text)).toBe(n)
  })

  it.each(['', '  ', 'abc', '1,2,3'])('refuses %j', (text) => {
    expect(parseNumber(text)).toBeNaN()
  })
})
