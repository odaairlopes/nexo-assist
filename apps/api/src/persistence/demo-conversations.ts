import { formatLocalTime, type AgentAction, type AgentTrace, type Intent, type PersonRef, type TransferInfo } from '@nexo/shared';
import { Store } from './store.ts';

/**
 * Conversas de exemplo para o console do analista abrir já com movimento,
 * como no protótipo (Tela 4): transferidas, "agent pediu ajuda", com o agent,
 * com um analista, resolvidas pelo agent e um caso crítico.
 *
 * Só roda com o banco vazio. Ana Souza, Marcos Vieira e Renata Lopes ficam de
 * fora de propósito: são as contas para testar o chat do zero.
 */

const MIN = 60_000;

interface Employee extends PersonRef {
  department: string;
}

const AGENT: PersonRef = { email: 'assist@nexo.com.br', name: 'Nexo Assist' };

function trace(t: { understood: string; intent: Intent; action: AgentAction; confidence: number; reasoning: string; steps: string[]; guardrails?: string[] }): AgentTrace {
  return {
    understood: t.understood,
    intent: t.intent,
    action: t.action,
    confidence: t.confidence,
    reasoning: t.reasoning,
    steps: t.steps.map((label) => ({ tool: 'exemplo', label, input: { exemplo: true }, output: { exemplo: true }, ok: true, durationMs: 0 })),
    guardrails: t.guardrails ?? [],
    model: 'dados de exemplo (seed)',
    latencyMs: 0,
    usage: null,
    error: null,
  };
}

type Line =
  | { at: number; user: string }
  | { at: number; agent: string; trace: AgentTrace }
  | { at: number; analyst: string; by: PersonRef }
  | { at: number; system: string };

interface DemoConversation {
  employee: Employee;
  lines: Line[];
  final: {
    status: 'agent' | 'waiting_human' | 'human' | 'closed';
    transfer?: Omit<TransferInfo, 'at'> & { atMinutesAgo: number };
    assigned?: PersonRef;
    ticketRef?: string;
  };
}

const JULIA: PersonRef = { email: 'julia.costa@nexo.com.br', name: 'Júlia Costa' };

function demo(now: number): DemoConversation[] {
  const t = (minutesAgo: number) => minutesAgo;
  const hhmm = (minutesAgo: number) => formatLocalTime(new Date(now - minutesAgo * MIN));
  return [
    {
      employee: { email: 'carla.mendes@nexo.com.br', name: 'Carla Mendes', department: 'Comercial' },
      lines: [
        { at: t(34), user: 'Preciso de acesso ao SAP ainda hoje para lançar o pedido de um cliente novo.' },
        {
          at: t(33),
          agent: 'Você já tem o REQ-10450 aberto para isso, com prioridade alta e resposta prevista ainda hoje. Quer que eu chame um analista para agilizar?',
          trace: trace({
            understood: 'Quer acesso ao SAP hoje; já existe requisição aberta sobre isso.',
            intent: 'ticket_status',
            action: 'showed_ticket',
            confidence: 0.92,
            reasoning: 'Sem duplicidade (Anexo A): o REQ-10450 já trata do acesso ao SAP; ofereço transferência por haver compromisso no mesmo dia.',
            steps: ['consultou seus chamados'],
          }),
        },
        { at: t(26), user: 'Sim, por favor. O cliente está esperando.' },
        {
          at: t(25),
          agent: 'Encaminhei para o Suporte N1. Um analista vai falar com você aqui nesta conversa.',
          trace: trace({
            understood: 'Pediu para falar com um analista.',
            intent: 'talk_to_human',
            action: 'transferred',
            confidence: 0.96,
            reasoning: 'Transferência a pedido do funcionário (Anexo A), com o REQ-10450 vinculado.',
            steps: ['chamou um analista'],
          }),
        },
        { at: t(25), system: `Transferida para Suporte N1 · ${hhmm(25)}` },
      ],
      final: {
        status: 'waiting_human',
        ticketRef: 'REQ-10450',
        transfer: {
          kind: 'requested',
          reason: 'Funcionária pediu analista; acesso ao SAP necessário hoje',
          summary: 'Carla Mendes (Comercial) precisa de acesso ao módulo de vendas do SAP ainda hoje para lançar o pedido de um cliente novo. Requisição REQ-10450 aberta há 2 h, prioridade alta.',
          queue: 'N1',
          confidence: 0.96,
          ticketId: 'REQ-10450',
          atMinutesAgo: 25,
        },
      },
    },
    {
      employee: { email: 'bruno.tavares@nexo.com.br', name: 'Bruno Tavares', department: 'Marketing' },
      lines: [
        {
          at: t(52),
          user: 'A impressora do 3º andar voltou mas agora sai tudo em branco, e o Figma pediu aprovação de novo. Será que é a mesma coisa?',
        },
        {
          at: t(51),
          agent: 'Não tenho segurança para resolver isso sozinho, então chamei um analista do Suporte N1. Ele continua com você aqui nesta conversa.',
          trace: trace({
            understood: 'Relata dois problemas diferentes (impressão em branco e licença do Figma) e pergunta se estão ligados.',
            intent: 'ticket_update',
            action: 'transferred',
            confidence: 0.41,
            reasoning: 'Dois chamados possíveis (INC-20305 e REQ-10437) e não ficou claro qual atualizar.',
            steps: ['consultou seus chamados'],
            guardrails: ['Confiança 41% abaixo do mínimo (50%): transferido para analista.'],
          }),
        },
        { at: t(51), system: `Transferida para Suporte N1 · ${hhmm(51)}` },
      ],
      final: {
        status: 'waiting_human',
        ticketRef: 'INC-20305',
        transfer: {
          kind: 'low_confidence',
          reason: 'Agent sem segurança para decidir (confiança 41%)',
          summary: 'O funcionário quer: saber se a impressão em branco (INC-20305) e o pedido de aprovação do Figma (REQ-10437) são o mesmo problema. Avaliação do agent: dois chamados possíveis, não ficou claro qual atualizar.',
          queue: 'N1',
          confidence: 0.41,
          ticketId: null,
          atMinutesAgo: 51,
        },
      },
    },
    {
      employee: { email: 'paulo.souza@nexo.com.br', name: 'Paulo Souza', department: 'Operações' },
      lines: [
        { at: t(52), user: 'O WMS caiu para toda a equipe de Operações, ninguém consegue emitir etiqueta de expedição. Tem caminhão esperando.' },
        {
          at: t(51),
          agent: 'Montei um rascunho com prioridade crítica. Confira e confirme para eu abrir.',
          trace: trace({
            understood: 'Sistema de expedição parado para a equipe inteira.',
            intent: 'new_ticket',
            action: 'drafted_ticket',
            confidence: 0.95,
            reasoning: 'Algo parado para uma equipe → crítica (Anexo A), prazo de 1 hora com plantão.',
            steps: ['consultou seus chamados', 'classificou a prioridade', 'consultou o SLA', 'montou o rascunho'],
          }),
        },
        { at: t(50), user: 'Pode abrir.' },
        {
          at: t(50),
          agent: 'Pronto: abri o INC-20491 com prioridade crítica. Como é um caso crítico, já chamei um analista do Suporte N2 — ele continua com você por aqui.',
          trace: trace({
            understood: 'Confirmou o rascunho.',
            intent: 'confirm',
            action: 'confirmed_draft',
            confidence: 1,
            reasoning: 'Confirmação explícita; chamado crítico é transferido automaticamente ao N2.',
            steps: ['criou o chamado'],
            guardrails: ['Caso crítico: transferência automática para o Suporte N2.'],
          }),
        },
        { at: t(50), system: `Transferida para Suporte N2 · ${hhmm(50)}` },
      ],
      final: {
        status: 'waiting_human',
        ticketRef: 'INC-20491',
        transfer: {
          kind: 'critical',
          reason: 'Chamado crítico: algo parado para uma equipe',
          summary: 'INC-20491 — Sistema de expedição (WMS) fora do ar para toda a equipe de Operações desde as 8h; caminhões aguardando.',
          queue: 'N2',
          confidence: null,
          ticketId: 'INC-20491',
          atMinutesAgo: 50,
        },
      },
    },
    {
      employee: { email: 'juliana.alves@nexo.com.br', name: 'Juliana Alves', department: 'Jurídico' },
      lines: [
        { at: t(118), user: 'Preciso de acesso à pasta Contratos ainda hoje, tenho minutas para revisar.' },
        {
          at: t(117),
          agent: 'O REQ-10458 já está aberto para isso, com prioridade alta. Vou chamar um analista para agilizar, já que o prazo é hoje.',
          trace: trace({
            understood: 'Precisa de acesso à pasta Contratos hoje.',
            intent: 'ticket_status',
            action: 'transferred',
            confidence: 0.9,
            reasoning: 'Requisição já aberta; compromisso no mesmo dia justifica chamar um analista.',
            steps: ['consultou seus chamados', 'chamou um analista'],
          }),
        },
        { at: t(117), system: `Transferida para Suporte N1 · ${hhmm(117)}` },
        { at: t(110), system: `Júlia Costa assumiu · agent pausado · ${hhmm(110)}` },
        { at: t(109), analyst: 'Oi, Juliana! Aqui é a Júlia. Já pedi a aprovação ao dono da pasta; te aviso aqui assim que liberar.', by: JULIA },
        { at: t(100), user: 'Combinado, obrigada!' },
      ],
      final: { status: 'human', assigned: JULIA, ticketRef: 'REQ-10458' },
    },
    {
      employee: { email: 'diego.ramos@nexo.com.br', name: 'Diego Ramos', department: 'Engenharia' },
      lines: [
        { at: t(3), user: 'A VPN continua caindo a cada 30 minutos.' },
        {
          at: t(2),
          agent: 'O INC-20290 está aguardando analista e já passou do prazo de 4 horas úteis. Quer que eu chame um analista?',
          trace: trace({
            understood: 'Pergunta sobre o problema da VPN que já tem chamado.',
            intent: 'ticket_status',
            action: 'showed_ticket',
            confidence: 0.93,
            reasoning: 'INC-20290 vencido; ofereço transferência antes de transferir (Anexo A).',
            steps: ['consultou seus chamados', 'calculou o prazo'],
          }),
        },
      ],
      final: { status: 'agent', ticketRef: 'INC-20290' },
    },
    {
      employee: { email: 'elisa.prado@nexo.com.br', name: 'Elisa Prado', department: 'Pessoas' },
      lines: [
        { at: t(185), user: 'A planilha da folha de pagamento não abre, diz que está corrompida.' },
        {
          at: t(184),
          agent: 'Montei um rascunho de chamado com prioridade média. Confira e confirme.',
          trace: trace({
            understood: 'Uma planilha específica não abre no Excel.',
            intent: 'new_ticket',
            action: 'drafted_ticket',
            confidence: 0.88,
            reasoning: 'Atrapalha, mas há alternativa (outras planilhas abrem) → média.',
            steps: ['buscou na central de ajuda', 'classificou a prioridade', 'montou o rascunho'],
          }),
        },
        { at: t(181), user: 'Pode criar.' },
        {
          at: t(180),
          agent: 'Chamado INC-20489 criado. Um analista responde em até 3 dias úteis.',
          trace: trace({
            understood: 'Confirmou o rascunho.',
            intent: 'confirm',
            action: 'confirmed_draft',
            confidence: 1,
            reasoning: 'Confirmação explícita do funcionário.',
            steps: ['criou o chamado'],
          }),
        },
      ],
      final: { status: 'agent', ticketRef: 'INC-20489' },
    },
    {
      employee: { email: 'fabio.nunes@nexo.com.br', name: 'Fábio Nunes', department: 'Logística' },
      lines: [
        { at: t(24 * 60 + 40), user: 'O Wi-Fi do galpão fica caindo no meu notebook.' },
        {
          at: t(24 * 60 + 39),
          agent: 'Reinicie o notebook e rode o diagnóstico "Saúde do PC" no portal de softwares; ele atualiza o driver de rede. Se continuar, eu abro um chamado.',
          trace: trace({
            understood: 'Conexão Wi-Fi instável no galpão.',
            intent: 'question',
            action: 'answered_from_kb',
            confidence: 0.84,
            reasoning: 'KB-007 cobre o diagnóstico; tentar antes de abrir chamado (resolução sem fila).',
            steps: ['consultou seus chamados', 'buscou na central de ajuda'],
          }),
        },
        { at: t(24 * 60 + 20), user: 'Isso resolveu, obrigado!' },
        { at: t(24 * 60 + 19), system: `Atendimento encerrado · ${hhmm(24 * 60 + 19)}` },
      ],
      final: { status: 'closed' },
    },
    {
      employee: { email: 'gabriela.rocha@nexo.com.br', name: 'Gabriela Rocha', department: 'Compras' },
      lines: [
        { at: t(26 * 60), user: 'Qual a senha do Wi-Fi para um fornecedor que veio aqui?' },
        {
          at: t(26 * 60 - 1),
          agent: 'Visitantes usam a rede Nexo-Guest. A senha fica na recepção e é trocada toda segunda-feira.',
          trace: trace({
            understood: 'Quer a senha do Wi-Fi para um visitante.',
            intent: 'question',
            action: 'answered_from_kb',
            confidence: 0.97,
            reasoning: 'KB-006 responde diretamente; sem necessidade de chamado.',
            steps: ['buscou na central de ajuda'],
          }),
        },
        { at: t(26 * 60 - 3), user: 'Perfeito, obrigada.' },
        { at: t(26 * 60 - 4), system: `Atendimento encerrado · ${hhmm(26 * 60 - 4)}` },
      ],
      final: { status: 'closed' },
    },
  ];
}

export function seedDemoConversations(dbPath: string, now: Date = new Date()): number {
  let clock = now.getTime();
  const store = new Store(dbPath, () => new Date(clock));
  try {
    if (store.listConversations().length > 0) return 0;
    const conversations = demo(now.getTime());
    for (const c of conversations) {
      clock = now.getTime() - (c.lines[0]?.at ?? 0) * MIN - MIN;
      const conv = store.createConversation(c.employee);
      for (const line of c.lines) {
        clock = now.getTime() - line.at * MIN;
        if ('user' in line) store.addMessage({ conversationId: conv.id, role: 'user', author: c.employee, content: line.user });
        else if ('agent' in line) store.addMessage({ conversationId: conv.id, role: 'agent', author: AGENT, content: line.agent, trace: line.trace });
        else if ('analyst' in line) store.addMessage({ conversationId: conv.id, role: 'analyst', author: line.by, content: line.analyst });
        else store.addMessage({ conversationId: conv.id, role: 'system', author: null, content: line.system });
      }
      const { transfer, ...rest } = c.final;
      store.updateConversation(conv.id, {
        status: rest.status,
        ...(rest.assigned ? { assigned: rest.assigned } : {}),
        ...(rest.ticketRef ? { ticketRef: rest.ticketRef } : {}),
        ...(transfer
          ? {
              transfer: {
                kind: transfer.kind,
                reason: transfer.reason,
                summary: transfer.summary,
                queue: transfer.queue,
                confidence: transfer.confidence,
                ticketId: transfer.ticketId,
                at: new Date(now.getTime() - transfer.atMinutesAgo * MIN).toISOString(),
              },
            }
          : {}),
      });
    }
    return conversations.length;
  } finally {
    store.close();
  }
}
