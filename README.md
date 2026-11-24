# gargalo

Jogo de backend e system design. Na carreira, monte uma arquitetura (CDN, load balancer, servidores, cache, banco) e veja se ela aguenta o tráfego e as falhas de cada fase. A pontuação usa disponibilidade, latência p99 e custo mensal. Na Oficina, escreva a API em TypeScript (Hono ou fetch puro) contra um Postgres de verdade (PGlite), no navegador.

## Rodar

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # testes do motor de simulação e da Oficina
```

## Como a simulação funciona

Cada segundo simulado tem duas passadas (`src/sim/engine.ts`):

1. **Fluxo:** o tráfego de cada tipo de requisição (estático, leitura, escrita) percorre o grafo em ordem topológica. Cada componente descarta o que passa da capacidade, responde o que é dele (o cache responde 85% das leituras, por exemplo) e divide o resto entre os destinos. Load balancers ignoram servidores fora do ar.
2. **Amostragem:** requisições individuais percorrem o mesmo caminho e acumulam latência em cada componente: o tempo base mais uma espera exponencial que cresce com a utilização, como numa fila M/M/1. O p99 sai dessas amostras.

Os componentes estão em `src/sim/model.ts` e as fases em `src/levels.ts`. Cada fase tem nos testes uma solução de referência que passa e uma ingênua que falha.
