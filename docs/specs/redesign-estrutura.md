# Redesign: nova estrutura sem lateral

Status: aprovada em 2026-11-22. Protótipo: https://claude.ai/artifact/XuPZG2ZdBAQ2wPVyD43RPT (5 telas clicáveis).

## Por quê

A lateral junta navegação, título, briefing, fases, peças e tema numa coluna de 360 px: não cabe, rola demais e espreme o canvas. O perfil, aberto como janela por cima do jogo, quebra em alguns tamanhos. A estrutura muda; a identidade (DESIGN.md: papel, serifa nos títulos, mono no resto, pílula preta única, cor só para carga) continua.

## Decisões

| # | Decisão | Escolha |
|---|---|---|
| 1 | Navegação | Barra fixa no topo em todas as telas: marca, Carreira, Modo livre, Desafio do dia, Oficina, Perfil, XP e tema. No celular, botão "Menu" que abre os destinos em tela cheia. |
| 2 | Tela da fase | Canvas na tela toda. Sobre ele: eyebrow + título da fase em serifa grande e os botões Briefing (cartão recolhível), Fases (lista da empresa num popover) e Metas. |
| 3 | Peças e ação | Barra embaixo (dock) com as peças em pílulas (preço; trancadas tracejadas), Recomeçar e Rodar simulação (a pílula preta). |
| 4 | Metas e resultado | Painel à direita, aberto por "Metas" ou ao rodar: folha de metas, estrelas, gargalo, gráfico de p99, Próxima fase e Compartilhar. Ao rodar, o briefing recolhe. No celular, folha que sobe de baixo. |
| 5 | Carreira | Página própria: as empresas em seções, cada fase num cartão (feita, agora, aberta, trancada, chefão); "Continuar: <fase>" como ação principal. |
| 6 | Perfil | Página própria, não mais modal: patente e XP, blocos Carreira / Oficina / Desafio do dia, conquistas. |
| 7 | Modo livre e Desafio do dia | Mesma tela da fase. Modo livre troca "Fases" por "Tráfego" (o editor de tráfego vai no popover/painel). Desafio do dia não tem lista de fases. |
| 8 | Oficina | Barra do topo; lista de exercícios numa faixa horizontal abaixo dela; enunciado e editor à esquerda, testes e metas à direita (empilha no celular). |
| 9 | Endereços | Cada tela tem URL: `/` (fase atual), `/carreira`, `/perfil`, `/livre`, `/desafio`, `/oficina`. Voltar do navegador funciona. Links de compartilhamento (`?fase=`) continuam valendo. |
| 10 | Código colorido | Exceção registrada no DESIGN.md: dentro do editor da Oficina (e nos blocos de código), realce de sintaxe com paleta própria, AA nos dois temas. O resto do site segue com cor só para carga. |

## Fora de escopo

Mudar o motor, as fases, os textos dos níveis ou a paleta do site.

## Pronto quando (épico)

- Nenhuma tela usa a lateral; o canvas ocupa a largura toda.
- verify-ui a 1440, 1280 e 390 px de: fase (antes e depois de rodar), modo livre, desafio do dia, carreira, perfil, Oficina; sem rolagem horizontal nem sobreposição; claro e escuro.
- Teclado: a barra, o dock, os popovers e o painel funcionam por teclado; Esc fecha só a camada de cima.
- DESIGN.md atualizado com a nova estrutura.
