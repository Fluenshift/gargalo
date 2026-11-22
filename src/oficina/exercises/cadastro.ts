import type { OficinaExercise } from '../exercises'

export const STARTUP_SCHEMA = 'CREATE TABLE usuarios (id serial PRIMARY KEY, nome text NOT NULL, email text NOT NULL UNIQUE);'

const post = (body: unknown) => ({ method: 'POST', path: '/usuarios', body })
const count = (email: string) => ({ sql: 'SELECT count(*)::int AS n FROM usuarios WHERE email = $1', params: [email] })

export const cadastro: OficinaExercise = {
  id: 'cadastro',
  company: 'Startup',
  title: 'POST /usuarios: cadastro com validação',
  statement:
    'A Startup abriu o cadastro. Em POST /usuarios, com { "nome", "email" } no corpo, grave o usuário na tabela usuarios e responda 201 com { id, nome, email } e o cabeçalho Location: /usuarios/<id>. ' +
    'Recuse com 400 e { "erro": "O nome é obrigatório." } quando o nome faltar ou vier em branco, e com { "erro": "E-mail inválido." } quando o e-mail não tiver a forma nome@dominio.tld. ' +
    'Guarde o e-mail em minúsculas: Ana@X.com e ana@x.com são o mesmo. E-mail já cadastrado responde 409 com { "erro": "E-mail já cadastrado." }, inclusive quando duas pessoas mandam o mesmo e-mail ao mesmo tempo. ' +
    'A coluna email já é UNIQUE.',
  schema: STARTUP_SCHEMA,
  seed: "INSERT INTO usuarios (nome, email) VALUES ('Bruno', 'bruno@exemplo.com');",
  starter: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const { nome, email } = (await req.json()) as { nome: string; email: string }
  const [usuario] = await ctx.db.query('INSERT INTO usuarios (nome, email) VALUES ($1, $2) RETURNING id, nome, email', [nome, email])
  return Response.json(usuario)
}
`,
  visible: [
    {
      name: 'cadastra e responde 201 com Location',
      requests: [
        {
          request: post({ nome: 'Ana', email: 'ana@exemplo.com' }),
          expect: { status: 201, headers: { location: '/usuarios/2' }, body: { id: 2, nome: 'Ana', email: 'ana@exemplo.com' } },
        },
      ],
      db: { ...count('ana@exemplo.com'), rows: [{ n: 1 }] },
    },
    { name: 'recusa nome em branco', requests: [{ request: post({ nome: '  ', email: 'ana@exemplo.com' }), expect: { status: 400, body: { erro: 'O nome é obrigatório.' } } }] },
    { name: 'recusa e-mail repetido', requests: [{ request: post({ nome: 'Outro Bruno', email: 'bruno@exemplo.com' }), expect: { status: 409, body: { erro: 'E-mail já cadastrado.' } } }] },
  ],
  hidden: [
    { name: 'recusa corpo sem campos', requests: [{ request: post({}), expect: { status: 400, body: { erro: 'O nome é obrigatório.' } } }] },
    { name: 'recusa e-mail sem domínio', requests: [{ request: post({ nome: 'Ana', email: 'ana@' }), expect: { status: 400, body: { erro: 'E-mail inválido.' } } }] },
    { name: 'recusa e-mail que não é texto', requests: [{ request: post({ nome: 'Ana', email: 42 }), expect: { status: 400, body: { erro: 'E-mail inválido.' } } }] },
    {
      name: 'e-mail com maiúsculas é o mesmo',
      requests: [{ request: post({ nome: 'Bruno', email: 'Bruno@Exemplo.com' }), expect: { status: 409, body: { erro: 'E-mail já cadastrado.' } } }],
    },
    {
      name: 'dois cadastros iguais ao mesmo tempo',
      requests: [
        { request: post({ nome: 'Carla', email: 'carla@exemplo.com' }), expect: { status: 201, body: { nome: 'Carla' } } },
        { request: post({ nome: 'Carla', email: 'carla@exemplo.com' }), expect: { status: 409, body: { erro: 'E-mail já cadastrado.' } } },
      ],
      db: { ...count('carla@exemplo.com'), rows: [{ n: 1 }] },
    },
  ],
  hints: [
    'Valide antes de tocar no banco: cada campo com seu 400. Para o e-mail repetido, quem decide é a restrição UNIQUE da tabela, não uma consulta antes do INSERT.',
    'Conferir com SELECT e depois inserir abre uma janela: duas requisições ao mesmo tempo passam pelo SELECT antes de qualquer INSERT. Faça só o INSERT e trate o erro que ele lança.',
    "O Postgres lança um erro com code === '23505' (unique_violation) quando o UNIQUE barra o INSERT: try { INSERT ... RETURNING id, nome, email } catch (err) { if (err.code === '23505') return 409 }.",
  ],
  reference: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method === 'POST') return cadastrar(req, ctx)
  return Response.json({ erro: 'Rota não encontrada.' }, { status: 404 })
}

async function cadastrar(req: Request, ctx: Ctx): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { nome?: unknown; email?: unknown } | null
  const nome = typeof body?.nome === 'string' ? body.nome.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!nome) return Response.json({ erro: 'O nome é obrigatório.' }, { status: 400 })
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
  try {
    const [usuario] = await ctx.db.query<{ id: number }>(
      'INSERT INTO usuarios (nome, email) VALUES ($1, $2) RETURNING id, nome, email',
      [nome, email],
    )
    return Response.json(usuario, { status: 201, headers: { location: \`/usuarios/\${usuario.id}\` } })
  } catch (err) {
    // 23505: o UNIQUE barrou. Quem decide é o banco, então duas requisições ao mesmo tempo não passam as duas.
    if ((err as { code?: string }).code === '23505') return Response.json({ erro: 'E-mail já cadastrado.' }, { status: 409 })
    throw err
  }
}
`,
  // Checks with a SELECT first: right one at a time, but two requests at once both pass the check and the second INSERT throws.
  naive: `export default async function handler(req: Request, ctx: Ctx): Promise<Response> {
  const body = (await req.json()) as { nome?: string; email?: string }
  const nome = body.nome?.trim()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!nome) return Response.json({ erro: 'O nome é obrigatório.' }, { status: 400 })
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
  const existe = await ctx.db.query('SELECT 1 FROM usuarios WHERE email = $1', [email])
  if (existe.length) return Response.json({ erro: 'E-mail já cadastrado.' }, { status: 409 })
  const [usuario] = await ctx.db.query<{ id: number }>('INSERT INTO usuarios (nome, email) VALUES ($1, $2) RETURNING id, nome, email', [nome, email])
  return Response.json(usuario, { status: 201, headers: { location: \`/usuarios/\${usuario.id}\` } })
}
`,
  explanation:
    'A validação responde antes de qualquer consulta, com uma mensagem por campo: quem chama sabe o que corrigir. O e-mail repetido fica com o banco: o INSERT tenta, e a restrição UNIQUE recusa com o erro 23505, que vira 409. ' +
    'Conferir com SELECT antes funciona com uma pessoa por vez, mas duas requisições ao mesmo tempo passam as duas pelo SELECT e a segunda estoura no INSERT. Além de correto, é uma consulta a menos. ' +
    'O custo: o erro do banco vira parte do contrato (o código 23505), e cada tentativa recusada ainda gasta um número da sequência de ids.',
  // At 150 req/s the reference answers in ~145 ms p99 (under 190 ms even with a 50 ms handler); see exercises.test.ts.
  load: { rps: 150, p99Ms: 200, queriesPerRequest: 1 },
}
