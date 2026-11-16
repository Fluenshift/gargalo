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
  // A funnel: more comes in than is let out.
  limiter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  // An arch: the one door every API call goes through.
  gateway: <path d="M4 21V11a8 8 0 0 1 16 0v10M2.5 21h19M9 21v-5a3 3 0 0 1 6 0v5" />,
  lb: <path d="M3 12h6M9 12l5-6h7M9 12h12M9 12l5 6h7" />,
  // A card: the payment API run by another company.
  payment: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19M6 15h4" />
    </>
  ),
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
  replica: (
    <>
      <path d="M4 14.5V5.5c0-1.2 2.7-2.2 6-2.2s6 1 6 2.2v1.3" />
      <path d="M4 14.5c0 .8 1.2 1.5 3 1.9" />
      <ellipse cx="14" cy="9.5" rx="6" ry="2.2" />
      <path d="M8 9.5v9c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-9" />
    </>
  ),
  // A cylinder cut into slices: one partition of the data.
  shard: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M9.5 8v13M14.5 8v13" />
    </>
  ),
  queue: (
    <>
      <rect x="2.5" y="7" width="15" height="10" rx="1" />
      <path d="M7.5 7v10M12.5 7v10M17.5 12h4M19.5 10l2 2-2 2" />
    </>
  ),
  worker: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
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
