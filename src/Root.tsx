import { Suspense, lazy, useEffect, useState } from 'react'
import App from './App.tsx'
import { screenOf } from './route'

// The internal design reference: /design or ?design. Loaded on demand, so the game never pays for it.
const DesignPage = lazy(() => import('./DesignPage.tsx'))
// The Oficina (/oficina or ?oficina) brings its editor and executor only when opened.
const Oficina = lazy(() => import('./Oficina.tsx'))

const here = () => screenOf(location.pathname, location.search)

export function Root() {
  const [screen, setScreen] = useState(here)
  // Back, forward and the top bar's links all arrive as popstate.
  useEffect(() => {
    const onPop = () => setScreen(here())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const Page = screen === 'design' ? DesignPage : screen === 'oficina' ? Oficina : null
  return Page ? (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  ) : (
    <App />
  )
}
