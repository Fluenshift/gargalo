import { describe, expect, it } from 'vitest'
import { LEVELS, STARTUP_LEGACY } from '../levels'
import { runLevel } from './engine'
import { runInBackground } from './runner'

describe('runInBackground', () => {
  it('gives the same run as the engine, on the page when there is no worker', async () => {
    const level = LEVELS.find((l) => l.id === 'materia-na-tv')!
    expect(await runInBackground(STARTUP_LEGACY, level, 5)).toEqual(runLevel(STARTUP_LEGACY, level, 5))
  })
})
