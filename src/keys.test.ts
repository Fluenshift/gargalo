import { describe, expect, it } from 'vitest'
import { stepIndex } from './keys'

describe('stepIndex', () => {
  it('steps and wraps with the arrows', () => {
    expect(stepIndex('ArrowDown', 0, 3)).toBe(1)
    expect(stepIndex('ArrowDown', 2, 3)).toBe(0)
    expect(stepIndex('ArrowUp', 0, 3)).toBe(2)
    expect(stepIndex('ArrowUp', 2, 3)).toBe(1)
  })

  it('enters the list from outside at the near end', () => {
    expect(stepIndex('ArrowDown', -1, 3)).toBe(0)
    expect(stepIndex('ArrowUp', -1, 3)).toBe(2)
  })

  it('jumps to the ends with Home and End', () => {
    expect(stepIndex('Home', 1, 3)).toBe(0)
    expect(stepIndex('End', 1, 3)).toBe(2)
  })

  it('ignores other keys and empty lists', () => {
    expect(stepIndex('Enter', 1, 3)).toBeNull()
    expect(stepIndex('ArrowDown', -1, 0)).toBeNull()
  })
})
