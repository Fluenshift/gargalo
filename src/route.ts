// One URL per screen, on the History API: the game has no router dependency.

export type Screen = 'fase' | 'carreira' | 'perfil' | 'livre' | 'desafio' | 'oficina' | 'design'

export const PATHS: Record<Screen, string> = {
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
  if (path.startsWith('/oficina/')) return 'oficina'
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

export const PROJETOS_PATH = '/oficina/projetos'

/** The project `/oficina/projetos/<id>` opens; every other Oficina path (the old exercises included) shows the list. */
export function oficinaPlace(pathname: string): { project?: string } {
  const [, , tab, id] = pathname.replace(/\/+$/, '').split('/')
  return tab === 'projetos' && id ? { project: decodeURIComponent(id) } : {}
}

/** A link's click handler: plain clicks go to its href in place; ctrl/middle click still opens a new tab. */
export function followLink(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void; currentTarget: Element }) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  navigate(e.currentTarget.getAttribute('href')!)
}
