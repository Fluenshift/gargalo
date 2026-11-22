// One URL per screen, on the History API: the game has no router dependency.

export type Screen = 'fase' | 'carreira' | 'perfil' | 'livre' | 'desafio' | 'oficina' | 'design'

const PATHS: Record<Screen, string> = {
  fase: '/',
  carreira: '/carreira',
  perfil: '/perfil',
  livre: '/livre',
  desafio: '/desafio',
  oficina: '/oficina',
  design: '/design',
}

export const pathOf = (screen: Screen) => PATHS[screen]

/** The screen a URL opens. Unknown paths open the current phase; `?oficina` and `?design` still work on `/`. */
export function screenOf(pathname: string, search: string): Screen {
  const path = pathname.replace(/\/+$/, '') || '/'
  const hit = (Object.keys(PATHS) as Screen[]).find((s) => PATHS[s] === path)
  if (hit && hit !== 'fase') return hit
  const params = new URLSearchParams(search)
  if (params.has('design')) return 'design'
  if (params.has('oficina')) return 'oficina'
  return 'fase'
}

/** Goes to `path` as a new history entry (none when already there) and tells the screens, like the back button does. */
export function navigate(path: string) {
  if (location.pathname + location.search !== path) history.pushState(null, '', path)
  dispatchEvent(new PopStateEvent('popstate'))
}
