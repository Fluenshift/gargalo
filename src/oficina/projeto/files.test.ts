import { describe, expect, it } from 'vitest'
import { starter } from './project'
import { ENTRY, isScript, logLocation, pathProblem, renamed, treeOf, without } from './files'

const files = starter('p', 'hono').files

describe('file tree', () => {
  it('lists folders before files at each level, by name, with their depth', () => {
    expect(treeOf(Object.keys(files)).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'folder' ? r.name + '/' : r.name}`)).toEqual([
      'migrations/',
      '  001_init.sql',
      'src/',
      '  routes/',
      '    health.ts',
      '  env.ts',
      '  index.ts',
    ])
    expect(treeOf(['README.md', 'a/b.ts'])).toEqual([
      { kind: 'folder', path: 'a', name: 'a', depth: 0 },
      { kind: 'file', path: 'a/b.ts', name: 'b.ts', depth: 1 },
      { kind: 'file', path: 'README.md', name: 'README.md', depth: 0 },
    ])
  })
})

describe('file names', () => {
  it('accepts a new path in a new or existing folder', () => {
    expect(pathProblem('src/routes/x.ts', files)).toBeUndefined()
    expect(pathProblem('migrations/002_pedidos.sql', files)).toBeUndefined()
    expect(pathProblem('src/routes/health.ts', files, 'src/routes/health.ts')).toBeUndefined()
  })

  it('refuses empty, odd, relative, extensionless, taken and clashing paths, and renaming the entry', () => {
    expect(pathProblem('', files)).toMatch('Escreva')
    for (const bad of ['/src/a.ts', 'src/a.ts/', 'src//a.ts', 'src/a b.ts']) expect(pathProblem(bad, files)).toMatch('Use letras')
    expect(pathProblem('src/../a.ts', files)).toMatch('..')
    expect(pathProblem('src/routes/x', files)).toMatch('extensão')
    expect(pathProblem('src/env.ts', files)).toBe('Já existe src/env.ts.')
    expect(pathProblem('src/routes.ts', { 'src/routes.ts/a.ts': '' })).toMatch('pasta')
    expect(pathProblem('src.ts', { 'src.ts/a.ts': '' })).toBe('src.ts é uma pasta.')
    expect(pathProblem('src/env.ts/a.ts', files)).toMatch('já é um arquivo')
    expect(pathProblem('src/main.ts', files, ENTRY)).toMatch('entrada')
  })

  it('renames in place and deletes', () => {
    const next = renamed(files, 'src/env.ts', 'src/tipos.ts')
    expect(Object.keys(next)).toEqual(Object.keys(files).map((p) => (p === 'src/env.ts' ? 'src/tipos.ts' : p)))
    expect(next['src/tipos.ts']).toBe(files['src/env.ts'])
    expect(Object.keys(without(files, 'src/env.ts'))).not.toContain('src/env.ts')
  })

  it('colours scripts, not SQL', () => {
    expect(isScript('src/index.ts')).toBe(true)
    expect(isScript('migrations/001_init.sql')).toBe(false)
  })
})

describe('log locations', () => {
  it('finds the file and line a logged error ends with', () => {
    expect(logLocation('Error: boom (src/index.ts:11)')).toEqual({ file: 'src/index.ts', line: 11 })
    expect(logLocation('oi (tchau)')).toBeUndefined()
  })
})
