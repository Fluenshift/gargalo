# gargalo — Design

> Revista técnica editorial sobre pergaminho quente.

O jogo inteiro roda sobre um fundo pergaminho (`#f6f3f1`), nunca branco puro. Títulos são serifados em peso 400 e falam pelo contraste do traço, não pelo negrito. Todo o resto — texto, botões, rótulos, números, peças no canvas — é monoespaçado, e isso dá a cara de manual técnico. Bordas são linhas finas de 1px em cinza-claro (`#cecac8`), controles são pílulas, cartões são retângulos de canto macio e nada tem sombra.

Os tokens vivem em `:root` no topo de `src/App.css`. Este arquivo explica **quando** usar cada um.

## Cor

| Token | Valor | Uso |
|---|---|---|
| `--paper` | `#f6f3f1` | Fundo do app, painéis, peças, cartões. É a superfície de quase tudo. |
| `--sunk` | `#ece8e5` | Hover e linha pressionada. |
| `--wash` | `#cfdaf5` | O único cartão elevado da tela: o briefing da fase. Não use em outro lugar. |
| `--ink` | `#242424` | Texto principal, superfícies escuras (peça Usuários, fase atual, toasts). |
| `--ink-soft` | `#4e4d4d` | Texto secundário. |
| `--line` | `#cecac8` | Toda borda e divisória. Sempre 1px. |
| `--accent` | `#2b59d1` | A **única** ação primária por tela (Rodar simulação) e o foco do teclado. |

### Cor de carga: a exceção

Fora o azul da ação primária, cor tem um só significado no jogo: **estado de carga**. Os pastéis preenchem as peças; as tintas escuras carregam texto e barras, porque os pastéis não passam no contraste AA sobre o pergaminho.

| Estado | Preenchimento | Texto e barra |
|---|---|---|
| ok | `--ok-wash` `#a7fccd` | `--ok` `#1f6e47` |
| perto do limite | `--warm-wash` `#ecda98` | `--warm` `#8a5a00` |
| sobrecarregada ou fora do ar | `--hot-wash` `#ff9473` | `--hot` `#b4380c` |

Não use essas cores para enfeite, categoria ou marca. Se uma cor aparece numa peça, ela diz quanto a peça está carregada.

A mancha desfocada atrás do título do mapa da carreira (coral → azul-céu → menta) é a única decoração colorida. Ela não carrega informação.

## Tipografia

| Papel | Fonte | Peso | Notas |
|---|---|---|---|
| Títulos e números grandes | Instrument Serif (`--serif`) | 400, sempre | Logo, título da fase na folha, cabeçalho do painel de conceitos, resultado da rodada, valores dos medidores, mapa da carreira. Letter-spacing −0.02em. |
| Todo o resto | IBM Plex Mono (`--mono`) | 400 e 500 | Corpo 14px, auxiliares 12–13px. 500 só para rótulos de destaque. |
| Rótulos de seção e botões | IBM Plex Mono | 500 | Caixa-alta, 11–13px, letter-spacing +0.02em. |

As fontes originais da referência (ABC Diatype Mono e Untitled Serif) são pagas; Plex Mono e Instrument Serif são os substitutos livres do Google Fonts.

Nunca deixe um título em negrito. Nunca troque o mono por uma sans no corpo: a dupla serifa + mono é a identidade.

## Forma

| Elemento | Raio |
|---|---|
| Botões, tags, pílulas, toasts, fase atual | `999px` |
| Cartões (briefing, folha de metas, resultado, empresas) | `24px` |
| Peças no canvas, menu de contexto | `20px` |

Nada abaixo de 16px em cartão. Nenhuma sombra: elevação é borda de 1px e troca de superfície (pergaminho → periwinkle).

## Espaço

Base de 8px. Cartões com 20–24px de respiro; o canvas é o centro e os painéis cedem espaço a ele. O painel da esquerda pode ser recolhido.

## Componentes

- **Botão primário:** pílula `--accent`, texto pergaminho, mono 13px caixa-alta, 14px × 28px. Um por tela.
- **Botão fantasma:** pílula transparente com borda `--ink` de 1px.
- **Peça no canvas:** pergaminho, borda `--line`, raio 20px, título em mono caixa-alta. A peça Usuários é invertida (`--ink`). Carga pinta o fundo com o pastel do estado.
- **Ligações:** traço `--ink-soft`, mais grosso quanto mais tráfego passa.
- **Briefing da fase:** cartão `--wash`, raio 24px.
- **Folha de metas:** cartão com borda `--line` e raio 24px, cabeçalhos das colunas em caixa-alta, valor medido na tinta do estado.
- **Toasts e avisos:** pílula `--ink` com texto pergaminho; avisos de várias linhas usam raio 20px.

## Não faça

- Branco puro como fundo.
- Títulos em 500 ou mais.
- O azul em qualquer coisa além da ação primária e do foco.
- Pastéis como cor de interface fora do estado de carga.
- Bordas mais grossas que 1px ou mais escuras que `--line` (exceto o botão fantasma).
- Sombras.
