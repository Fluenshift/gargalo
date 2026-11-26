import { describe, expect, it } from 'vitest'
import { docsFor } from './docs'

const HOSTS = ['hono.dev', 'developer.mozilla.org', 'www.postgresql.org', 'zod.dev', 'www.rfc-editor.org']

describe('official docs links', () => {
  for (const framework of ['hono', 'fetch'] as const) {
    it(`${framework}: every url is https on an allowlisted host`, () => {
      const urls = docsFor(framework)
        .flatMap((s) => s.entries)
        .flatMap((e) => (e.url ? [e.url] : []))
      expect(urls.length).toBeGreaterThan(0)
      for (const u of urls) {
        const { protocol, host } = new URL(u)
        expect([protocol, HOSTS.includes(host)], u).toEqual(['https:', true])
      }
    })
  }
})
