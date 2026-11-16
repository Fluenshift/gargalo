/** Stars earned out of three, in ink: filled and outline glyphs, never a colour. */
export function Stars({ count }: { count: number }) {
  return (
    <span className="stars" role="img" aria-label={`${count} de 3 estrelas`}>
      {'★'.repeat(count)}
      {'☆'.repeat(3 - count)}
    </span>
  )
}
