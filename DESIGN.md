# gargalo — Design

> Etiqueta de galeria sobre papel massa. À noite, a sala preta.

O jogo inteiro roda sobre papel osso (`#e7e5e4`), nunca branco puro. Neutros quentes e tinta preta fazem todo o trabalho: sem gradiente, sem sombra e quase sem cor. Títulos são serifados em peso 400 e falam pelo contraste do traço, não pelo negrito. Todo o resto — texto, botões, rótulos, números, peças no canvas — é monoespaçado, e isso dá a cara de manual técnico. Bordas são linhas finas de 1px em massa (`#c4c3b6`), controles são pílulas, cartões são retângulos de canto macio e nada tem sombra.

Os tokens vivem no topo de `src/App.css`: `:root` guarda tipo, espaço, forma e camadas; `:root, [data-theme='light']` guarda a paleta clara; `[data-theme='dark']` (e o mesmo bloco dentro de `@media (prefers-color-scheme: dark)`) guarda a escura. Nenhuma cor, tamanho de fonte, espaço, raio, sombra ou camada fica solta no CSS ou nos `.tsx`; ficam de fora só `0`, linhas de 1px, porcentagens e a geometria própria de um componente (largura do sparkline, setas do mapa, breakpoints). Este arquivo explica **quando** usar cada um. A página interna `/design` (ou `?design`) mostra todos os tokens e componentes nos dois temas.

## Cor

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--paper` | `#e7e5e4` | `#0f0f0e` | Fundo do app, painéis, peças, cartões. É a superfície de quase tudo. |
| `--sunk` | `#dfdcd5` | `#1c1b1a` | Hover e linha pressionada. |
| `--wash` | `#c4c3b6` | `#2a2927` | O único cartão elevado da tela: o briefing da fase. Não use em outro lugar. |
| `--ink` | `#0f0f0e` | `#ebebeb` | Texto principal, superfícies invertidas (peça Usuários, fase atual, toasts, menu). |
| `--ink-soft` | `#4d4c49` | `#aeaca5` | Texto secundário, ligações entre peças. |
| `--line` | `#c4c3b6` | `#3d3c39` | Toda borda e divisória. Sempre 1px. |
| `--grid` | `#c4c3b6` | `#34332f` | Pontos do canvas. |
| `--track` | `#c4c3b6` | `#2a2927` | Parte vazia da barra de carga. |
| `--accent` | `#0f0f0e` | `#e7e5e4` | A **única** ação primária por tela (Rodar simulação), seleção no canvas e passo atual. |
| `--accent-hover` | `#3a3936` | `#ffffff` | Hover da ação primária. |
| `--focus` | `#0f0f0e` | `#e7e5e4` | Anel de foco do teclado. |
| `--on-accent` | `#e7e5e4` | `#0f0f0e` | Texto sobre a ação primária. |
| `--on-ink` | `#e7e5e4` | `#0f0f0e` | Texto, bordas e foco sobre superfície invertida. |
| `--on-ink-soft` | `#c4c3b6` | `#595855` | Texto secundário sobre superfície invertida. |

Camadas translúcidas (também por tema): `--backdrop` atrás do modal, `--veil` na lixeira ociosa, `--hatch` nas listras de uma região fora do ar e `--glow-1..3` na mancha desfocada do mapa da carreira.

### Cor de carga: a exceção

Cor tem um só significado no jogo: **estado de carga**. Os preenchimentos pintam as peças; as tintas carregam texto e barras.

| Estado | Preenchimento claro | Tinta clara | Preenchimento escuro | Tinta escura |
|---|---|---|---|---|
| ok | `--ok-wash` `#a7fccd` | `--ok` `#1f6e47` | `#1c5a4a` | `#86e6b0` |
| perto do limite | `--warm-wash` `#ecda98` | `--warm` `#8a5a00` | `#5c4a17` | `#f3cc72` |
| sobrecarregada ou fora do ar | `--hot-wash` `#ff9473` | `--hot` `#b4380c` | `#7a2c22` | `#ffa285` |

No claro, os pastéis não passam no contraste AA sobre o papel osso, por isso texto e barra usam as tintas escuras. No escuro é o inverso: os preenchimentos ficam escuros para a tinta clara continuar legível dentro da peça, e as tintas ficam claras para ler sobre o preto.

Não use essas cores para enfeite, categoria ou marca. Se uma cor aparece numa peça, ela diz quanto a peça está carregada.

A mancha desfocada atrás do título do mapa da carreira é neutra (massa → velino → grafite). Ela não carrega informação; no escuro fica mais fraca.

## Modo escuro: a sala preta

O escuro é a sala preta da galeria: papel quase preto, tinta giz, linhas cinza-quente. A regra de cor continua igual (cor só para carga); a ação primária vira uma pílula osso com texto preto.

- Segue `prefers-color-scheme` por padrão.
- O seletor Claro / Escuro / Sistema (no pé do painel da fase e no topo do mapa e do modo livre) grava `gargalo:theme` no `localStorage` e põe `data-theme` no `<html>`. "Sistema" apaga a chave.
- `public/theme.js` roda antes da primeira pintura e aplica o tema salvo, então não pisca. É um arquivo e não um script inline porque a CSP proíbe scripts inline.
- `color-scheme` acompanha o tema, então barras de rolagem, `select` e controles nativos também escurecem. A cor da barra do navegador (`theme-color`) é o `--paper` do tema.
- `data-theme` em qualquer outro elemento fixa um tema só naquele trecho (é o que a `/design` usa para mostrar os dois lado a lado).

## Contraste

`src/contrast.test.ts` lê os tokens dos dois temas direto do `App.css` e exige ≥ 4,5:1 para todo par texto/fundo que o jogo desenha (texto e secundário sobre papel, hover e briefing; texto sobre superfície invertida; texto da ação primária; tintas de carga sobre o papel; texto sobre os três preenchimentos) e ≥ 3:1 para foco, seleção, borda do botão fantasma, ligações e barras de carga sobre o trilho. Também confere que o bloco escuro do `@media` é igual ao de `[data-theme='dark']`. Mudou uma cor? Rode `npm test`.

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
| `--title-xs` | 22px | Chefão na lista, estrelas |
| `--title-sm` | 24px | Título da folha, resultado, cartão do modo livre |
| `--title-meter-compact` | 26px | Medidor em telas até 1400px |
| `--title-md` | 28px | Logo, painel de conceitos, código, modal |
| `--title-lg` | 32px | Medidores, empresas, seções |
| `--title-xl` | 40px | Título da fase no painel, patente no perfil |
| `--title-2xl` | 44px | Título do modo livre no celular |
| `--title-4xl` | 56px | Título do mapa da carreira |

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

Nada abaixo de 12px em cartão. Nenhuma sombra: elevação é borda de 1px e troca de superfície (osso → massa).

Tamanhos de controle: `--control-xs` 26px (× de peça e de definição), `--control-xs-touch` 30px (o mesmo × no celular), `--control-sm` 32px, `--control-md` 36px. Larguras de layout: `--panel-width` 360px, `--tabpanel-min-height` 240px (altura mínima da aba aberta do painel antes de o painel todo rolar), `--inspector-width` 340px, `--piece-width` 184px, `--page-width` 1200px.

## Espaço

Base de 4px: `--space-2` a `--space-56`, nomeados pelo valor em px (2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56). Os passos ímpares (3, 5, 7, 9) existem para as listas densas e não devem crescer. Cartões com 20–24px de respiro; o canvas é o centro e os painéis cedem espaço a ele. O painel da esquerda pode ser recolhido.

### O painel da fase

De cima para baixo: cabeçalho mínimo (logo pequeno, botão de recolher e os links para as outras telas: Desafio do dia, Modo livre, Oficina, Mapa da carreira, Perfil), onde a fase está em caixa-alta `--ink-soft` (`.phase__where`), o título da fase em serifa `--title-xl` (`.phase__title`), o briefing e as abas. As abas são **Fases** e **Peças** (no modo livre, **Tráfego** e **Peças**; no desafio do dia só há peças, sem abas). Peças abre por padrão, e a aba escolhida continua ao trocar de fase. O briefing fica sempre à vista: quem rola é só a aba aberta (`.panel__tabpanel`), e o painel inteiro só rola quando a tela é baixa demais para ela ter `--tabpanel-min-height`. No celular o painel fica acima do canvas e a aba aberta tem no máximo meia tela de altura, para o canvas ficar a uma rolada.

### A Oficina (`/oficina`)

Página própria, carregada sob demanda com o editor. Mesmo cabeçalho do modo livre (logo, título serifado `--title-4xl`, linha de apoio, Voltar ao jogo, seletor de tema). Abaixo, duas colunas: a lista de exercícios agrupada por empresa (rótulo em caixa-alta `--ink-soft`; o exercício aberto tem borda `--ink`, o que passou ganha "· passou" em `--ok`) e a área de trabalho: empresa, rota em serifa `--title-lg`, enunciado, editor, botões e resultados. No celular (até 860px) a lista fica acima.

- **Editor:** CodeMirror 6 em modo TypeScript, borda `--line`, `--radius-field`, fundo `--paper`, mono `--text-xs`, altura mínima de 240px e no máximo 60% da tela. O realce não usa cor: palavras-chave em 500, textos, números e comentários em `--ink-soft` (comentários e tipos em itálico). Linha atual em `--sunk`. Tab indenta; Esc e depois Tab sai do editor (a nota abaixo dele diz isso).
- **Ações:** Rodar testes (fantasma, só os testes visíveis), **Enviar** (a pílula preta, visíveis e escondidos) e Voltar ao início (fantasma pequeno, pede confirmação e volta ao código inicial). Rodando, o botão fica `aria-busy` e uma linha `role="status"` anuncia o andamento e o resultado.
- **Resultados:** um cartão `--radius-field` por teste, "Passou" em `--ok` ou "Falhou" em `--hot` (é estado, como no selo), a mensagem, um link "Linha N" que leva o cursor à linha do erro, e Esperado/Recebido em blocos `.code`. Teste escondido mostra só a mensagem.
- **Dicas e referência:** cada envio que falha libera uma dica (lista numerada). A solução de referência e a explicação aparecem só depois de um envio que passa.
- O código fica salvo por exercício em `gargalo:oficina:code:<id>`.

## Camadas

| Token | Valor | Uso |
|---|---|---|
| `--z-under` | −1 | Mancha do mapa da carreira |
| `--z-float` | 5 | Lixeira, botão de abrir o painel |
| `--z-toast` | 6 | Toasts |
| `--z-menu` | 20 | Menu de contexto |
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
- **Briefing da fase** (`.brief`): cartão `--wash`, `--radius-card`.
- **Selo** (`.sheet`): folha de metas com borda `--line` e `--radius-card`, cabeçalhos em caixa-alta, valor medido na tinta do estado.
- **Medidor** (`.meter`): nome em caixa-alta, valor serifado, sparkline em `--ink` com a meta tracejada em `--line`; `.is-bad` pinta valor e linha de `--hot`.
- **Toast** (`.toast`): pílula `--ink` com texto `--on-ink`; `.toast--notice` para avisos de várias linhas usa `--radius-piece`.
- **Modal** (`.profile`): `<dialog>` nativo (foco preso, Esc, volta o foco), cartão `--radius-card` sobre `--backdrop`.
- **Menu** (`.menu`): cartão `--radius-piece`; itens viram pílula invertida no hover e no foco.
- **Código** (`.code`): bloco mono `--text-xs` com borda `--line` e `--radius-field`.

## Não faça

- Branco puro como fundo.
- Títulos em 500 ou mais.
- Qualquer cor saturada fora das cores de carga: a ênfase é a tinta preta.
- Pastéis como cor de interface fora do estado de carga.
- Bordas mais grossas que 1px ou mais escuras que `--line` (exceto o botão fantasma).
- Sombras.
- Valor solto no CSS: se faltar um token, crie no topo do `App.css`, nos dois temas se for cor, e documente aqui.
