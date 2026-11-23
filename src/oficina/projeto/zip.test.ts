import { describe, expect, it } from 'vitest'
import { crc32, unzip, zip } from './zip'

describe('zip', () => {
  it('computes the standard CRC32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('reads back its own output: file list, UTF-8 names and contents, with CRCs checked', () => {
    const files = { 'src/index.ts': 'export default {}\n', 'README.md': 'Olá, mundo — ação\n', 'docs/ação.txt': '', '.gitignore': 'node_modules\n' }
    expect(unzip(zip(files))).toEqual(files)
    expect(Object.keys(unzip(zip(files)))).toEqual(Object.keys(files))
  })

  it('handles an empty archive', () => {
    expect(unzip(zip({}))).toEqual({})
  })

  it('refuses a corrupted entry', () => {
    const bytes = zip({ 'a.txt': 'conteúdo' })
    bytes[40] ^= 0xff
    expect(() => unzip(bytes)).toThrow(/CRC/)
  })

  it('refuses bytes that are not a zip', () => {
    expect(() => unzip(new Uint8Array(30))).toThrow()
  })

  it('stamps the date it is given', () => {
    const bytes = zip({ 'a.txt': 'x' }, new Date(2026, 10, 23, 10, 30, 8))
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(10, true)).toBe((10 << 11) | (30 << 5) | 4)
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 23)
  })
})
