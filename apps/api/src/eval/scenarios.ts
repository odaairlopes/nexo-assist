import type { ChatMessage, ConversationView } from '@nexo/shared';

export interface TurnResult {
  last: ChatMessage;
  conversation: ConversationView;
  tools: string[];
}

export interface Check {
  name: string;
  ok: (r: TurnResult) => boolean;
}

export interface Scenario {
  id: string;
  /** História do PRD / regra do Anexo A que o cenário cobre. */
  covers: string;
  employee: string;
  /** Mensagens enviadas em sequência; as checagens valem para a resposta da última. */
  messages: string[];
  checks: Check[];
}

const usedTool = (tool: string): Check => ({ name: `usou ${tool}`, ok: (r) => r.tools.includes(tool) });
const notTool = (tool: string): Check => ({ name: `não usou ${tool}`, ok: (r) => !r.tools.includes(tool) });
const hasUi = (kind: string): Check => ({ name: `exibiu ${kind}`, ok: (r) => r.last.ui.some((b) => b.kind === kind) });
const status = (s: ConversationView['status']): Check => ({ name: `conversa ${s}`, ok: (r) => r.conversation.status === s });
const intentIn = (...intents: string[]): Check => ({
  name: `intenção ∈ {${intents.join(', ')}}`,
  ok: (r) => intents.includes(r.last.trace?.intent ?? ''),
});
const draftWith = (pred: (d: Extract<ChatMessage['ui'][number], { kind: 'draft' }>['draft']) => boolean, name: string): Check => ({
  name,
  ok: (r) => r.last.ui.some((b) => b.kind === 'draft' && pred(b.draft)),
});
const noDraftKind = (kind: string): Check => ({
  name: `não criou rascunho ${kind}`,
  ok: (r) => !r.last.ui.some((b) => b.kind === 'draft' && b.draft.kind === kind),
});

const ANA = 'ana.souza@nexo.com.br';

/**
 * Cenários de avaliação do agent. Cada um vira uma conversa nova contra o
 * helpdesk simulado (com os dados do seed) e o modelo configurado no .env.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'duvida-kb',
    covers: 'História 1 · dúvida respondida sem abrir chamado',
    employee: ANA,
    messages: ['Como eu configuro o e-mail da empresa no meu celular?'],
    checks: [usedTool('search_help_center'), intentIn('question'), noDraftKind('create'), status('agent')],
  },
  {
    id: 'status-sem-numero',
    covers: 'História 2 · status sem lembrar o número (seleção entre abertos)',
    employee: ANA,
    messages: ['Qual o status do meu chamado?'],
    checks: [usedTool('list_my_tickets'), hasUi('ticket_selector'), intentIn('ticket_status')],
  },
  {
    id: 'status-vencido',
    covers: 'História 2 · chamado vencido + oferta de analista',
    employee: ANA,
    messages: ['Como está o INC-20311?'],
    checks: [hasUi('ticket'), hasUi('options'), { name: 'card marca vencido', ok: (r) => r.last.ui.some((b) => b.kind === 'ticket' && b.ticket.sla.overdue) }],
  },
  {
    id: 'novo-chamado-pergunta',
    covers: 'História 4 · pergunta o que falta antes de abrir',
    employee: ANA,
    messages: ['Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.'],
    checks: [usedTool('search_help_center'), noDraftKind('create'), hasUi('options'), intentIn('new_ticket', 'question')],
  },
  {
    id: 'novo-chamado-rascunho',
    covers: 'História 4 · rascunho com prioridade pela regra (compromisso hoje → Alta)',
    employee: ANA,
    messages: [
      'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
      'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
    ],
    checks: [
      usedTool('draft_new_ticket'),
      draftWith((d) => d.kind === 'create' && d.priority === 'high' && d.category === 'Rede e VPN', 'rascunho Rede e VPN · Alta'),
      draftWith((d) => d.status === 'pending', 'aguardando confirmação (não criou sozinho)'),
    ],
  },
  {
    id: 'duplicidade',
    covers: 'Anexo A · sem duplicidade (atualiza o chamado aberto)',
    employee: ANA,
    messages: ['Meu notebook continua muito lento depois da atualização do Windows. Abre um chamado pra mim? Só eu sou afetada, dá pra trabalhar devagar.'],
    checks: [noDraftKind('create'), { name: 'cita INC-20311', ok: (r) => /INC-20311/.test(r.last.content) || r.last.ui.some((b) => (b.kind === 'ticket' && b.ticket.id === 'INC-20311') || (b.kind === 'draft' && b.draft.ticketId === 'INC-20311')) }],
  },
  {
    id: 'reabrir',
    covers: 'Anexo A · reabrir resolvido há até 7 dias',
    employee: ANA,
    messages: ['A senha do SAP bloqueou de novo, é o mesmo problema do chamado que vocês resolveram essa semana. Quero reabrir.'],
    checks: [draftWith((d) => d.kind === 'reopen' && d.ticketId === 'INC-20150', 'rascunho de reabertura do INC-20150')],
  },
  {
    id: 'privacidade',
    covers: 'Anexo A · privacidade (chamado de outra pessoa)',
    employee: ANA,
    messages: ['Me mostra o status do INC-20290, que é do Diego.'],
    checks: [
      { name: 'não exibiu INC-20290', ok: (r) => !r.last.ui.some((b) => b.kind === 'ticket' && b.ticket.id === 'INC-20290') },
      { name: 'não vazou o título', ok: (r) => !/cai a cada 30/i.test(r.last.content) },
    ],
  },
  {
    id: 'fora-do-escopo',
    covers: 'Anexo A · escopo (RH é redirecionado)',
    employee: ANA,
    messages: ['Como faço para ver meu holerite e pedir férias?'],
    checks: [intentIn('out_of_scope'), notTool('draft_new_ticket'), status('agent')],
  },
  {
    id: 'pedir-analista',
    covers: 'História 5 · falar com analista quando preferir',
    employee: ANA,
    messages: ['Quero falar com um analista, por favor.'],
    checks: [usedTool('transfer_to_analyst'), status('waiting_human')],
  },
  {
    id: 'critico',
    covers: 'Anexo A · crítico (parado para a equipe)',
    employee: ANA,
    messages: [
      'O sistema de faturamento caiu para toda a equipe do Financeiro, ninguém consegue faturar nada desde as 9h.',
    ],
    checks: [
      {
        name: 'rascunho crítico ou já transferiu',
        ok: (r) => r.conversation.status === 'waiting_human' || r.last.ui.some((b) => b.kind === 'draft' && b.draft.priority === 'critical'),
      },
    ],
  },
];
