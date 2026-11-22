# gargalo — Design

> Mapa de metrô sobre papel frio. À noite, grafite.

O jogo roda sobre papel frio quase branco (`#f3f4f1`), nunca branco puro, com tinta azul-preta (`#121417`). Cada empresa da carreira tem uma **cor de linha**, como as linhas de um mapa de metrô; a carga das peças tem as suas três cores de estado; a única ação primária é uma pílula cobalto. Fora isso, neutros frios fazem o trabalho: sem gradiente e sem sombra. Títulos são serifados em peso 400 e falam pelo contraste do traço, não pelo negrito. Todo o resto — texto, botões, rótulos, números, peças no canvas — é monoespaçado, e isso dá a cara de manual técnico. Bordas são linhas finas de 1px (`--line`), controles são pílulas, cartões são retângulos de canto macio e nada tem sombra.

Os tokens vivem no topo de `src/App.css`: `:root` guarda tipo, espaço, forma e camadas; `:root, [data-theme='light']` guarda a paleta clara; `[data-theme='dark']` (e o mesmo bloco dentro de `@media (prefers-color-scheme: dark)`) guarda a escura. Nenhuma cor, tamanho de fonte, espaço, raio, sombra ou camada fica solta no CSS ou nos `.tsx`; ficam de fora só `0`, linhas de 1px, porcentagens e a geometria própria de um componente (largura do sparkline, setas do mapa, breakpoints). Este arquivo explica **quando** usar cada um. A página interna `/design` (ou `?design`) mostra todos os tokens e componentes nos dois temas.

## Cor

Cada cor tem um significado, e só um:

| Família | Significa | Tokens |
|---|---|---|
| Neutros frios | Superfície, texto, bordas | `--paper`, `--sunk`, `--wash`, `--ink`, `--ink-soft`, `--line` |
| Cobalto | A ação primária da tela e a seleção | `--accent` |
| Cor de linha | Qual empresa (identidade) | `--company-*`, lida por `--company` |
| Verde / âmbar / vermelho | Estado de carga | `--ok`, `--warm`, `--hot` e preenchimentos |
| Código | Partes do código na Oficina | `--code-*` |

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--paper` | `#f3f4f1` | `#0f1114` | Fundo do app, painéis, peças, cartões. É a superfície de quase tudo. |
| `--sunk` | `#e6e8e3` | `#191c21` | Hover e linha pressionada; linha atual do editor. |
| `--wash` | `#dde0da` | `#22262c` | O briefing quando não há empresa (desafio do dia, modo livre). Com empresa, o briefing usa `--company-wash`. |
| `--ink` | `#121417` | `#eef0f2` | Texto principal, superfícies invertidas (peça Usuários, fase atual, toasts, menu). |
| `--ink-soft` | `#4a5058` | `#a3a9b2` | Texto secundário, ligações entre peças, comentários e pontuação no código. |
| `--line` | `#c9ccc4` | `#2c3139` | Toda borda e divisória. Sempre 1px. |
| `--grid` | `#c9ccc4` | `#2c3139` | Pontos do canvas. |
| `--track` | `#c9ccc4` | `#2c3139` | Parte vazia da barra de carga. |
| `--accent` | `#2747d8` | `#7d95ff` | Cobalto: a **única** ação primária por tela (Rodar simulação, Enviar), seleção no canvas e passo atual fora da carreira. |
| `--accent-hover` | `#1d37b0` | `#9aadff` | Hover da ação primária. |
| `--on-accent` | `#ffffff` | `#0f1114` | Texto sobre a ação primária. |
| `--focus` | `#121417` | `#eef0f2` | Anel de foco do teclado. |
| `--on-ink` | `#f3f4f1` | `#0f1114` | Texto, bordas e foco sobre superfície invertida. |
| `--on-ink-soft` | `#c9ccc4` | `#5a606a` | Texto secundário sobre superfície invertida. |

Camadas translúcidas (também por tema): `--backdrop` atrás do modal, `--veil` na lixeira ociosa, `--hatch` nas listras de uma região fora do ar e `--glow-1..3` na mancha desfocada do mapa da carreira (cobalto, magenta e petróleo bem fracos; decoração, sem informação).

### Cor de linha: a empresa

Como num mapa de metrô, cada empresa tem uma linha. A cor diz **onde você está na carreira**, nunca estado.

| Empresa | Token | Claro | Escuro |
|---|---|---|---|
| Startup | `--company-startup` | `#2747d8` cobalto | `#7d95ff` |
| E-commerce | `--company-ecommerce` | `#b8265f` magenta | `#ff6fa8` |
| Fintech global | `--company-fintech` | `#0a6a73` petróleo | `#3cc4c9` |
| Streaming de vídeo | `--company-streaming` | `#6c3ad1` violeta | `#a98bff` |

**Como usar (o gancho):** ponha `data-company={company.id}` (o `id` de `COMPANIES` em `src/career.ts`) num contêiner. Dentro dele valem:

- `--company`: a cor de linha. Passa AA como texto sobre `--paper` e `--sunk`, então serve para eyebrow, nome da empresa, faixa e borda de destaque.
- `--company-wash`: `--company` a 12% sobre `--paper` (`color-mix`). Fundo de cartão; `--ink` e `--ink-soft` passam AA sobre ele.

Use sempre com fallback, para a tela continuar certa sem empresa: `color: var(--company, var(--ink-soft))`, `background: var(--company-wash, var(--wash))`. Hoje aparece em:

- **Fase** (`.app[data-company]`, vindo de `Play.company`): eyebrow `.phase__where` na cor de linha, com a faixa de linha (24 × 4px) antes dele; briefing com fundo `--company-wash`.
- **Mapa da carreira** (`.company[data-company]`): cabeçalho do cartão em `--company-wash`, nome da empresa em `--company`, passo atual com a borda de 4px em `--company`.

O cobalto da Startup é o mesmo do `--accent`: na Startup a ação primária e a linha coincidem, e tudo bem, porque a pílula é a única coisa cheia de cobalto na tela.

### Cor de carga

Estado de carga tem as suas cores, e elas não se misturam com as de empresa (verde, âmbar e vermelho-laranja; nenhuma empresa usa esses tons). Os preenchimentos pintam as peças; as tintas carregam texto e barras.

| Estado | Preenchimento claro | Tinta clara | Preenchimento escuro | Tinta escura |
|---|---|---|---|---|
| ok | `--ok-wash` `#a7fccd` | `--ok` `#1f6e47` | `#1c5a4a` | `#86e6b0` |
| perto do limite | `--warm-wash` `#ecda98` | `--warm` `#8a5a00` | `#5c4a17` | `#f3cc72` |
| sobrecarregada ou fora do ar | `--hot-wash` `#ff9473` | `--hot` `#b4380c` | `#7a2c22` | `#ffa285` |

No claro, os pastéis não passam no contraste AA sobre o papel, por isso texto e barra usam as tintas escuras. No escuro é o inverso: os preenchimentos ficam escuros para a tinta clara continuar legível dentro da peça, e as tintas ficam claras para ler sobre o grafite.

Se uma dessas cores aparece numa peça, ela diz quanto a peça está carregada. Não use para enfeite nem para empresa.

### Código colorido (Oficina)

Dentro do editor da Oficina e no bloco da solução de referência, o código tem realce de sintaxe com a mesma família de cores. É a única outra exceção.

| Parte | Classe e token | Claro | Escuro |
|---|---|---|---|
| Palavra-chave | `.tok-keyword` `--code-keyword` | `#6c3ad1` | `#a98bff` |
| Texto (string) | `.tok-string` `--code-string` | `#0a6a73` | `#3cc4c9` |
| Número, booleano, null | `.tok-number` `--code-number` | `#b8265f` | `#ff6fa8` |
| Tipo, classe | `.tok-type` `--code-type` | `#2747d8` | `#7d95ff` |
| Função (chamada ou definida) | `.tok-function` `--code-function` | `#8a5a00` | `#e5b85c` |
| Comentário | `.tok-comment` | `--ink-soft` itálico | `--ink-soft` itálico |
| Operador, pontuação | `.tok-punctuation` | `--ink-soft` | `--ink-soft` |

O resto (variáveis, propriedades) fica em `--ink`. As classes saem de um `tagHighlighter` em `src/Oficina.tsx`, usado pelo editor (`syntaxHighlighting`) e pelo bloco estático (`highlightCode`), então os dois pintam igual e trocam de tema sozinhos.

## Modo escuro: grafite

O escuro é grafite: papel `#0f1114`, hover `#191c21`, linhas `#2c3139`, tinta `#eef0f2`. As cores de linha, de código e o cobalto viram versões claras para ler sobre o grafite; a ação primária é uma pílula cobalto clara com texto grafite.

- Segue `prefers-color-scheme` por padrão.
- O seletor Claro / Escuro / Sistema (na barra do topo; no celular, dentro do Menu) grava `gargalo:theme` no `localStorage` e põe `data-theme` no `<html>`. "Sistema" apaga a chave.
- `public/theme.js` roda antes da primeira pintura e aplica o tema salvo, então não pisca. É um arquivo e não um script inline porque a CSP proíbe scripts inline.
- `color-scheme` acompanha o tema, então barras de rolagem, `select` e controles nativos também escurecem. A cor da barra do navegador (`theme-color`) é o `--paper` do tema.
- `data-theme` em qualquer outro elemento fixa um tema só naquele trecho (é o que a `/design` usa para mostrar os dois lado a lado).

## Contraste

`src/contrast.test.ts` lê os tokens dos dois temas direto do `App.css` e exige ≥ 4,5:1 para todo par texto/fundo que o jogo desenha (texto e secundário sobre papel, hover e briefing; texto sobre superfície invertida; texto da ação primária; tintas de carga sobre o papel; texto sobre os três preenchimentos; cada cor de linha sobre papel e hover; texto e secundário sobre o `--company-wash` de cada empresa, calculado com a mesma porcentagem do `color-mix`; cada cor de código sobre o fundo do editor e a linha atual) e ≥ 3:1 para foco, seleção, borda do botão fantasma, ligações e barras de carga sobre o trilho. Também confere que o bloco escuro do `@media` é igual ao de `[data-theme='dark']`. Mudou uma cor? Rode `npm test`.

As linhas de 1px (`--line`) são divisórias, não limites de controle, e ficam de propósito abaixo de 3:1.

## Tipografia

| Papel | Fonte | Peso | Notas |
|---|---|---|---|
| Títulos e números grandes | Instrument Serif (`--serif`) | 400, sempre | Logo, título da fase no painel e na folha, cabeçalho do painel de conceitos, resultado da rodada, valores dos medidores, mapa da carreira. `--tracking-tight`. |
| Todo o resto | IBM Plex Mono (`--mono`) | 400 e 500 | Corpo `--text-base`, auxiliares `--text-xs`/`--text-sm`. 500 só para rótulos de destaque. |
| Rótulos de seção e botões | IBM Plex Mono | 500 | Caixa-alta, `--text-label` a `--text-sm`, `--tracking-caps`. |

| Token | Valor | Uso |
|---|---|---|
| `--text-label` | 11px | Rótulos em caixa-alta, cabeçalho de tabela, selo de chefão |
| `--text-xs` | 12px | Peças no canvas, rótulos de seção, código |
| `--text-sm` | 13px | Texto secundário, botões |
| `--text-base` | 14px | Corpo |
| `--text-glyph` / `--text-glyph-lg` | 17px / 18px | O × dos botões redondos |
| `--title-xs` | 22px | Chefão na lista, estrelas, título do cartão de fase na Carreira |
| `--title-sm` | 24px | Título da folha, resultado, cartão do modo livre |
| `--title-meter-compact` | 26px | Medidor em telas até 1400px |
| `--title-md` | 28px | Logo, painel de conceitos, código, modal, blocos do perfil |
| `--title-lg` | 32px | Medidores, empresas, seções, destinos do Menu no celular |
| `--title-xl` | 40px | Título da fase no painel |
| `--title-2xl` | 44px | Título do modo livre e das páginas no celular, números do perfil |
| `--title-4xl` | 56px | Título das páginas (Carreira, Perfil, Oficina, Modo livre) |

Tracking: `--tracking-tight` −0.02em, `--tracking-caps` 0.02em, `--tracking-wide` 0.04em, `--tracking-stars` 0.08em, `--tracking-none` 0. Entrelinha: `--leading` 1.35.

As fontes originais da referência (ABC Diatype Mono e Untitled Serif) são pagas; Plex Mono e Instrument Serif são os substitutos livres do Google Fonts.

Nunca deixe um título em negrito. Nunca troque o mono por uma sans no corpo: a dupla serifa + mono é a identidade.

## Forma

| Token | Valor | Uso |
|---|---|---|
| `--radius-pill` | 999px | Botões, tags, pílulas, toasts, fase atual |
| `--radius-card` | 24px | Cartões (briefing, folha de metas, resultado, empresas, modal) |
| `--radius-piece` | 20px | Peças no canvas, menu de contexto, avisos de várias linhas |
| `--radius-field` / `--radius-field-sm` | 16px / 12px | Blocos de código e opções de correção |
| `--radius-round` | 50% | Botões redondos de ícone |
| `--shadow` | `none` | Nada tem sombra |

Nada abaixo de 12px em cartão. Nenhuma sombra: elevação é borda de 1px e troca de superfície (papel → hover).

Tamanhos de controle: `--control-xs` 26px (× de peça e de definição), `--control-xs-touch` 30px (o mesmo × no celular), `--control-sm` 32px, `--control-md` 36px. Larguras de layout: `--panel-width` 360px, `--tabpanel-min-height` 240px (altura mínima da aba aberta do painel antes de o painel todo rolar), `--inspector-width` 340px, `--piece-width` 184px, `--page-width` 1200px.

## Espaço

Base de 4px: `--space-2` a `--space-56`, nomeados pelo valor em px (2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56). Os passos ímpares (3, 5, 7, 9) existem para as listas densas e não devem crescer. Cartões com 20–24px de respiro; o canvas é o centro e os painéis cedem espaço a ele. O painel da esquerda pode ser recolhido.

### A barra do topo e os endereços

Toda tela começa pela barra do topo (`TopBar`, `.topbar`): logo (leva a `/`, a fase atual), os destinos Carreira, Modo livre, Desafio do dia #N, Oficina e Perfil em mono caixa-alta `--text-xs`, a patente e o XP em `--ink-soft` e o seletor de tema. O destino aberto tem `aria-current="page"` e um traço `--ink` embaixo; numa fase, Carreira fica marcada. A barra é `sticky`, papel com linha `--line` embaixo, em `--z-menu`. Até 640px ela mostra só o logo e o botão **Menu**, que abre os destinos em tela cheia num `<dialog>` nativo (foco preso, Esc fecha e devolve o foco ao Menu), com os destinos em serifa `--title-lg`, o XP e o tema.

Cada tela tem endereço, pela History API (`src/route.ts`, sem dependência de roteador): `/` fase atual, `/carreira`, `/perfil`, `/livre`, `/desafio`, `/oficina` e `/design`. Voltar e avançar do navegador trocam de tela; `?fase=&d=` (link compartilhado) continua abrindo o desenho em `/`, e `?oficina`/`?design` continuam valendo. Na Vercel, `vercel.json` reescreve esses caminhos para o `index.html`.

### Carreira e Perfil

Páginas comuns abaixo da barra (`.page`, largura `--page-width`): rótulo em caixa-alta `--ink-soft`, título serifado `--title-4xl` (`--title-2xl` no celular), seções separadas por linha `--line`.

- **Carreira** (`/carreira`): a ação principal é "Continuar: <fase>" (a pílula preta). Cada empresa é uma seção (rótulo, nome em `--title-lg`, estado, orçamento) com um cartão por fase (`.phase-card`, `--radius-piece`): feita (✓ e estrelas), agora (superfície invertida `--ink`), aberta ("Jogar →"), trancada (`--ink-soft`, borda tracejada, cadeado e o porquê) e chefão (borda `--ink`). Embaixo, as peças que a empresa libera.
- **Perfil** (`/perfil`): patente em `--title-4xl`, XP com a barra de progresso e o que falta; três blocos (Carreira, Oficina, Desafio do dia) com o número em `--title-2xl`; conquistas em duas colunas (uma no celular).

### O painel da fase

De cima para baixo: cabeçalho mínimo (onde a fase está em caixa-alta `--ink-soft` (`.phase__where`), o botão de recolher e, no desafio do dia e no modo livre, só o caminho de volta: Voltar à carreira, Meus sistemas; o resto foi para a barra do topo), o título da fase em serifa `--title-xl` (`.phase__title`), o briefing e as abas. As abas são **Fases** e **Peças** (no modo livre, **Tráfego** e **Peças**; no desafio do dia só há peças, sem abas). Peças abre por padrão, e a aba escolhida continua ao trocar de fase. O briefing fica sempre à vista: quem rola é só a aba aberta (`.panel__tabpanel`), e o painel inteiro só rola quando a tela é baixa demais para ela ter `--tabpanel-min-height`. No celular o painel fica acima do canvas e a aba aberta tem no máximo meia tela de altura, para o canvas ficar a uma rolada.

### A Oficina (`/oficina`)

Página própria, carregada sob demanda com o editor. A barra do topo; abaixo, título serifado `--title-4xl` e linha de apoio. Abaixo, uma faixa horizontal de exercícios (`.oficina__strip`): pílulas agrupadas por empresa, com o nome da empresa em caixa-alta antes de cada grupo na cor da linha dela (`data-company`; o aquecimento não tem e fica `--ink-soft`). O exercício aberto tem `aria-pressed` e borda `--ink`, o que passou mostra as estrelas; setas esquerda e direita andam pela faixa, que rola na horizontal em tela pequena. Embaixo, duas colunas com `flex-wrap`: à esquerda empresa, rota em serifa `--title-lg`, enunciado, editor e botões (`flex: 999 1 560px`); à direita resultados, tabela de metas, dicas e solução de referência (`flex: 1 1 380px`). Até cerca de 900px as colunas empilham.

- **Editor:** CodeMirror 6 em modo TypeScript, borda `--line`, `--radius-field`, fundo `--paper`, mono `--text-xs`, altura mínima de 240px e no máximo 60% da tela. Realce colorido com os tokens `--code-*` (ver Código colorido). Linha atual em `--sunk`. Tab indenta; Esc e depois Tab sai do editor (a nota abaixo dele diz isso).
- **Ações:** Rodar testes (fantasma, só os testes visíveis), **Enviar** (a pílula cobalto, visíveis e escondidos) e Voltar ao início (fantasma pequeno, pede confirmação e volta ao código inicial). Rodando, o botão fica `aria-busy` e uma linha `role="status"` anuncia o andamento e o resultado.
- **Resultados:** um cartão `--radius-field` por teste, "Passou" em `--ok` ou "Falhou" em `--hot` (é estado, como no selo), a mensagem, um link "Linha N" que leva o cursor à linha do erro, e Esperado/Recebido em blocos `.code`. Teste escondido mostra só a mensagem.
- **Dicas e referência:** cada envio que falha libera uma dica (lista numerada). A solução de referência e a explicação aparecem só depois de um envio que passa.
- O código fica salvo por exercício em `gargalo:oficina:code:<id>`.

## Camadas

| Token | Valor | Uso |
|---|---|---|
| `--z-under` | −1 | Mancha do mapa da carreira |
| `--z-float` | 5 | Lixeira, botão de abrir o painel |
| `--z-toast` | 6 | Toasts |
| `--z-menu` | 20 | Menu de contexto, barra do topo |
| `--z-sheet` | 30 | Painel de conceitos como folha inferior no celular |

## Estados

- **Foco:** anel `--focus-width` (2px) `--focus`, afastado 2px. Sobre superfície invertida, `--on-ink`. Em controles segmentados o anel fica para dentro, porque o grupo corta o que sai da borda.
- **Desabilitado:** `--disabled-opacity` (0.5) e cursor proibido. Fases bloqueadas e passos futuros não esmaecem: ficam em `--ink-soft` com cadeado.
- **Carregando:** `aria-busy="true"` no botão. Ele não esmaece, troca o cursor e mostra um anel girando antes do texto (pontilhado e parado com `prefers-reduced-motion`).
- **Hover:** `--sunk` em linhas e botões fantasma, `--accent-hover` na ação primária, inversão (`--ink`) em menus e botões redondos.

## Componentes

- **Botão** (`.btn`): pílula, mono `--text-sm` caixa-alta, 14px × 28px.
  - `.btn--primary`: `--accent` com texto `--on-accent`. Um por tela. `.run` só fixa a largura mínima do botão de rodar.
  - `.btn--ghost`: transparente com borda `--ink` de 1px.
  - `.btn--small`: 6px × 14px, `--text-xs`.
- **Abas** (`.segmented`): grupo de botões com `aria-pressed`; o pressionado é invertido. `.segmented--small` no seletor de tema. As abas do painel (`.panel__tabs`) usam o mesmo visual com `role="tab"` e `aria-selected`; setas, Home e End trocam de aba.
- **Painel** (`.inspector`): folha lateral à direita do desenho, com cabeçalho serifado e régua de ganhos e custos (`.ledger`). No celular vira folha inferior.
- **Peça no canvas** (`.node`): papel, borda `--line`, `--radius-piece`, título em mono caixa-alta. A peça Usuários é invertida. Carga pinta o fundo com o preenchimento do estado (`.heat--warm`, `.heat--hot`, `.heat--down` com listras).
- **Ligações:** traço `--ink-soft`, mais grosso quanto mais tráfego passa; selecionada em `--accent`; disjuntor aberto pontilhado em `--hot`, meio-aberto tracejado em `--warm`.
- **Briefing da fase** (`.brief`): cartão `--company-wash` (ou `--wash` sem empresa), `--radius-card`.
- **Selo** (`.sheet`): folha de metas com borda `--line` e `--radius-card`, cabeçalhos em caixa-alta, valor medido na tinta do estado.
- **Medidor** (`.meter`): nome em caixa-alta, valor serifado, sparkline em `--ink` com a meta tracejada em `--line`; `.is-bad` pinta valor e linha de `--hot`.
- **Toast** (`.toast`): pílula `--ink` com texto `--on-ink`; `.toast--notice` para avisos de várias linhas usa `--radius-piece`.
- **Modal** (`.profile`): `<dialog>` nativo (foco preso, Esc, volta o foco), cartão `--radius-card` sobre `--backdrop`. O Perfil virou página; o modal fica como padrão para o que precisar dele.
- **Barra do topo** (`.topbar`) e **Menu** (`.topbar__sheet`): ver "A barra do topo e os endereços".
- **Cartão de fase** (`.phase-card`): ver "Carreira e Perfil".
- **Menu** (`.menu`): cartão `--radius-piece`; itens viram pílula invertida no hover e no foco.
- **Código** (`.code`): bloco mono `--text-xs` com borda `--line` e `--radius-field`.

## Não faça

- Branco puro como fundo.
- Títulos em 500 ou mais.
- Cor saturada fora dos seus significados (ação primária, empresa, carga, código). Cor de empresa nunca indica estado, e cor de carga nunca indica empresa.
- Mais de uma pílula cobalto cheia por tela.
- Pastéis como cor de interface fora do estado de carga.
- Bordas mais grossas que 1px ou mais escuras que `--line` (exceto o botão fantasma).
- Sombras.
- Valor solto no CSS: se faltar um token, crie no topo do `App.css`, nos dois temas se for cor, e documente aqui.
