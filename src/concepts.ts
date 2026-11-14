// What each piece is and costs, and the glossary of terms the game uses.
// Plain data so the texts can be reviewed without reading components.
// Numbers must match SPECS in sim/model.ts.

import type { Kind } from './sim/model'

export interface Concept {
  /** One or two sentences. */
  whatIs: string
  whenToUse: string
  gains: string[]
  costs: string[]
  mistakes: string[]
}

export const CONCEPTS: Record<Kind, Concept> = {
  client: {
    whatIs:
      'As pessoas usando o sistema. Geram as requisições de cada fase: estáticos, leituras e escritas, em ondas que podem subir de repente.',
    whenToUse:
      'Está sempre no desenho. Você só escolhe para onde o DNS aponta: uma única peça recebe todo o tráfego.',
    gains: ['Nada a ganhar aqui: é a demanda que o resto precisa aguentar.'],
    costs: ['Não custa nada, mas não perdoa: requisição perdida conta contra a disponibilidade.'],
    mistakes: [
      'Apontar direto para um servidor: ele vira ponto único de falha.',
      'Dimensionar pelo tráfego médio e esquecer o pico.',
    ],
  },
  cdn: {
    whatIs:
      'Rede de servidores perto das pessoas que guarda cópias de arquivos estáticos. Aqui responde 95% dos estáticos na borda, com até 100.000 req/s.',
    whenToUse: 'Quando boa parte do tráfego é imagem, script ou CSS. Fica na frente de tudo.',
    gains: [
      'Tira quase todo estático da origem por $25/mês.',
      'Latência baixa: a resposta vem da borda.',
    ],
    costs: [
      'Não ajuda leituras e escritas, que seguem para a origem.',
      'Arquivo trocado demora a aparecer até a cópia expirar.',
    ],
    mistakes: [
      'Esperar que a CDN salve um banco sobrecarregado.',
      'Esquecer que os 5% que passam ainda chegam aos servidores.',
    ],
  },
  limiter: {
    whatIs:
      'Recusa com 429, na hora e quase de graça, o que passa do limite: 10 req/s por cliente e, no total, 80% do que as peças atrás aguentam.',
    whenToUse:
      'Na frente de quem pode ser afogado: quando um bot martela o site ou quando um pico passaria da capacidade dos servidores.',
    gains: [
      'Um pico vira 429 rápido em vez de servidor lotado: quem passa é atendido sem fila.',
      'Segura um bot sozinho por $15/mês.',
    ],
    costs: [
      'Cada 429 de usuário de verdade é alguém sem resposta e conta contra a disponibilidade.',
      'Não cria capacidade: só escolhe quem fica de fora.',
    ],
    mistakes: [
      'Usar o limite no lugar de servidores: no pico, metade dos usuários leva 429.',
      'Pôr o limite atrás dos servidores: aí eles já fizeram o trabalho.',
    ],
  },
  gateway: {
    whatIs:
      'A porta única da API: autentica, limita por cliente e divide as chamadas entre servidores saudáveis. Aguenta 10.000 req/s e soma 5 ms.',
    whenToUse:
      'Quando há clientes que abusam ou vários serviços atrás de um endereço só. Faz o papel do load balancer e do limite por cliente juntos.',
    gains: [
      'Um lugar só para autenticação, limites e regras de roteamento.',
      'Bots e clientes abusivos param na porta, antes de gastar servidor.',
    ],
    costs: [
      '$60/mês, três vezes o load balancer.',
      'Mais um salto em toda chamada, e ele mesmo pode virar o gargalo.',
    ],
    mistakes: [
      'Esperar que ele corte picos de usuários de verdade: o limite é por cliente, não no total.',
      'Pôr regra de negócio no gateway: ele fica lento e difícil de mudar.',
    ],
  },
  payment: {
    whatIs:
      'API de outra empresa que cobra o cartão em cada pedido. Aguenta 600 req/s, leva 120 ms e cai às vezes. Com mais de 1,5× a capacidade, cai também.',
    whenToUse: 'Vem com a fase: todo pedido passa por ela. Você não escala nem conserta; só decide como chamá-la.',
    gains: ['Ninguém da loja precisa guardar dado de cartão.', 'O custo é por transação, fora do orçamento mensal.'],
    costs: [
      'Quando ela cai, nenhum pedido fecha.',
      'É lenta: puxa o p99 de todo pedido para cima.',
    ],
    mistakes: [
      'Tentar de novo sem backoff quando ela volta: a enxurrada derruba de novo.',
      'Achar que retry resolve uma queda inteira: tentar de novo um serviço fora só gasta carga.',
    ],
  },
  lb: {
    whatIs:
      'Recebe o tráfego e divide igualmente entre até 16 servidores. Um health check tira da roda o servidor que cai.',
    whenToUse: 'Assim que um servidor não basta, ou quando a queda de um não pode derrubar o sistema.',
    gains: [
      'Permite escalar horizontalmente.',
      'Sobrevive à queda de um servidor sem perder tudo.',
    ],
    costs: [
      'Mais uma peça e mais um salto: $20/mês e 1 ms.',
      'Com um só balanceador, ele vira o novo ponto único de falha.',
    ],
    mistakes: [
      'Pôr só um servidor atrás: não há para onde desviar.',
      'Contar com folga exata: se um cai, os outros herdam a carga dele.',
    ],
  },
  server: {
    whatIs:
      'Roda a aplicação. Aguenta 400 req/s, responde os estáticos e manda leituras e escritas para o cache ou o banco.',
    whenToUse: 'Sempre. A questão é quantos: some o tráfego que chega e deixe folga para o pico e para uma queda.',
    gains: [
      'Escala bem: mais servidores atrás de um balanceador somam capacidade.',
      'É a peça mais barata de multiplicar.',
    ],
    costs: [
      '$50/mês cada, e a conta cresce rápido.',
      'Perto do limite a fila cresce e o p99 dispara antes de haver erro.',
    ],
    mistakes: [
      'Rodar com utilização perto de 100% e chamar isso de eficiência.',
      'Um servidor só: quando ele cai, nada responde.',
    ],
  },
  cache: {
    whatIs:
      'Memória rápida na frente do banco. Aqui 85% das leituras acertam e respondem em 1 ms; escritas e misses seguem para o banco.',
    whenToUse: 'Quando o banco sofre com leituras repetidas dos mesmos dados.',
    gains: [
      'Latência menor nas leituras.',
      'Alivia o banco: só 15% das leituras chegam nele.',
    ],
    costs: [
      'Dado desatualizado até a cópia ser invalidada.',
      'Invalidação é difícil de acertar.',
      'Cache frio depois de reiniciar: tudo vira miss. No jogo ele já começa quente.',
    ],
    mistakes: [
      'Esperar que o cache ajude escritas: elas sempre vão ao banco.',
      'Esquecer que um pico de leituras ainda manda 15% ao banco.',
    ],
  },
  db: {
    whatIs:
      'A fonte da verdade, onde leituras e escritas terminam. Aguenta 1.000 req/s e custa $120/mês.',
    whenToUse: 'Sempre que há dados. Proteja-o com cache e mande para ele só o que precisa chegar.',
    gains: ['Guarda o dado certo e durável.'],
    costs: [
      'A peça mais cara, e não escala horizontalmente como servidores.',
      'Saturado, a latência sobe e as requisições caem para todo mundo.',
    ],
    mistakes: [
      'Mandar todas as leituras direto para ele.',
      'Tratá-lo como ilimitado: é o gargalo mais comum.',
    ],
  },
  replica: {
    whatIs:
      'Cópia do banco que só responde leituras: 1.000 req/s por $80/mês. O primário manda cada escrita para ela, e a cópia chega com atraso.',
    whenToUse: 'Quando as leituras passam do que um banco aguenta e o cache não basta. Ligue o banco a ela e mande as leituras para ela.',
    gains: [
      'Escala leitura mais barato que outro banco: o primário fica só com as escritas.',
      'Cada réplica soma 1.000 leituras por segundo.',
    ],
    costs: [
      'Quem edita o perfil pode ler a versão antiga logo depois: consistência eventual.',
      'A cópia atrasa mais quanto mais escritas chegam e quanto mais cheia ela está.',
    ],
    mistakes: [
      'Não ligar o banco à réplica: ela nunca recebe mudança e toda leitura sai velha.',
      'Lotar a réplica de leituras: sem fôlego para aplicar as escritas, o atraso de replicação dispara.',
    ],
  },
  queue: {
    whatIs:
      'Guarda as escritas e responde ao usuário na hora; workers consomem depois, no ritmo deles. Cabem 20.000 mensagens, e acima disso ela recusa.',
    whenToUse: 'Quando picos de escrita passam do que o banco aguenta, mas a escrita pode terminar alguns segundos depois.',
    gains: [
      'Absorve picos sem dimensionar tudo para o pico.',
      'O usuário não espera o banco: a escrita responde em milissegundos.',
    ],
    costs: [
      'A escrita aceita só aparece quando um worker processa: consistência eventual.',
      'Mais uma peça para operar, $30/mês, e os workers à parte.',
    ],
    mistakes: [
      'Poucos workers: o backlog nunca esvazia e o problema só foi adiado.',
      'Mandar leituras para a fila: quem lê precisa da resposta agora.',
    ],
  },
  worker: {
    whatIs:
      'Processo que tira mensagens da fila e faz o trabalho, aqui gravar no banco. Processa 200 mensagens/s e custa $40/mês.',
    whenToUse: 'Atrás de uma fila. Some workers até que eles consumam, em média, mais do que chega.',
    gains: [
      'Escala horizontalmente: cada worker a mais esvazia a fila mais rápido.',
      'Trabalha fora do caminho do usuário, sem pesar na latência.',
    ],
    costs: [
      'Workers demais repassam o pico inteiro ao banco, e a fila deixa de proteger.',
      'Escrita perdida depois da fila já foi confirmada ao usuário.',
    ],
    mistakes: [
      'Esquecer de ligar o worker ao banco: as mensagens saem da fila e se perdem.',
      'Dimensionar pelo pico: basta vencer a média e ter fila para o resto.',
    ],
  },
}

export interface GlossaryEntry {
  id: string
  term: string
  /** Forms that link to this entry when found in a text, besides `term`. */
  forms?: string[]
  definition: string
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'req-s',
    term: 'req/s',
    definition: 'Requisições por segundo. Mede o tráfego que chega e a capacidade de cada peça.',
  },
  {
    id: 'throughput',
    term: 'throughput',
    definition: 'Quantas requisições o sistema completa por segundo. Acima da capacidade, o excedente é perdido.',
  },
  {
    id: 'latencia',
    term: 'latência',
    definition: 'Tempo entre pedir e receber a resposta. Soma o tempo de cada peça no caminho.',
  },
  {
    id: 'p99',
    term: 'p99',
    definition:
      '99% das requisições respondem em até esse tempo. Mostra o pior caso comum, que a média esconde.',
  },
  {
    id: 'disponibilidade',
    term: 'disponibilidade',
    definition: 'Fração das requisições respondidas com sucesso. 99,9% ainda perde uma em cada mil.',
  },
  {
    id: 'utilizacao',
    term: 'utilização',
    definition:
      'Carga dividida pela capacidade. Perto de 100%, a fila e a latência crescem muito mais rápido que a carga.',
  },
  {
    id: 'escalar-horizontalmente',
    term: 'escalar horizontalmente',
    definition: 'Somar capacidade com mais cópias da mesma peça, em vez de trocar por uma maior.',
  },
  {
    id: 'sem-estado',
    term: 'sem estado',
    forms: ['stateless'],
    definition:
      'Servidor que não guarda nada entre uma requisição e outra. O que precisa durar fica no banco, e por isso qualquer cópia atende qualquer pessoa.',
  },
  {
    id: 'ponto-unico',
    term: 'ponto único de falha',
    definition: 'Peça que, se cair, derruba o sistema inteiro porque não há outra fazendo o mesmo papel.',
  },
  {
    id: 'redundancia',
    term: 'redundância',
    forms: ['redundante', 'redundantes'],
    definition: 'Mais de uma peça fazendo o mesmo papel, para que a queda de uma não derrube o serviço.',
  },
  {
    id: 'folga',
    term: 'folga',
    forms: ['folga de capacidade'],
    definition:
      'Capacidade além da carga esperada. Cobre o pico e a queda de uma peça: com N servidores no limite, quando um cai os outros transbordam.',
  },
  {
    id: 'health-check',
    term: 'health check',
    definition: 'Teste periódico que o balanceador faz em cada servidor. Quem falha deixa de receber tráfego.',
  },
  {
    id: 'backpressure',
    term: 'backpressure',
    definition:
      'Uma peça sobrecarregada avisa quem manda tráfego para desacelerar, em vez de aceitar e falhar. No jogo não há: o excedente é descartado.',
  },
  {
    id: 'miss',
    term: 'miss',
    forms: ['misses'],
    definition: 'Leitura que não está no cache e precisa ir ao banco.',
  },
  {
    id: 'cache-frio',
    term: 'cache frio',
    definition: 'Cache vazio, como depois de reiniciar. Até se encher de novo, quase toda leitura vai ao banco.',
  },
  {
    id: 'invalidacao',
    term: 'invalidação',
    forms: ['invalidada', 'invalidar'],
    definition: 'Apagar ou trocar a cópia no cache quando o dado original muda.',
  },
  {
    id: 'estaticos',
    term: 'estáticos',
    forms: ['estático', 'arquivos estáticos'],
    definition: 'Arquivos iguais para todo mundo, como imagens, CSS e scripts. Não precisam do banco.',
  },
  {
    id: 'borda',
    term: 'borda',
    definition: 'Servidores da CDN espalhados perto das pessoas, longe da origem.',
  },
  {
    id: 'backlog',
    term: 'backlog',
    definition:
      'O que está esperando na fila para ser processado. Cresce quando chega mais do que os workers consomem.',
  },
  {
    id: 'consistencia-eventual',
    term: 'consistência eventual',
    definition:
      'O dado fica certo em todo lugar depois de um tempo, não na hora. Até lá, alguém pode ver a versão antiga.',
  },
  {
    id: 'atraso-replicacao',
    term: 'atraso de replicação',
    definition:
      'Tempo entre a escrita no primário e ela aparecer na réplica. Cresce com o volume de escritas e com a réplica sobrecarregada.',
  },
  {
    id: 'leitura-desatualizada',
    term: 'leitura desatualizada',
    forms: ['leituras desatualizadas'],
    definition: 'Leitura que devolve a versão antiga de um dado que já mudou no primário, por causa do atraso de replicação.',
  },
  {
    id: 'primario',
    term: 'primário',
    definition: 'O banco que recebe as escritas e as repassa às réplicas.',
  },
  {
    id: 'assincrono',
    term: 'assíncrono',
    forms: ['assíncrona', 'processamento assíncrono'],
    definition: 'Trabalho feito depois, fora do caminho da resposta. O usuário recebe o "ok" antes de terminar.',
  },
  {
    id: 'retry',
    term: 'retry',
    forms: ['retries', 'tentativas extras', 'tentativa extra'],
    definition: 'Chamar de novo depois de uma falha. Resolve falhas passageiras, mas cada tentativa é mais carga no destino.',
  },
  {
    id: 'backoff',
    term: 'backoff',
    forms: ['backoff exponencial', 'jitter'],
    definition: 'Esperar cada vez mais entre tentativas, com um sorteio (jitter) para que os clientes não voltem todos juntos.',
  },
  {
    id: 'circuit-breaker',
    term: 'circuit breaker',
    forms: ['breaker'],
    definition: 'Disjuntor da ligação: depois de muitas falhas para de chamar o destino por um tempo, falha na hora e depois testa com pouco tráfego.',
  },
  {
    id: 'tempestade-retries',
    term: 'tempestade de retries',
    definition: 'Quando tentativas extras sobrecarregam um destino lento, que falha mais, gera mais tentativas e acaba caindo.',
  },
  {
    id: 'http-429',
    term: '429',
    forms: ['HTTP 429'],
    definition: 'Resposta "muitas requisições": o servidor recusa na hora em vez de tentar e cair. Rápida e barata, mas o usuário fica sem resposta.',
  },
  {
    id: 'rate-limit',
    term: 'rate limit',
    forms: ['limite de taxa', 'limite por cliente'],
    definition: 'Teto de requisições por segundo, por cliente ou no total. O que passa do teto leva 429.',
  },
  {
    id: 'bot',
    term: 'bot',
    forms: ['bots', 'scraper'],
    definition: 'Programa que faz requisições sozinho, muitas vezes rápido demais. Gasta capacidade de quem atende pessoas.',
  },
  {
    id: 'dns',
    term: 'DNS',
    definition: 'Traduz o nome do site para o endereço de uma peça. Aqui aponta para um único lugar.',
  },
]

export type Segment = string | { text: string; entry: GlossaryEntry }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

const FORMS = GLOSSARY.flatMap((entry) => [entry.term, ...(entry.forms ?? [])].map((form) => ({ form, entry })))
  // Longest first, so "arquivos estáticos" wins over "estáticos".
  .sort((a, b) => b.form.length - a.form.length)
const byForm = new Map(FORMS.map((f) => [f.form.toLowerCase(), f.entry]))
// Letters and digits around a match mean it is part of a longer word.
const TERM_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${FORMS.map((f) => escape(f.form)).join('|')})(?![\\p{L}\\p{N}])`, 'giu')

/**
 * Splits `text` into plain strings and glossary terms. Only the first occurrence
 * of each entry is marked; ids already in `seen` are skipped and new ones added,
 * so a whole panel can link each term once.
 */
export function splitTerms(text: string, seen: Set<string> = new Set()): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(TERM_RE)) {
    const entry = byForm.get(m[0].toLowerCase())
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ text: m[0], entry })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
