# Oficina: escrever backend de verdade

Status: aprovada em 2026-11-21. Épico e issues filhas no GitHub.

## Por quê

Hoje o jogador liga peças e, nos desafios de código, escolhe uma entre várias opções. Ninguém escreve código. A Oficina é um modo à parte onde o jogador escreve handlers de backend em TypeScript, contra um Postgres de verdade, e vê não só se o código funciona, mas se ele aguenta carga: a mesma lente de disponibilidade, p99 e custo do tabuleiro.

## Decisões

| # | Decisão | Escolha |
|---|---|---|
| 1 | Tipo de exercício | Duas trilhas. **Handlers** (HTTP + SQL) primeiro; **Algoritmos de infraestrutura** (rate limiter, LRU, backoff, circuit breaker, consistent hashing) num segundo lote. |
| 2 | Onde fica | Modo separado em `/oficina`, opcional, não trava a carreira. Link no cabeçalho do painel, ao lado de Modo livre. |
| 3 | Onde o código roda | No navegador, num Web Worker com tempo limite. Sem backend, custo zero. |
| 4 | Editor | CodeMirror 6, carregado só na Oficina. |
| 5 | Correção | Testes visíveis (rodar à vontade) + testes escondidos ao enviar. Uma dica liberada a cada envio que falha. Solução de referência e explicação só depois de passar. |
| 6 | Medir carga | O custo de cada requisição (consultas, linhas lidas, tempo) entra no motor existente, que estima p99 e disponibilidade a uma carga alvo. Estrelas por eficiência. |
| 7 | Recompensa | XP no mesmo perfil da carreira. |
| 8 | Formato do handler | API padrão da web: `export default async function handler(req: Request, ctx: Ctx): Promise<Response>`. Sem framework. |
| 9 | Banco | Postgres de verdade no navegador (PGlite). |
| 10 | Progressão | Projeto contínuo: a API das empresas da carreira. Cada exercício começa do código de referência do anterior, nunca do código do jogador. |
| 11 | Celular | Funciona a 390 px (ler, editar, rodar), pensado para desktop. |
| 12 | Persistência | Código salvo no navegador por exercício, com "Voltar ao início". |

## Dependências novas

Conferidas no registro do npm em 2026-11-21 (regra "Dependencies" do CLAUDE.md). Todas entram só no chunk da Oficina, carregado sob demanda.

| Pacote | Para quê | Licença | Criado | Downloads/semana |
|---|---|---|---|---|
| `@electric-sql/pglite` | Postgres em WASM, roda no Worker | Apache-2.0 | 2024 | ~44 mi |
| `codemirror` + `@codemirror/lang-javascript` | Editor com realce de TypeScript | MIT | 2012 / 2020 | ~17 mi / ~16 mi |
| `sucrase` | Tira os tipos do TypeScript antes de executar (o TS 7 é nativo e não roda no navegador) | MIT | 2017 | ~62 mi |

Sem checagem de tipos no navegador: erro de tipo aparece como teste falhando, com a mensagem do runtime.

## Como funciona

```
Tela /oficina (React, lazy)
 ├─ lista de exercícios, enunciado, editor, resultado dos testes
 └─ postMessage ──► Worker da Oficina
                     ├─ sucrase: TS → JS
                     ├─ PGlite: esquema + dados do exercício
                     ├─ ctx.db: conta consultas, linhas lidas (EXPLAIN), tempo
                     ├─ roda os testes (visíveis ou todos) com tempo limite
                     └─ devolve resultado por teste + custo por requisição
Custo por requisição ──► motor (src/sim) ──► p99, disponibilidade, estrelas
```

### O contrato do handler

```ts
interface Ctx {
  db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
    transaction<R>(fn: (tx: Ctx['db']) => Promise<R>): Promise<R>
  }
  now(): number // relógio controlado pelo teste
}

export default async function handler(req: Request, ctx: Ctx): Promise<Response>
```

- O jogador não importa nada. `Request`, `Response`, `URL`, `Headers` e `crypto.randomUUID` são os do próprio Worker.
- `import` e `fetch` ficam bloqueados: o código só fala com `ctx.db`.
- O Worker é reaproveitado entre execuções, com o Postgres já carregado (começa a carregar quando /oficina abre), e recriado se um teste passar do tempo limite (2 s por teste, o que trata loop infinito) ou se ele cair. Execuções não se sobrepõem: uma pedida durante outra entra na fila. Entre testes, o banco volta ao esquema do exercício, com `ROLLBACK` e `RESET ALL`; o código do jogador é avaliado de novo, em escopo novo, a cada execução.

### Testes

Cada exercício define, em TypeScript no repo:

- `schema` e `seed` (SQL);
- `visible[]` e `hidden[]`: casos com uma requisição (ou várias concorrentes) e uma verificação da resposta e/ou do estado do banco;
- `hints[]`: em ordem, uma liberada por envio que falha;
- `reference`: o código de referência, que passa em tudo;
- `naive`: um código ingênuo plausível, que precisa falhar (em teste ou em estrelas);
- `load`: carga alvo e metas para as estrelas.

Assim como nas fases (`engine.test.ts`), um teste unitário garante, para cada exercício, que a referência passa e a ingênua falha.

Requisições concorrentes (exercícios 5 e 6) são intercaladas nos `await` do handler. Isso basta para mostrar condições de corrida com uma conexão só: dois handlers que leem o saldo antes de qualquer um escrever.

### Carga e estrelas

Por requisição, o Worker mede: número de consultas, linhas lidas (somando o `EXPLAIN (ANALYZE, FORMAT JSON)` de cada consulta) e tempo do handler. Esse custo vira o `work` de um servidor e de um banco num nível sintético do motor, rodado na carga alvo do exercício.

- 1 estrela: passa em todos os testes.
- 2 estrelas: passa e cumpre a meta de p99 na carga alvo.
- 3 estrelas: passa e cumpre a meta de p99 e de consultas por requisição (a da referência).

XP: os resultados entram em `gargalo:results` com id `oficina:<exercício>` e usam as constantes de `src/score.ts`.

## Primeiro lote: trilha Handlers

Projeto contínuo; o esquema cresce exercício a exercício.

| # | Empresa | Exercício | O que treina |
|---|---|---|---|
| 1 | Startup | `POST /usuarios`: cadastro com validação | 400 com mensagem certa, 409 em e-mail repetido, 201 com `Location` |
| 2 | Startup | `GET /usuarios?cursor=`: paginação por cursor | Ordem estável, cursor opaco, sem `OFFSET` |
| 3 | E-commerce | `GET /pedidos/:id`: pedido com itens | Sem N+1 (JOIN ou `ANY`) |
| 4 | E-commerce | `GET /produtos?busca=`: busca lenta | Criar índice e conferir com `EXPLAIN` |
| 5 | Fintech | `POST /pagamentos` com `Idempotency-Key` | Mesmo pagamento duas vezes cobra uma vez, inclusive em paralelo |
| 6 | Fintech | `POST /transferencias` | Sem saldo negativo com requisições concorrentes (atualização condicional ou transação) |

Depois: mais exercícios da trilha Handlers (autenticação, upload do Streaming, rate limit por cliente) e a trilha Algoritmos.

## Fora de escopo

- Execução no servidor, ranking, contas de usuário.
- Checagem de tipos no navegador.
- Outras linguagens.

## Pronto quando (épico)

- `/oficina` abre os 6 exercícios; editar, rodar testes visíveis e enviar funcionam a 1440, 1280 e 390 px.
- Para cada exercício, a referência passa e a ingênua falha, num teste unitário.
- Loop infinito e `import` são tratados com mensagem clara, sem travar a página.
- Estrelas e XP aparecem no resultado e no perfil.
- O chunk inicial do jogo não cresce: PGlite, CodeMirror e sucrase só carregam em `/oficina`.
