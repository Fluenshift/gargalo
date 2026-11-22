import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { BrandMark } from './BrandMark'
import { loadProgress } from './career'
import { DAILY_KEY, dailyXp, dayNumber, loadDaily, localDate } from './daily'
import { navigate, pathOf } from './route'
import type { Screen } from './route'
import { RESULTS_KEY, loadResults, rankFor, totalXp } from './score'
import { ThemeToggle } from './ThemeToggle'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// shortcut: reads XP from storage on each render, so a tab whose saves failed shows the stored XP; pass it as a prop if that matters.
function storedXp(today: string): number {
  const { passed } = loadProgress(read)
  return totalXp(loadResults(read(RESULTS_KEY), passed)) + dailyXp(loadDaily(read(DAILY_KEY)), today)
}

/** The bar on top of every screen: brand, the other screens, XP and theme. At phone width the screens open from "Menu". */
export function TopBar({ screen }: { screen: Screen }) {
  const menu = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [today] = useState(() => localDate(new Date()))
  const xp = storedXp(today)
  const links: [Screen, string][] = [
    ['carreira', 'Carreira'],
    ['livre', 'Modo livre'],
    ['desafio', `Desafio do dia #${dayNumber(today)}`],
    ['oficina', 'Oficina'],
    ['perfil', 'Perfil'],
  ]
  const score = `${rankFor(xp).title} · ${xp.toLocaleString('pt-BR')} XP`

  // Plain clicks change screen in place; ctrl/middle click still opens a new tab.
  const follow = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    menu.current?.close()
    navigate(e.currentTarget.getAttribute('href')!)
  }
  const nav = (className: string) => (
    <nav className={className} aria-label="Telas">
      {links.map(([s, label]) => (
        <a
          key={s}
          href={pathOf(s)}
          onClick={follow}
          // The phase belongs to the career, so Carreira stays marked while playing one.
          aria-current={s === screen ? 'page' : s === 'carreira' && screen === 'fase' ? 'true' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  )

  return (
    <header className="topbar">
      <a className="topbar__brand" href="/" onClick={follow}>
        <BrandMark size={26} />
        gargalo
      </a>
      {nav('topbar__nav')}
      <span className="topbar__xp">{score}</span>
      <ThemeToggle />
      <button
        type="button"
        className="btn btn--ghost btn--small topbar__menu"
        aria-expanded={open}
        aria-controls="topbar-sheet"
        onClick={() => {
          menu.current?.showModal()
          setOpen(true)
        }}
      >
        Menu
      </button>
      {/* The native modal dialog traps focus, closes on Escape and gives focus back to Menu. */}
      <dialog
        ref={menu}
        id="topbar-sheet"
        className="topbar__sheet"
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          // Taken here, so the layers of the page behind stay as they are.
          e.preventDefault()
          menu.current?.close()
        }}
      >
        <div className="topbar__sheet-head">
          <span className="topbar__brand">
            <BrandMark size={22} />
            gargalo
          </span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => menu.current?.close()}>
            Fechar
          </button>
        </div>
        {nav('topbar__sheet-nav')}
        <p className="topbar__xp">{score}</p>
        {/* Mounted on open, so it reads a theme picked in the bar since. */}
        {open && <ThemeToggle />}
      </dialog>
    </header>
  )
}
