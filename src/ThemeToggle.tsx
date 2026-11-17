import { useEffect, useState } from 'react'
import { applyTheme, readTheme, saveTheme } from './theme'
import type { ThemeChoice } from './theme'

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
]

/** Light, dark or follow the system: three pressed-state buttons, like the other segmented controls. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)

  // Following the system: keep the browser-chrome colour in step when the OS switches.
  useEffect(() => {
    if (choice !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [choice])

  return (
    <div className="segmented segmented--small theme-toggle" role="group" aria-label="Tema">
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={choice === c.value}
          onClick={() => {
            saveTheme(c.value)
            setChoice(c.value)
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
