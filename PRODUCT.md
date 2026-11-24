# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O jogador principal é um **iniciante em backend**: estudante ou dev que nunca montou uma API nem pensou em arquitetura. Ele chega sem saber o que digitar nem por onde começar e precisa ser guiado passo a passo, sem receber a solução pronta. Toda decisão serve a ele primeiro. Quem já tem experiência também joga, mas não é o alvo de projeto: se o dono, que já tem experiência, se perde na tela, o iniciante se perde mais (issues #150 e #151).

## Product Purpose

O gargalo ensina backend e system design na prática. Na carreira, o jogador monta a arquitetura (CDN, load balancer, servidores, cache, banco) e vê se ela aguenta o tráfego e as falhas de cada fase. Na Oficina, ele escreve a API, do primeiro arquivo ao sistema completo.

Sucesso é o jogador sair sabendo fazer sozinho o que fez no jogo: escrever uma rota, separar HTTP de SQL, ler a documentação oficial, entender por que uma arquitetura cai. Passar nos testes sem entender o que fez não conta.

## Positioning

- **A simulação mede de verdade.** O motor (fluxo por segundo + amostragem numa fila M/M/1) julga a arquitetura por disponibilidade, latência p99 e custo mensal, não por uma resposta certa.
- **Código real no navegador.** Na Oficina o jogador escreve TypeScript (Hono ou fetch puro) contra um Postgres de verdade (PGlite), sem instalar nada.
- **Do zero ao sistema.** O mesmo jogador vai da primeira rota (GET /ola) até a API com pedidos, validação, paginação e autenticação, num percurso contínuo.
- **Grátis e em português.** Custo zero, sem conta, tudo em pt-BR.

## Operating Context

- Jogo web, sem login. O progresso, os projetos e o banco de cada projeto ficam no navegador (localStorage + PGlite).
- Modos: **Carreira** (fases por empresa, com metas), **Modo livre**, **Desafio do dia** e **Oficina** (projetos guiados: E-commerce, Banco, Busca e paginação, Revisão de código).
- A Oficina tem um editor (CodeMirror), um painel Banco (migrações), um Console, uma aba Requisição (cliente HTTP) e o painel Etapa, com passos guiados, conferência por passo e testes com até 3 estrelas.
- O deploy é na Vercel, manual via CLI.

## Capabilities and Constraints

- **Custo zero, sem backend:** tudo roda no navegador, sem servidor, conta ou serviço pago.
- **Desktop primeiro:** pensado para computador, mas a 390 px dá para ler, editar e rodar.
- **Sem IA respondendo pelo jogador:** ele escreve o próprio código, e a ajuda vem como passo guiado, dica e documentação, não como solução pronta.
- **Em aberto:** a issue #128 propõe um assistente de IA com a chave do próprio jogador. Se vier, precisa respeitar a regra acima (orientar, não resolver).
- Texto de interface em português do Brasil. Código, identificadores e comentários de código do projeto em inglês. Código mostrado ao jogador é comentado em português.
- Nenhuma dependência nova sem aprovação do dono (CLAUDE.md).

## Brand Commitments

- Nome: **gargalo**, em minúsculas.
- Voz: português do Brasil, frase em caixa normal, verbos simples, direto ao jogador ("Faça agora: …").
- O jogo ensina: toda mecânica nova chega com o conceito e os tradeoffs (`src/concepts.ts`), e o que o jogador aprende muda algo na simulação.

## Evidence on Hand

- Motor e fases testados: cada fase tem uma solução de referência que passa e uma ingênua que falha (`src/sim/engine.test.ts`).
- Cursos da Oficina com referência por framework e um teste que simula um iniciante seguindo o Primeiros passos até 3 estrelas (`src/oficina/projeto/cursoPedidos.test.ts`).
- Não há depoimentos, número de jogadores nem métricas de uso. Não inventar.

## Product Principles

1. **O jogador sempre sabe o próximo passo.** Toda tela responde "o que eu faço agora?" com uma ação concreta, perto de onde ele vai agir.
2. **Do zero, nada sem explicação.** O jogador constrói, e o que vem pronto é lido e explicado antes de ser usado.
3. **Medir, não decorar.** Arquitetura e código são julgados pelo que fazem sob carga e por testes reais, não por resposta certa.
4. **Ensinar a pescar.** Leva à documentação oficial e às ferramentas de verdade, em vez de substituí-las.
5. **Grátis e leve.** Nada que exija servidor, conta ou pagamento.
