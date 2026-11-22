import { Suspense, lazy } from 'react'
import App from './App.tsx'

// The internal design reference: /design or ?design. Loaded on demand, so the game never pays for it.
const DesignPage = lazy(() => import('./DesignPage.tsx'))
// The Oficina (/oficina or ?oficina) brings its editor and executor only when opened.
const Oficina = lazy(() => import('./Oficina.tsx'))

const isPage = (name: string) => location.pathname.replace(/\/$/, '') === `/${name}` || new URLSearchParams(location.search).has(name)

export function Root() {
  const Page = isPage('design') ? DesignPage : isPage('oficina') ? Oficina : null
  return Page ? (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  ) : (
    <App />
  )
}
