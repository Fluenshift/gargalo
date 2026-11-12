import type { ReactNode } from 'react'
import type { Kind } from './sim/model'

/** Line symbols from the usual architecture-diagram vocabulary. */
const PATHS: Record<Kind, ReactNode> = {
  client: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.1c2.9.4 5 2.8 5 5.9" />
    </>
  ),
  cdn: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  lb: <path d="M3 12h6M9 12l5-6h7M9 12h12M9 12l5 6h7" />,
  server: (
    <>
      <rect x="4" y="3.5" width="16" height="7" rx="1" />
      <rect x="4" y="13.5" width="16" height="7" rx="1" />
      <path d="M7.5 7h2M7.5 17h2" />
    </>
  ),
  cache: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
}

export function KindIcon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  return (
    <svg
      className="kind-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[kind]}
    </svg>
  )
}
