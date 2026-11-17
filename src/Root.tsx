import { Suspense, lazy } from 'react'
import App from './App.tsx'

// The internal design reference: /design or ?design. Loaded on demand, so the game never pays for it.
const DesignPage = lazy(() => import('./DesignPage.tsx'))

const isDesign = () => location.pathname.replace(/\/$/, '') === '/design' || new URLSearchParams(location.search).has('design')

export function Root() {
  return isDesign() ? (
    <Suspense fallback={null}>
      <DesignPage />
    </Suspense>
  ) : (
    <App />
  )
}
