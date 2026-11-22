import { describe, expect, it } from 'vitest'
import { buildContext } from './context'
import type { Project } from './project'

const project: Project = {
  id: 'p',
  framework: 'hono',
  files: {
    'migrations/001_init.sql': 'CREATE TABLE produtos (id serial PRIMARY KEY);',
    'src/routes/produtos.ts': 'export const x = 1',
    'src/index.ts': 'export default app',
  },
}

describe('buildContext', () => {
  it('has the stage, the framework, the files in order and the failure with its explanation', () => {
    const text = buildContext({
      project,
      stage: { title: 'CRUD de produtos', statement: 'Crie POST /produtos.' },
      failure: { name: 'cria produto', passed: false, message: 'Status diferente.', expected: 201, received: 404, file: 'src/index.ts', line: 3 },
      explanation: { title: 'Rota não encontrada', detail: 'Ninguém responde POST /produtos.', next: 'Registre a rota.' },
    })
    expect(text).toContain('# Etapa: CRUD de produtos')
    expect(text).toContain('Crie POST /produtos.')
    expect(text).toContain('Hono 4')
    expect(text.indexOf('### src/index.ts')).toBeLessThan(text.indexOf('### src/routes/produtos.ts'))
    expect(text.indexOf('### src/routes/produtos.ts')).toBeLessThan(text.indexOf('### migrations/001_init.sql'))
    expect(text).toContain('```sql')
    expect(text).toContain('## Último teste que falhou: cria produto')
    expect(text).toContain('Esperado: 201')
    expect(text).toContain('Recebido: 404')
    expect(text).toContain('Em: src/index.ts:3')
    expect(text).toContain('Próximo passo: Registre a rota.')
    expect(text).not.toContain('Cortado')
  })

  it('works without a stage or a failure', () => {
    const text = buildContext({ project: { ...project, framework: 'fetch' } })
    expect(text).toContain('fetch puro')
    expect(text).not.toContain('# Etapa')
    expect(text).not.toContain('Último teste')
  })

  it('cuts file contents to the cap and says which were cut', () => {
    const big: Project = { ...project, files: { 'src/index.ts': 'x'.repeat(5000), 'src/lib/a.ts': 'y'.repeat(5000) } }
    const text = buildContext({ project: big, maxChars: 1200 })
    expect(text).toContain('Cortado para caber em 1200 caracteres')
    expect(text).toMatch(/src\/index\.ts \(só os primeiros \d+ de 5000 caracteres\)|src\/lib\/a\.ts \(fora\)/)
    // The note is not counted, so the text stays near the cap rather than at the files' 10 000 characters.
    expect(text.length).toBeLessThan(1600)
  })
})
