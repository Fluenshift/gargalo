// Another way through each level and what it trades, shown in the debrief after
// passing. Numbers come from running these designs over seeds 1–20; rerun them
// if a piece's spec or a level's goals change.

export const ALTERNATIVES: Record<string, string[]> = {
  'primeiro-deploy': [
    'CDN, load balancer e 3 servidores também passam, por $315 em vez de $340: a CDN responde 95% dos estáticos, e os servidores ficam com menos trabalho. Sem a CDN, 3 servidores rodam a 75% e o p99 passa de 400 ms.',
  ],
  'banco-nao-aguenta': [
    'Aqui a CDN ajuda pouco: só 10% do tráfego é estático, e com ela 6 servidores ainda deixam o p99 perto de 350 ms. Oito servidores folgam bem a latência, mas custam $570 e estouram o orçamento.',
  ],
  'black-friday': [
    'Nove servidores em vez de oito passam com o p99 perto de 200 ms no pior pico, por $50 a mais: folga comprada com dinheiro. Sem a CDN, nem 12 servidores resolvem: todas as imagens chegam à origem, o p99 passa de 500 ms e o custo, de $700.',
  ],
}
