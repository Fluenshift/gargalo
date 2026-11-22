import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigate, pathOf, screenOf } from './route'
import type { Screen } from './route'

describe('screenOf', () => {
  it('maps each path to its screen and back', () => {
    for (const s of ['fase', 'carreira', 'perfil', 'livre', 'desafio', 'oficina', 'design'] as Screen[]) expect(screenOf(pathOf(s), '')).toBe(s)
  })

  it('ignores a trailing slash', () => {
    expect(screenOf('/carreira/', '')).toBe('carreira')
    expect(screenOf('', '')).toBe('fase')
  })

  it('keeps the old query fallbacks', () => {
    expect(screenOf('/', '?oficina')).toBe('oficina')
    expect(screenOf('/', '?design')).toBe('design')
  })

  it('opens a shared phase link and unknown paths on the phase', () => {
    expect(screenOf('/', '?fase=colocar-no-ar&d=abc')).toBe('fase')
    expect(screenOf('/nao-existe', '')).toBe('fase')
  })

  it('lets the path win over a query fallback', () => {
    expect(screenOf('/perfil', '?oficina')).toBe('perfil')
  })
})

describe('navigate', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (pathname: string, search = '') => {
    const pushState = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('location', { pathname, search })
    vi.stubGlobal('history', { pushState })
    vi.stubGlobal('dispatchEvent', dispatchEvent)
    vi.stubGlobal('PopStateEvent', class extends Event {})
    return { pushState, dispatchEvent }
  }

  it('pushes a new entry and announces it', () => {
    const { pushState, dispatchEvent } = stub('/')
    navigate('/carreira')
    expect(pushState).toHaveBeenCalledWith(null, '', '/carreira')
    expect(dispatchEvent.mock.calls[0][0].type).toBe('popstate')
  })

  it('does not stack the same screen twice', () => {
    const { pushState, dispatchEvent } = stub('/perfil')
    navigate('/perfil')
    expect(pushState).not.toHaveBeenCalled()
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })

  it('leaves a shared link for the plain phase', () => {
    const { pushState } = stub('/', '?fase=x&d=y')
    navigate('/')
    expect(pushState).toHaveBeenCalledWith(null, '', '/')
  })
})
