# Oficina, Projetos: construir uma API do zero

Status: aprovada em 2026-11-22. Continua `docs/specs/oficina.md` (os exercícios ficam como estão).

## Por quê

Os exercícios treinam um handler isolado. O jogador quer construir um backend de verdade: vários arquivos, rotas, banco com migrações, testes de endpoint, ajuda enquanto escreve, em frameworks reais, e aprender boas práticas no caminho.

## Decisões

| # | Decisão | Escolha |
|---|---|---|
| 1 | Formato | **Projeto guiado** em etapas, cada uma com testes de aceitação; **sandbox** livre com a mesma estrutura. |
| 2 | Frameworks | Fase 1: **Hono** (a biblioteca real) e **fetch puro** (`export default { fetch }`, o formato de Bun, Deno e Cloudflare Workers). Fase 2: Fastify e Express, que dependem do `http` do Node e precisam de WebContainers (licença) ou servidor (custo). |
| 3 | Testar endpoints | Cliente HTTP embutido (método, URL, headers, body, resposta formatada, status, tempo, histórico, coleções) + testes automáticos por etapa. |
| 4 | Banco | PGlite persistente por projeto (IndexedDB), migrações SQL escritas pelo jogador, painel de tabelas, resetar. Os testes rodam num banco novo, em memória, a cada execução. |
| 5 | Arquivos | Árvore de arquivos com imports relativos entre eles. Pacotes permitidos numa lista fechada, embutidos no Worker: `hono`, `zod`. Sem `npm install` livre. |
| 6 | Ajuda | Dicas progressivas por etapa, erros explicados em português, mini-documentação do framework ao lado, botão "copiar contexto" para colar num assistente. IA embutida só numa fase 3. |
| 7 | Onde | Aba **Projetos** na Oficina, ao lado dos Exercícios. |
| 8 | Boas práticas | Cada etapa tem, além dos testes de comportamento, um **checklist de boas práticas** verificado: alguns itens por teste de comportamento, outros por análise do código. Itens cumpridos dão estrela. |

## Dependências novas

Conferidas no registro do npm em 2026-11-22 (regra "Dependencies" do CLAUDE.md), versões exatas, só no chunk do Worker da Oficina.

| Pacote | Para quê | Licença | Criado | Downloads/semana |
|---|---|---|---|---|
| `hono` | o framework que o jogador usa | MIT | 2021 | ~114 mi |
| `zod` | validação de entrada que o jogador usa | MIT | 2020 | ~474 mi |

## Como funciona

### O contrato

O arquivo de entrada é `src/index.ts`, e o default export precisa ter `fetch(req, env)`. Um app Hono já tem; no fetch puro o jogador escreve o objeto.

```ts
interface Env { db: Db }  // o mesmo Db dos exercícios: query, transaction
export default { fetch(req: Request, env: Env): Response | Promise<Response> }
```

No Hono, o banco chega em `c.env.db`.

### O runtime (no Worker da Oficina)

- **Sistema de arquivos virtual:** `Record<path, string>`, salvo por projeto no navegador.
- **Módulos:** cada arquivo passa pelo sucrase (TS → JS, ESM → CommonJS) e um carregador resolve `./` e `../` entre os arquivos do projeto e os pacotes da lista (`hono`, `hono/*` usados, `zod`). Qualquer outro import é bloqueado com mensagem clara. `fetch` externo continua bloqueado.
- **Migrações:** `migrations/NNN_nome.sql`, aplicadas em ordem e registradas numa tabela `_migrations`. No banco de desenvolvimento, aplicadas pelo botão "Aplicar migrações". Nos testes, todas, num banco novo.
- **Duas bases:** desenvolvimento (persistente, usado pelo cliente HTTP) e testes (efêmera).
- **Logs:** `console.log` do jogador aparece num console na tela, por requisição.
- **Tempo limite:** 2 s por requisição, como nos exercícios.

### Etapas

Cada etapa de um projeto define: enunciado, arquivos que ela cria ou espera, testes de aceitação (sequências de requisições com verificação de status, headers, corpo e estado do banco), checklist de boas práticas, 3 dicas, explicação depois de passar e uma solução de referência para Hono e para fetch puro. O projeto começa da referência da etapa anterior só se o jogador pedir ("pular para a etapa N"); senão, continua do próprio código.

### Boas práticas verificadas (catálogo inicial)

- Status certos: 201 + `Location` ao criar, 204 sem corpo, 404 e 409 com motivo.
- Erros num formato só: `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `detail`.
- Validação na borda (400 com os campos inválidos), por exemplo com `zod`.
- SQL sempre parametrizado (nenhuma concatenação de entrada em SQL).
- Camadas: rotas não falam SQL direto; acesso ao banco num módulo (`src/db/` ou repositório).
- Escrita de várias tabelas numa transação.
- Listas paginadas por cursor, com limite máximo.
- Nada de `SELECT *` em rotas públicas; sem vazar campos internos (senha, hash).
- Idempotência em POST de pagamento.
- Autenticação: senha com hash, token com expiração, 401 contra 403.

### Ajuda

- Dicas: uma liberada por execução que falha, por etapa.
- Erros explicados: um mapa de erros comuns para português, com o próximo passo (rota não registrada, método errado, JSON inválido, coluna não existe, violação de unicidade, import bloqueado, migração falhou, tempo esgotado).
- Documentação ao lado: referência curta do framework escolhido e do `Env`.
- "Copiar contexto": copia enunciado, arquivos, último teste que falhou e o erro, prontos para colar num assistente.

## Roteiro

1. **Runtime de projeto**: arquivos, módulos, pacotes, migrações, duas bases, logs.
2. **Tela Projetos**: árvore de arquivos, abas de editor, painel do banco, console.
3. **Cliente HTTP**.
4. **Etapas, testes de aceitação, checklist de boas práticas e ajuda**.
5. **Projeto 1, API de pedidos do E-commerce**, em Hono e fetch puro: health check; CRUD de produtos; pedidos com transação; validação com zod e erros problem+json; paginação e filtros; autenticação.
6. **OpenAPI gerado** a partir das rotas e das requisições testadas, mostrado na tela.
7. **Sua API no tabuleiro**: o custo medido por rota vira o servidor do simulador, na carga de uma fase.
8. **Projetos seguintes**: auth com JWT e refresh; rate limit por cliente; webhooks com retry e assinatura; fila de jobs com `SKIP LOCKED`.
9. **Revisão de código**: um projeto pronto com bugs plantados (SQL injection, condição de corrida, vazamento de dados, N+1) para achar e corrigir.
10. **Fase 2, Fastify e Express**: só quando houver um jeito barato e seguro de rodar `http` do Node.

## Fora de escopo agora

IA embutida, `npm install` livre, execução em servidor, colaboração.
