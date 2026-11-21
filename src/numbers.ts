// Numbers as the player types them.

/**
 * A number as a Brazilian player types it: a comma for decimals and dots for thousands ("2.400"
 * is two thousand four hundred). A lone dot with other than three digits after it is a decimal point.
 */
export function parseNumber(text: string): number {
  const t = text.trim().replace(/\s/g, '')
  if (t === '') return NaN
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  return Number(t.replace(',', '.'))
}
