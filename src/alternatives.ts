// Another way through each level and what it trades, shown in the debrief after
// passing. Numbers come from running these designs over seeds 1–20; rerun them
// if a piece's spec or a level's goals change.

export const ALTERNATIVES: Record<string, string[]> = {
  'colocar-no-ar': [
    'Com uma CDN na frente ($195), o p99 cai de perto de 180 ms para perto de 120 ms: 30% do tráfego é estático e a CDN responde na borda. Já um cache entre servidor e banco ($200) quase não muda nada, porque o banco recebe só 140 req/s dos 1.000 que aguenta.',
  ],
  'primeiro-deploy': [
    'CDN, load balancer e 3 servidores também passam, por $315 em vez de $340: a CDN responde 95% dos estáticos, e os servidores ficam com menos trabalho. Sem a CDN, 3 servidores rodam a 75% e o p99 passa de 400 ms.',
  ],
  'banco-nao-aguenta': [
    'Aqui a CDN ajuda pouco: só 10% do tráfego é estático, e com ela 6 servidores ainda deixam o p99 perto de 350 ms. Oito servidores folgam bem a latência, mas custam $570 e estouram o orçamento.',
  ],
  'black-friday': [
    'Tirar as tentativas extras do pagamento também passa, com o p99 perto de 650 ms: na queda de 3 s os pedidos falham de qualquer jeito. Já um circuit breaker em cada ligação fica abaixo da meta: ele segue falhando de propósito por 5 s depois que o pagamento volta. E com só 2 réplicas, quando uma cai a outra recebe todo o catálogo e o p99 passa de 850 ms.',
  ],
  'checkout-travando': [
    'Fila e 4 workers sem servidor novo ($585) não bastam: o banco folga, mas os 4 servidores herdados passam de 70% no pico e o p99 chega perto de 300 ms. Um servidor a mais e 3 workers ($595) passam: o backlog cresce no cupom e esvazia poucos segundos depois.',
  ],
  'catalogo-gigante': [
    'Uma réplica só não dá conta: recebe 840 leituras e as escritas do primário, atrasa e mais de 30% das leituras voltam velhas. Já com 2 réplicas e só 5 servidores, o p99 passa de 390 ms: os servidores rodam a quase 90%.',
  ],
  'bot-de-precos': [
    'Um API Gateway no lugar do load balancer também segura o bot pelo limite por cliente, por $435 em vez de $410: paga mais pela porta única de autenticação e regras. Servidores a mais não resolvem: com 8 o bot ainda leva o p99 a perto de 1 segundo e o custo a $595.',
  ],
  'pagamento-instavel': [
    'Também passa ligar o backoff nas 3 tentativas, deixar só 1 tentativa extra ou tirar todas: nas quedas os pedidos falham igual, e o que importa é não multiplicar a carga quando o pagamento volta. Com circuit breaker a loja fica em 95%: ele segue falhando de propósito por 5 s depois de cada queda.',
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
  'transferencia-duplicada': [
    'Tirar as tentativas extras também zera as duplicatas, mas aí cada falha à toa do parceiro (15%) vira erro para o cliente e a disponibilidade fica perto de 95%, abaixo dos 98% da meta. A chave de idempotência mantém os retries e não deixa nenhuma transferência sair duas vezes.',
  ],
  'livro-razao': [
    'Réplicas não resolvem: 60% do tráfego é escrita e só o primário escreve. O que divide a carga são as partições do banco, e com a chave quente de 35% a partição do lojista gigante continua sendo o gargalo se ficar sozinha.',
  ],
  'clientes-na-europa': [
    'Uma CDN na Europa tira os estáticos do oceano, mas as consultas de saldo ainda cruzam para São Paulo. Réplica em Frankfurt resolve a leitura, ao custo de ela atrasar meia ida e volta a mais e algumas leituras voltarem velhas.',
  ],
  'fechamento-do-mes': [
    'Com o primário só em São Paulo, a queda de 15 s para as transferências: a disponibilidade fica abaixo da meta mesmo com leitura nos Estados Unidos. Mover o primário para a Virgínia protege as escritas, mas os clientes brasileiros pagam 120 ms em cada uma.',
  ],
  'pedidos-em-loop': [
    'O JOIN também passa, no mesmo lugar: uma consulta traz o pedido e os produtos, com o p99 perto de 417 ms nos dois casos. Guardar cada produto no cache piora: o laço continua com 20 idas ao cache por página, a disponibilidade cai para perto de 68% e o p99 passa de 880 ms. Aumentar o pool de conexões não muda nada: o banco recebe as mesmas 21 consultas por página, e a disponibilidade segue perto de 82%.',
  ],
  'replica-parada': [
    'Injeção de dependência, cache na frente, 2 réplicas e 8 servidores passam por $730 de $750, com o p99 perto de 370 ms. Só o cache, sem réplica, deixa o primário sobrecarregado: o que o cache não acerta cai todo nele. A opção do if, com 3 réplicas, também passa, mas custa $780 e estoura o orçamento de $750: sem o cache na frente, o preço sobe. O singleton não libera nenhuma ligação: o cliente continua escondido dentro do serviço.',
  ],
  'sql-espalhado': [
    'O Repository com 3 servidores a mais e 2 partições passa por $685 de $750, com o p99 perto de 520 ms. Com só 1 servidor a mais, os servidores afogam e a disponibilidade cai para perto de 96%. O Adapter e o ORM não liberam nenhuma partição: elas ficam no desenho sem receber nada, e a disponibilidade despenca para perto de 36%. Uma fila na frente do primário segura as escritas, mas o banco só grava 1.000 por segundo, o atraso cresce sem parar, e com 5 ou 6 workers a conta passa de $775 e estoura o orçamento.',
  ],
  'servidor-velho': [
    'Strategy com menos conexões passa por $370 de $400, com o p99 perto de 390 ms: o velho recebe 200 req/s, na medida do que aguenta. Round robin, hash consistente e o sorteio dividem igual, então o velho recebe 250 req/s e perde requisições. Apagar o velho deixa 3 servidores a cerca de 83%, com o p99 perto de 740 ms, e falha. Qualquer servidor a mais estoura os $400. A opção do if também passa, mas é um caso especial escondido no balanceador, que a próxima necessidade (hash consistente) vai obrigar a repetir.',
  ],
  'catalogo-sem-paginacao': [
    'Comprimir com gzip piora: o banco lê as mesmas 5.000 linhas, o servidor monta o JSON inteiro e ainda gasta CPU para comprimir, e a disponibilidade fica perto de 77%. Guardar a lista inteira no cache alivia o banco, mas cada requisição ainda monta 5.000 produtos: o p99 segue acima de 2 segundos. Só a paginação reduz o que o banco lê e o que o servidor monta, e o p99 cai para perto de 135 ms.',
  ],
  'extrato-lento': [
    'LIMIT 50 sem índice quase não muda nada: o banco ainda acha e ordena todos os lançamentos da conta antes de cortar, e a disponibilidade fica perto de 46%. Selecionar só as colunas usadas também não: a resposta encolhe, mas a tabela continua sendo varrida. Com o índice, o p99 cai para perto de 175 ms, e cada escrita fica 10% mais cara no banco.',
  ],
  'upload-trava-servidor': [
    'Armazenamento de objetos atrás da CDN passa por $415 de $450, com o p99 perto de 70 ms: trechos e uploads vão direto para ele, e os servidores ficam só com a API. Quatro servidores a mais custam $595, estouram o orçamento e ainda deixam o p99 perto de 535 ms, porque cada upload segue preso no servidor.',
  ],
  'estreia-de-serie': [
    'CDN com o armazenamento de objetos como origem, 5 servidores e 3 índices assinando o tópico do armazenamento passam por $560, com o p99 perto de 210 ms e 4% das buscas sem o vídeo novo. Com 4 servidores também passa, por $510, e o p99 sobe para perto de 335 ms. Com 2 índices, cada um fica lotado e 16% das buscas perdem vídeos. Manter o cache e o banco da casa custa $150 a mais e estoura o orçamento.',
  ],
}
