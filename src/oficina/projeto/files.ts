// The project view's file tree and the rules for naming files. Paths are plain strings: folders exist only as prefixes.

/** The entry file: the runtime loads it, so it cannot be deleted or renamed. */
export const ENTRY = 'src/index.ts'

export interface TreeRow {
  kind: 'folder' | 'file'
  /** A file's path, or a folder's path without the trailing slash. */
  path: string
  name: string
  depth: number
}

/** The rows of the tree, folders before files at each level, each sorted by name. */
export function treeOf(paths: string[]): TreeRow[] {
  interface Dir {
    dirs: Map<string, Dir>
    files: string[]
  }
  const root: Dir = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] })
      dir = dir.dirs.get(part)!
    }
    dir.files.push(parts.at(-1)!)
  }
  const rows: TreeRow[] = []
  const walk = (dir: Dir, prefix: string, depth: number) => {
    for (const name of [...dir.dirs.keys()].sort()) {
      rows.push({ kind: 'folder', path: prefix + name, name, depth })
      walk(dir.dirs.get(name)!, `${prefix}${name}/`, depth + 1)
    }
    for (const name of dir.files.sort()) rows.push({ kind: 'file', path: prefix + name, name, depth })
  }
  walk(root, '', 0)
  return rows
}

/** Why `path` can't be a new file name (or the new name of `from`), or undefined when it can. */
export function pathProblem(path: string, files: Record<string, string>, from?: string): string | undefined {
  if (!path) return 'Escreva o caminho do arquivo, por exemplo src/routes/produtos.ts.'
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(path)) return 'Use letras, números, ponto, hífen e sublinhado, com / entre as pastas, sem / no começo ou no fim.'
  if (path.split('/').some((part) => part === '.' || part === '..')) return 'O caminho não pode ter . ou .. como pasta.'
  if (!/\.[a-z]+$/i.test(path)) return 'Dê uma extensão ao arquivo, como .ts ou .sql.'
  if (from === ENTRY) return `${ENTRY} é a entrada do projeto e não muda de nome.`
  if (path !== from && path in files) return `Já existe ${path}.`
  if (Object.keys(files).some((p) => p.startsWith(`${path}/`))) return `${path} é uma pasta.`
  if (Object.keys(files).some((p) => path.startsWith(`${p}/`))) return 'Uma pasta do caminho já é um arquivo.'
  return undefined
}

/** The files with `from` renamed to `to`, keeping its place in the order. */
export const renamed = (files: Record<string, string>, from: string, to: string) =>
  Object.fromEntries(Object.entries(files).map(([p, text]) => [p === from ? to : p, text]))

/** The files without `path`. */
export const without = (files: Record<string, string>, path: string) => Object.fromEntries(Object.entries(files).filter(([p]) => p !== path))

/** Whether the editor colours it as TypeScript (the rest is plain text in the mono font). */
export const isScript = (path: string) => /\.(ts|tsx|js|mjs)$/.test(path)

/** The file and line a console line ends with, as the runtime writes a logged error: `Error: x (src/index.ts:11)`. */
export function logLocation(text: string): { file: string; line: number } | undefined {
  const hit = /\(([\w./-]+):(\d+)\)$/.exec(text)
  return hit ? { file: hit[1], line: Number(hit[2]) } : undefined
}
