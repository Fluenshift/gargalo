/**
 * The gargalo symbol: a bottle neck drawn in section. Requests queue in the
 * wide body and leave one at a time through the neck, which runs hot.
 * Same line language as KindIcon; source files live in public/logo*.svg.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
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
      <path d="M2 4h7c3.5 0 4.5 5 8 5h5M2 20h7c3.5 0 4.5-5 8-5h5M4 8h3M4 12h3M4 16h3" />
      <path className="brand-mark__neck" d="M11 12h9" />
    </svg>
  )
}
