/**
 * Light or dark sheet. "system" follows prefers-color-scheme; a picked theme is
 * kept in localStorage and set as data-theme on <html>, which App.css reads.
 * public/theme.js does the same before the first paint, so there is no flash.
 */
export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_KEY = 'gargalo:theme'

/** Browser-chrome colour per theme: the paper token of each. Keep in step with App.css and public/theme.js. */
export const PAPER = { light: '#f3f4f1', dark: '#0f1114' } as const

export function parseTheme(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** The theme actually on screen. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[resolveTheme(choice, systemDark())])
}

export function saveTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
  applyTheme(choice)
}
