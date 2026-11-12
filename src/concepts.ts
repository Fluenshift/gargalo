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
    id: 'ponto-unico',
    term: 'ponto único de falha',
    definition: 'Peça que, se cair, derruba o sistema inteiro porque não há outra fazendo o mesmo papel.',
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
