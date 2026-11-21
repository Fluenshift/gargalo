// The result as a picture: the goals sheet ("folha de metas") drawn on a canvas, in the page's own tokens.

export interface ShareCard {
  sheet: string
  title: string
  stars: number
  rows: { label: string; value: string; goal: string }[]
}

const W = 1200
const H = 630

/** Resolves a CSS custom property of the page, so the picture follows the theme. */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export async function drawShareCard(card: ShareCard): Promise<Blob> {
  const serif = token('--serif')
  const mono = token('--mono')
  // The page fonts load lazily; make sure the glyphs exist before drawing.
  await Promise.all([`400 48px ${serif}`, `400 22px ${mono}`, `500 22px ${mono}`].map((f) => document.fonts.load(f))).catch(() => {})
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')!
  const paper = token('--paper')
  const ink = token('--ink')
  const soft = token('--ink-soft')
  const line = token('--line')

  c.fillStyle = paper
  c.fillRect(0, 0, W, H)
  c.strokeStyle = line
  c.lineWidth = 1
  c.beginPath()
  c.roundRect(40.5, 40.5, W - 81, H - 81, 24)
  c.stroke()

  c.textBaseline = 'alphabetic'
  c.fillStyle = soft
  c.font = `400 22px ${mono}`
  c.fillText(card.sheet, 80, 112)
  c.fillStyle = ink
  c.font = `400 56px ${serif}`
  c.fillText(card.title, 80, 180)
  c.font = `400 44px ${mono}`
  c.textAlign = 'right'
  c.fillText('★'.repeat(card.stars) + '☆'.repeat(3 - card.stars), W - 80, 112)
  c.textAlign = 'left'

  let y = 230
  c.font = `500 18px ${mono}`
  c.fillStyle = soft
  c.fillText('MEDIDO', 80 + 360, y)
  c.fillText('META', 80 + 720, y)
  for (const row of card.rows) {
    y += 70
    c.strokeStyle = line
    c.beginPath()
    c.moveTo(80, y - 44)
    c.lineTo(W - 80, y - 44)
    c.stroke()
    c.fillStyle = soft
    c.font = `400 22px ${mono}`
    c.fillText(row.label, 80, y)
    c.fillStyle = ink
    c.font = `400 44px ${serif}`
    c.fillText(row.value, 80 + 360, y + 4)
    c.fillStyle = soft
    c.font = `400 22px ${mono}`
    c.fillText(row.goal, 80 + 720, y)
  }
  c.fillStyle = soft
  c.font = `400 20px ${mono}`
  c.fillText('gargalo · monte a arquitetura, o tráfego vem depois', 80, H - 72)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'))
}
