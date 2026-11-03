import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  CategorySchema,
  classifyPriority,
  computeDueDate,
  computeSlaStatus,
  canReopen,
  DUPLICATE_BLOCK_THRESHOLD,
  DUPLICATE_WARN_THRESHOLD,
  formatLocalDateTime,
  formatLocalTime,
  isSameLocalDay,
  ImpactSchema,
  PRIORITY_LABEL,
  SLA_POLICIES,
  STATUS_LABEL,
  ticketSimilarity,
  TicketTypeSchema,
  ACTIVE_STATUSES,
  businessMinutesBetween,
  BUSINESS_MINUTES_PER_DAY,
  type Ticket,
} from '@nexo/shared';
import { HelpdeskRequestError, HelpdeskUnavailableError, type HelpdeskClient } from '../clients/helpdesk-client.ts';
import type { ConversationService } from '../domain/conversation-service.ts';
import { DomainError } from '../domain/errors.ts';
import type { Store } from '../persistence/store.ts';
import { TURN_KEY, type TurnContext } from './turn-context.ts';

export interface ToolDeps {
  helpdesk: HelpdeskClient;
  store: Store;
  conversations: ConversationService;
  now?: () => Date;
}

/** Mastra entrega o RequestContext no 2º parâmetro do execute. */
function turnOf(context: unknown): TurnContext {
  const rc = (context as { requestContext?: { get: (k: string) => unknown } } | undefined)?.requestContext;
  const turn = rc?.get(TURN_KEY);
  if (!turn) throw new Error('TurnContext ausente no RequestContext');
  return turn as TurnContext;
}

const UNAVAILABLE = {
  ok: false as const,
  error: 'sistema_de_chamados_indisponivel',
  message: 'O sistema de chamados não respondeu mesmo após novas tentativas. Avise o funcionário e sugira tentar de novo em instantes.',
};

function friendlyError(err: unknown) {
  if (err instanceof HelpdeskUnavailableError) return UNAVAILABLE;
  if (err instanceof HelpdeskRequestError && err.status === 404) {
    return { ok: false as const, error: 'nao_encontrado', message: 'Chamado não encontrado entre os chamados deste funcionário.' };
  }
  if (err instanceof HelpdeskRequestError) return { ok: false as const, error: 'recusado', message: err.message };
  if (err instanceof DomainError) return { ok: false as const, error: err.code, message: err.message };
  throw err;
}

/** Resumo compacto de um chamado para o modelo (economiza tokens). */
function compact(t: Ticket, now: Date) {
  const sla = computeSlaStatus(t, now);
  const daysWithoutUpdate = Math.floor(businessMinutesBetween(new Date(t.updatedAt), now) / BUSINESS_MINUTES_PER_DAY);
  return {
    id: t.id,
    titulo: t.title,
    tipo: t.type,
    categoria: t.subcategory ? `${t.category} › ${t.subcategory}` : t.category,
    prioridade: PRIORITY_LABEL[t.priority],
    status: STATUS_LABEL[t.status],
    aberto_em: formatLocalDateTime(new Date(t.createdAt)),
    ultima_atualizacao: formatLocalDateTime(new Date(t.updatedAt)),
    dias_uteis_sem_atualizacao: daysWithoutUpdate,
    prazo: sla.running ? SLA_POLICIES[t.priority].label : null,
    prazo_vence_em: sla.dueAt ? formatLocalDateTime(new Date(sla.dueAt)) : null,
    vencido: sla.overdue,
    pode_reabrir: canReopen(t, now),
  };
}

export function buildTools(deps: ToolDeps) {
  const now = deps.now ?? (() => new Date());

  const searchHelpCenter = createTool({
    id: 'search_help_center',
    description:
      'Busca artigos na central de ajuda de TI. Use ANTES de abrir chamado para dúvidas e problemas comuns. Retorna até 3 artigos com score de relevância (0..1).',
    inputSchema: z.object({ query: z.string().min(2).describe('Termos do problema, ex.: "VPN erro 809"') }),
    execute: async ({ query }, context) => {
      const turn = turnOf(context);
      try {
        return await turn.traced<unknown>('search_help_center', 'buscou na central de ajuda', { query }, async () => {
          const results = await deps.helpdesk.searchKb(query);
          const result = {
            ok: true as const,
            artigos: results.map((r) => ({ id: r.article.id, titulo: r.article.title, texto: r.article.body, relevancia: r.score })),
          };
          return { result, summary: { artigos: results.map((r) => `${r.article.id} (${r.score})`) } };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const listMyTickets = createTool({
    id: 'list_my_tickets',
    description:
      'Lista os chamados do funcionário logado (somente dele). Use para consultar status, achar um chamado quando ele não lembra o número e checar duplicidade antes de abrir um novo.',
    inputSchema: z.object({
      scope: z.enum(['abertos', 'todos']).describe('"abertos" = ainda em andamento; "todos" inclui resolvidos'),
    }),
    execute: async ({ scope }, context) => {
      const turn = turnOf(context);
      try {
        return await turn.traced<unknown>('list_my_tickets', 'consultou seus chamados', { scope }, async () => {
          const all = await deps.helpdesk.listTickets(turn.employee.email);
          turn.rememberTickets(all);
          const n = now();
          const list = scope === 'abertos' ? all.filter((t) => ACTIVE_STATUSES.includes(t.status)) : all;
          const result = { ok: true as const, total: list.length, chamados: list.map((t) => compact(t, n)) };
          return { result, summary: { total: list.length, ids: list.map((t) => t.id) } };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const getTicket = createTool({
    id: 'get_ticket',
    description: 'Detalhes de UM chamado do funcionário, incluindo prazo (SLA) e se está vencido.',
    inputSchema: z.object({ ticketId: z.string().regex(/^(INC|REQ)-\d+$/i).describe('Ex.: INC-20311') }),
    execute: async ({ ticketId }, context) => {
      const turn = turnOf(context);
      const id = ticketId.toUpperCase();
      try {
        return await turn.traced<unknown>('get_ticket', `consultou o ${id}`, { ticketId: id }, async () => {
          const t = await deps.helpdesk.getTicket(id, turn.employee.email);
          turn.rememberTickets([t]);
          const last = t.events[t.events.length - 1];
          const result = {
            ok: true as const,
            chamado: { ...compact(t, now()), descricao: t.description, ultimo_evento: last?.text ?? null },
          };
          const labels = [`consultou o ${id}`];
          if (computeSlaStatus(t, now()).running) labels.push('calculou o prazo');
          return { result, labels, summary: { id: t.id, status: t.status, vencido: result.chamado.vencido } };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const draftNewTicket = createTool({
    id: 'draft_new_ticket',
    description:
      'Monta o RASCUNHO de um chamado novo (não cria). O código calcula prioridade e prazo pelas regras do service desk e bloqueia duplicados. Só chame quando souber: o que aconteceu, quem é afetado, se impede o trabalho e se há compromisso hoje. Depois, mostre o rascunho (show_draft_id) e peça confirmação.',
    inputSchema: z.object({
      type: TicketTypeSchema.describe('INC = algo parou/não funciona; REQ = pedido de acesso, equipamento ou software'),
      title: z.string().min(8).max(90).describe('Título objetivo, ex.: "VPN não conecta no notebook — erro 809"'),
      description: z
        .string()
        .min(30)
        .max(1500)
        .describe('Descrição completa para o analista não precisar perguntar de novo: sintoma, desde quando, equipamento/SO, o que já foi tentado, impacto.'),
      category: CategorySchema,
      impact: ImpactSchema.describe('me = só a pessoa; team = a equipe; company = a empresa'),
      blocksWork: z.boolean().describe('true se impede a pessoa/equipe de trabalhar (está parado, sem alternativa)'),
      sameDayCommitment: z.boolean().describe('true se há compromisso em risco AINDA HOJE (reunião, entrega, prazo)'),
    }),
    execute: async (input, context) => {
      const turn = turnOf(context);
      try {
        return await turn.traced<unknown>('draft_new_ticket', 'classificou a prioridade', input, async () => {
          const n = now();
          const decision = classifyPriority(input);
          const due = computeDueDate(decision.priority, n);

          // Trava de duplicidade: compara com os chamados do próprio funcionário.
          const mine = await deps.helpdesk.listTickets(turn.employee.email);
          turn.rememberTickets(mine);
          const candidates = mine
            .filter((t) => ACTIVE_STATUSES.includes(t.status) || canReopen(t, n))
            .map((t) => ({ t, score: ticketSimilarity(input, t) }))
            .filter((c) => c.score >= DUPLICATE_WARN_THRESHOLD)
            .sort((a, b) => b.score - a.score);
          const top = candidates[0];
          if (top && top.score >= DUPLICATE_BLOCK_THRESHOLD) {
            const reopen = top.t.status === 'resolved';
            const result = {
              ok: false as const,
              error: 'duplicado',
              chamado_existente: compact(top.t, n),
              similaridade: top.score,
              instrucao: reopen
                ? `Já existe ${top.t.id} resolvido recentemente sobre o mesmo problema. Não crie outro: ofereça REABRIR com draft_ticket_update.`
                : `Já existe ${top.t.id} aberto sobre o mesmo problema. Não crie outro: ofereça complementar com draft_ticket_update.`,
            };
            turn.guardrails.push(`Criação bloqueada: similar a ${top.t.id} (score ${top.score}).`);
            return { result, labels: ['classificou a prioridade', 'encontrou um chamado parecido'], summary: { duplicado: top.t.id, score: top.score } };
          }

          const draft = deps.store.createDraft(turn.conversationId, turn.turnNumber, {
            kind: 'create',
            ticketId: null,
            type: input.type,
            title: input.title,
            description: input.description,
            category: input.category,
            priority: decision.priority,
            priorityRule: decision.rule,
            dueAt: due.toISOString(),
            slaLabel: SLA_POLICIES[decision.priority].label,
            affected: input.impact,
            comment: null,
          });
          turn.draftIds.add(draft.id);
          const dueText = isSameLocalDay(due, n) ? formatLocalTime(due) : formatLocalDateTime(due);
          const result = {
            ok: true as const,
            draft_id: draft.id,
            codigo: draft.code,
            prioridade: PRIORITY_LABEL[decision.priority],
            regra_aplicada: decision.rule,
            prazo: SLA_POLICIES[decision.priority].label,
            resposta_ate: dueText,
            possiveis_duplicados: candidates.map((c) => ({ id: c.t.id, titulo: c.t.title, similaridade: c.score })),
          };
          return {
            result,
            labels: ['classificou a prioridade', 'consultou o SLA', 'montou o rascunho'],
            summary: { draft: draft.code, prioridade: decision.priority, regra: decision.rule, resposta_ate: dueText },
          };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const draftTicketUpdate = createTool({
    id: 'draft_ticket_update',
    description:
      'Monta o RASCUNHO de uma atualização em chamado existente do funcionário: adicionar informação a um chamado aberto, ou REABRIR um resolvido há até 7 dias. Não altera nada até a confirmação.',
    inputSchema: z.object({
      ticketId: z.string().regex(/^(INC|REQ)-\d+$/i),
      comment: z.string().min(5).max(1500).describe('Informação nova, escrita para o analista'),
    }),
    execute: async ({ ticketId, comment }, context) => {
      const turn = turnOf(context);
      const id = ticketId.toUpperCase();
      try {
        return await turn.traced<unknown>('draft_ticket_update', `consultou o ${id}`, { ticketId: id, comment }, async () => {
          const n = now();
          const t = await deps.helpdesk.getTicket(id, turn.employee.email);
          turn.rememberTickets([t]);
          const reopen = t.status === 'resolved';
          if (t.status === 'closed' || (reopen && !canReopen(t, n))) {
            return {
              result: {
                ok: false as const,
                error: 'nao_pode_atualizar',
                message: `${id} foi encerrado há mais de 7 dias e não pode ser reaberto. Se o problema voltou, ofereça abrir um chamado novo citando ${id}.`,
              },
            };
          }
          const due = computeDueDate(t.priority, n);
          const draft = deps.store.createDraft(turn.conversationId, turn.turnNumber, {
            kind: reopen ? 'reopen' : 'update',
            ticketId: t.id,
            type: t.type,
            title: t.title,
            description: t.description,
            category: t.category,
            priority: t.priority,
            priorityRule: 'Mantida a prioridade do chamado',
            dueAt: due.toISOString(),
            slaLabel: SLA_POLICIES[t.priority].label,
            affected: t.affected,
            comment,
          });
          turn.draftIds.add(draft.id);
          return {
            result: { ok: true as const, draft_id: draft.id, codigo: draft.code, operacao: reopen ? 'reabrir' : 'complementar', chamado: compact(t, n) },
            labels: [`consultou o ${id}`, reopen ? 'montou a reabertura' : 'montou a atualização'],
            summary: { draft: draft.code, kind: draft.kind, ticketId: t.id },
          };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const confirmDraft = createTool({
    id: 'confirm_draft',
    description:
      'Executa um rascunho JÁ MOSTRADO ao funcionário numa resposta anterior, quando ele confirmou explicitamente por texto ("pode criar", "sim, confirma"). Nunca use no mesmo turno em que o rascunho foi criado.',
    inputSchema: z.object({ draftId: z.string().describe('draft_id do rascunho exibido') }),
    execute: async ({ draftId }, context) => {
      const turn = turnOf(context);
      try {
        return await turn.traced<unknown>('confirm_draft', 'confirmou o rascunho', { draftId }, async () => {
          const draft = deps.conversations.requireDraft(turn.conversationId, draftId);
          // Trava: confirmação precisa vir DEPOIS de o funcionário ver o rascunho.
          if (turn.draftIds.has(draftId) || draft.createdTurn >= turn.turnNumber) {
            turn.guardrails.push('Confirmação bloqueada: o rascunho acabou de ser criado e o funcionário ainda não o viu.');
            return {
              result: { ok: false as const, error: 'confirmacao_prematura', message: 'Mostre o rascunho e espere o funcionário confirmar.' },
            };
          }
          const { draft: done, ticket } = await deps.conversations.executeDraft(
            { email: turn.employee.email, name: turn.employee.name },
            turn.conversationId,
            draftId,
          );
          turn.confirmedDraftIds.add(done.id);
          turn.rememberTickets([ticket]);
          if (done.kind === 'create' && ticket.priority === 'critical') {
            turn.pendingTransfer = {
              kind: 'critical',
              reason: 'Chamado crítico aberto',
              summary: `${ticket.id} — ${ticket.title}. ${ticket.description}`,
              ticketId: ticket.id,
              confidence: null,
            };
            turn.guardrails.push('Caso crítico: transferência automática para o Suporte N2.');
          }
          const sla = computeSlaStatus(ticket, now());
          return {
            result: {
              ok: true as const,
              chamado: ticket.id,
              operacao: done.kind,
              resposta_ate: sla.dueAt ? formatLocalDateTime(new Date(sla.dueAt)) : null,
            },
            labels: [done.kind === 'create' ? 'criou o chamado' : 'atualizou o chamado'],
            summary: { ticketId: ticket.id, kind: done.kind },
          };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const cancelDraft = createTool({
    id: 'cancel_draft',
    description: 'Descarta um rascunho pendente quando o funcionário desiste.',
    inputSchema: z.object({ draftId: z.string() }),
    execute: async ({ draftId }, context) => {
      const turn = turnOf(context);
      try {
        return await turn.traced<unknown>('cancel_draft', 'descartou o rascunho', { draftId }, async () => {
          const draft = deps.conversations.requireDraft(turn.conversationId, draftId);
          if (draft.status === 'pending') deps.store.saveDraft({ ...draft, status: 'cancelled' });
          return { result: { ok: true as const } };
        });
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const transferToAnalyst = createTool({
    id: 'transfer_to_analyst',
    description:
      'Transfere a conversa para um analista humano. Use quando: o funcionário pedir; o caso for crítico; o chamado estiver vencido e ele aceitar ajuda; ou você não tiver segurança. Depois disso você para de responder.',
    inputSchema: z.object({
      kind: z.enum(['requested', 'critical', 'overdue', 'low_confidence']),
      reason: z.string().min(5).max(200).describe('Motivo curto, ex.: "Chamado vencido há 2 dias; funcionário pediu analista"'),
      summary: z
        .string()
        .min(20)
        .max(1200)
        .describe('Resumo do caso para o analista não precisar perguntar tudo de novo: problema, o que já foi tentado, chamado relacionado, urgência.'),
      ticketId: z.string().regex(/^(INC|REQ)-\d+$/i).nullable().describe('Chamado relacionado, se houver'),
    }),
    execute: async (input, context) => {
      const turn = turnOf(context);
      return turn.traced<unknown>('transfer_to_analyst', 'chamou um analista', input, async () => {
        let ticketId = input.ticketId?.toUpperCase() ?? null;
        if (ticketId && !turn.tickets.has(ticketId)) {
          try {
            turn.rememberTickets([await deps.helpdesk.getTicket(ticketId, turn.employee.email)]);
          } catch {
            turn.guardrails.push(`Chamado ${ticketId} não pertence ao funcionário: removido da transferência.`);
            ticketId = null;
          }
        }
        // Aplicada depois que a resposta é salva, para o histórico ficar na ordem certa.
        turn.pendingTransfer = { kind: input.kind, reason: input.reason, summary: input.summary, ticketId, confidence: null };
        const queue = input.kind === 'critical' || input.kind === 'overdue' ? 'N2' : 'N1';
        return { result: { ok: true as const, fila: `Suporte ${queue}` }, summary: { kind: input.kind, queue, ticketId } };
      });
    },
  });

  return {
    search_help_center: searchHelpCenter,
    list_my_tickets: listMyTickets,
    get_ticket: getTicket,
    draft_new_ticket: draftNewTicket,
    draft_ticket_update: draftTicketUpdate,
    confirm_draft: confirmDraft,
    cancel_draft: cancelDraft,
    transfer_to_analyst: transferToAnalyst,
  };
}
