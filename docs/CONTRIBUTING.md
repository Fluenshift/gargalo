# Contribuir: branches, commits e PRs

Como nomear a branch, escrever os commits e abrir o PR no gargalo, e o que cada push dispara no CI e na Vercel. Vale para pessoas e agentes; os exemplos saem do histórico do repositório.

## 1. Branch

Uma branch por issue, criada a partir da `main` atualizada, com o nome `<tipo>/<resumo>` em português e kebab-case. Quando há issue, o número abre o resumo: `fix/158-rolagem-lateral`.

| Tipo | Para quê |
|---|---|
| `feat/` | funcionalidade nova ou mudança visível |
| `fix/` | correção de bug |
| `chore/` | CI, dependências, configuração e manutenção |
| `docs/` | só documentação: `*.md`, `docs/` e `.claude/` (instruções de agente) |

Uma branch `docs/` não ganha preview na Vercel. Mudança que o jogador vê vai em `feat/` ou `fix/`, para o preview existir.

Pronto quando: o nome diz o tipo, o assunto e, se houver, o número da issue.

## 2. Commits

[Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/) com a descrição em português: `<tipo>(<escopo>): <descrição>`.

- **Tipo:** `feat`, `fix`, `perf`, `refactor`, `test`, `style`, `docs`, `ci` ou `chore`.
- **Escopo:** a área, em português: `oficina`, `interface`, `carreira`, `motor`, `pecas`, `modo-livre`, `skills`; `deps` para dependências. Mudança sem uma área só vai sem escopo.
- **Descrição:** o que muda, no presente, começando em minúscula (nome próprio continua com maiúscula): `fix(interface): Oficina não rola mais para o lado`.
- **Corpo:** quando o porquê não cabe na descrição, um ou dois parágrafos sobre o problema e a escolha feita.

Um commit por mudança lógica. Pronto quando: `git log --oneline origin/main..` se lê como a lista do que o PR faz.

## 3. Pull request

- **Título** em português, dizendo o que muda. Os dois formatos em uso servem: `Oficina: a página não rola mais para o lado` ou `feat(oficina): passos guiados nas etapas restantes do E-commerce`.
- **Corpo** em português, a partir do [template](../.github/PULL_REQUEST_TEMPLATE.md). Quando fecha uma issue, a última linha é `Closes #N`.
- Abra pronto para revisão. O merge é do dono do projeto; um agente só faz merge quando alguém pede na conversa, com merge commit: `gh pr merge <n> --merge --delete-branch`.

Pronto quando: os checks do PR estão verdes. Num PR só de documentação, a Quality Gate passa em segundos, sem instalar nem testar.

## 4. Depois do merge

O GitHub mantém as branches mergeadas. Apague a branch local e no `origin` (o `--delete-branch` acima faz as duas coisas) e rode `git worktree remove` no worktree dela, se houver.

Pronto quando: `git branch -a` e `git worktree list` não mostram mais a branch.

## O que cada push dispara

| Push | Quality Gate | Dependency Review | Vercel |
|---|---|---|---|
| PR para a `main` | roda; se o PR só muda `**.md`, `.claude/**` e `docs/**`, passa sem instalar nem testar | roda | preview, salvo branch `docs/*` |
| Merge na `main` | roda, com a mesma regra | não roda | deploy no site oficial, `gargalo-one.vercel.app` (projeto `gargallo` da Vercel) |
| Branch sem PR | não roda | não roda | preview, salvo branch `docs/*` |

A Quality Gate e o Dependency Review estão em `.github/workflows/`. A Vercel faz preview de todo push por padrão; a exceção de `docs/*` está no `vercel.json` (`git.deploymentEnabled`). O site oficial, `gargalo-one.vercel.app`, é um domínio do projeto `gargallo`, ligado ao GitHub: todo merge na `main` o publica, sem deploy manual. O projeto `gargalo` da Vercel ficou sem domínio e não é mais usado.
