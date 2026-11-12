// Another way through each level and what it trades, shown in the debrief after
// passing. Numbers come from running these designs over seeds 1–20; rerun them
// if a piece's spec or a level's goals change.

export const ALTERNATIVES: Record<string, string[]> = {
  'colocar-no-ar': [
    'Com uma CDN na frente ($195), o p99 cai de perto de 180 ms para perto de 130 ms: 30% do tráfego é estático e a CDN responde na borda. Já um cache entre servidor e banco ($200) quase não muda nada, porque o banco recebe só 140 req/s dos 1.000 que aguenta.',
  ],
  'primeiro-deploy': [
    'CDN, load balancer e 3 servidores também passam, por $315 em vez de $340: a CDN responde 95% dos estáticos, e os servidores ficam com menos trabalho. Sem a CDN, 3 servidores rodam a 75% e o p99 passa de 400 ms.',
  ],
  'banco-nao-aguenta': [
    'Aqui a CDN ajuda pouco: só 10% do tráfego é estático, e com ela 6 servidores ainda deixam o p99 perto de 350 ms. Oito servidores folgam bem a latência, mas custam $570 e estouram o orçamento.',
  ],
  'black-friday': [
    'Nove servidores em vez de oito passam com o p99 perto de 200 ms no pior pico, por $50 a mais: folga comprada com dinheiro. Sem a CDN, nem 12 servidores resolvem: todas as imagens chegam à origem, o p99 passa de 500 ms e o custo, de $700.',
  ],
  'imagens-pesadas': [
    'O cache não é luxo aqui: sem ele, nem 5 servidores ($415) resolvem, porque 750 leituras por segundo chegam ao banco, ele roda a 90% e o p99 fica perto de 550 ms. Com cache, 3 servidores também não bastam: cada um passa de 80% e a fila cresce.',
  ],
  'caiu-de-madrugada': [
    'Um terceiro servidor deixaria o p99 perto de 90 ms mesmo com um caído, mas custa $290 e passa do orçamento de $280. Um cache ($270) ganha só uns 10 ms: com um servidor fora, o outro aguenta sozinho a 50% e o banco já estava folgado.',
  ],
  'materia-na-tv': [
    'Oito servidores ($595) derrubam o p99 do pico para perto de 200 ms, a $5 do teto: folga comprada com quase todo o orçamento. Sem o cache, o banco recebe todas as leituras do pico, descarta parte delas e o p99 passa de 1 segundo.',
  ],
}
