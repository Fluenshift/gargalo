// A minimal zip writer: STORE (no compression), CRC32, UTF-8 names. Enough for a few dozen small text files.

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS time and date words (2-second resolution, years from 1980). */
const dos = (d: Date) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() })

/** The zip of `files` (path to text), in the order given. */
export function zip(files: Record<string, string>, when = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dos(when)
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const put = (parts: [bytes: number, value: number][], ...tail: Uint8Array[]) => {
    const head = new DataView(new ArrayBuffer(parts.reduce((n, [b]) => n + b, 0)))
    let at = 0
    for (const [b, v] of parts) {
      if (b === 2) head.setUint16(at, v, true)
      else head.setUint32(at, v, true)
      at += b
    }
    return [new Uint8Array(head.buffer), ...tail]
  }
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path)
    const data = enc.encode(text)
    const crc = crc32(data)
    // version 20, flags 0x0800 (UTF-8 names), method 0 (store), time, date, crc, sizes, name length, extra length
    const common: [number, number][] = [[2, 20], [2, 0x0800], [2, 0], [2, time], [2, date], [4, crc], [4, data.length], [4, data.length], [2, name.length], [2, 0]]
    const local = put([[4, 0x04034b50], ...common], name, data)
    chunks.push(...local)
    central.push(...put([[4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]], name))
    offset += local.reduce((n, c) => n + c.length, 0)
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const count = Object.keys(files).length
  const end = put([[4, 0x06054b50], [2, 0], [2, 0], [2, count], [2, count], [4, size], [4, offset], [2, 0]])
  const all = [...chunks, ...central, ...end]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Reads a zip written by `zip` (stored entries only), checking each CRC; throws on any mismatch. Used by the tests and available to callers. */
export function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dec = new TextDecoder()
  const endAt = bytes.length - 22
  if (view.getUint32(endAt, true) !== 0x06054b50) throw new Error('zip sem fim de diretório')
  const files: Record<string, string> = {}
  let at = view.getUint32(endAt + 16, true)
  for (let i = view.getUint16(endAt + 10, true); i > 0; i--) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('entrada de diretório inválida')
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    if (crc32(data) !== crc) throw new Error(`CRC diferente em ${name}`)
    files[name] = dec.decode(data)
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return files
}
