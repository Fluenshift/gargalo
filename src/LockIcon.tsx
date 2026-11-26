/** A padlock; labelled when it is the only thing saying something is locked. */
export function LockIcon({ label }: { label?: string }) {
  return (
    <svg className="lock" viewBox="0 0 16 16" width="14" height="14" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="3" y="7" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
