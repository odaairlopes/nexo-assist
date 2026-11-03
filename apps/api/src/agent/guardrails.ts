import type { AgentAction, DraftView, Intent, Ticket, UiBlock } from '@nexo/shared';
import type { TransferRequest } from '../domain/conversation-service.ts';
import { toSummary, toView } from '../domain/ticket-views.ts';
import type { Decision } from './decision-schema.ts';

export interface FinalizeInput {
  decision: Decision | null;
  error: string | null;
  /** Chamados do funcionário lidos/validados neste turno. */
  tickets: ReadonlyMap<string, Ticket>;
  /** Busca rascunho da conversa (null se não existir ou for de outra conversa). */
  getDraft: (id: string) => DraftView | null;
  pendingDrafts: DraftView[];
  draftsCreatedThisTurn: ReadonlySet<string>;
  confirmedThisTurn: ReadonlySet<string>;
  pendingTransfer: TransferRequest | null;
  minConfidence: number;
  now: Date;
}

export interface FinalizedTurn {
  reply: string;
  ui: UiBlock[];
  intent: Intent;
  action: AgentAction;
  confidence: number;
  understood: string;
  reasoning: string;
  guardrails: string[];
  transfer: TransferRequest | null;
}

const NO_DECISION_INTENTS: readonly Intent[] = ['greeting', 'out_of_scope'];

/**
 * Camada determinística entre o modelo e o funcionário. Função pura (fácil de
 * testar): recebe a decisão do LLM e o que realmente aconteceu no turno, e
 * devolve o que pode ser exibido. Nada que o modelo "diga" vira dado na tela
 * sem passar por aqui.
 */
export function finalizeTurn(input: FinalizeInput): FinalizedTurn {
  const guardrails: string[] = [];
  const { decision } = input;

  if (!decision) {
    return {
      reply: 'Desculpe, tive um problema para processar sua mensagem agora. Pode tentar de novo? Se preferir, chamo um analista.',
      ui: [{ kind: 'options', question: null, options: [{ label: 'Falar com um analista', value: 'Quero falar com um analista' }], numbered: false }],
      intent: 'unclear',
      action: 'offered_options',
      confidence: 0,
      understood: 'Não foi possível interpretar a mensagem (falha do modelo).',
      reasoning: `O modelo não retornou uma decisão válida: ${input.error ?? 'erro desconhecido'}.`,
      guardrails: ['Resposta de contingência: o modelo falhou ou retornou formato inválido.'],
      transfer: null,
    };
  }

  let reply = decision.reply.trim();
  let action = decision.action;
  let confidence = Math.max(0, Math.min(1, decision.confidence));
  let transfer = input.pendingTransfer;
  const ui: UiBlock[] = [];

  // 1) Card de chamado: só se pertencer ao funcionário (lido neste turno).
  if (decision.show_ticket_id) {
    const t = input.tickets.get(decision.show_ticket_id.toUpperCase());
    if (t) ui.push({ kind: 'ticket', ticket: toView(t, input.now) });
    else guardrails.push(`Card de ${decision.show_ticket_id} omitido: chamado não verificado como do funcionário.`);
  }

  // 2) Seletor de chamados, com o mesmo filtro de privacidade.
  if (decision.show_ticket_selector.length > 0) {
    const tickets = decision.show_ticket_selector
      .map((id) => input.tickets.get(id.toUpperCase()))
      .filter((t): t is Ticket => Boolean(t));
    if (tickets.length < decision.show_ticket_selector.length) {
      guardrails.push('Seletor: IDs não verificados foram removidos.');
    }
    if (tickets.length > 1) ui.push({ kind: 'ticket_selector', tickets: tickets.map((t) => toSummary(t, input.now)) });
    else if (tickets.length === 1 && !ui.some((b) => b.kind === 'ticket')) ui.push({ kind: 'ticket', ticket: toView(tickets[0]!, input.now) });
  }

  // 3) Rascunho: precisa existir nesta conversa.
  let shownDraft: DraftView | null = null;
  if (decision.show_draft_id) {
    const d = input.getDraft(decision.show_draft_id);
    if (d) {
      shownDraft = d;
      ui.push({ kind: 'draft', draft: d });
    } else {
      guardrails.push('Rascunho citado pelo modelo não existe nesta conversa; card omitido.');
    }
  }
  // Rascunho criado no turno mas esquecido na resposta: mostra mesmo assim (o funcionário precisa conferir).
  if (!shownDraft && input.draftsCreatedThisTurn.size > 0) {
    const last = [...input.draftsCreatedThisTurn].map((id) => input.getDraft(id)).find((d) => d?.status === 'pending');
    if (last) {
      ui.push({ kind: 'draft', draft: last });
      guardrails.push(`Rascunho ${last.code} anexado automaticamente para confirmação.`);
    }
  }

  // 4) O modelo não pode afirmar que criou/atualizou algo que não foi executado.
  if (action === 'confirmed_draft' && input.confirmedThisTurn.size === 0) {
    guardrails.push('Modelo declarou confirmação sem executar nada: resposta corrigida.');
    const pending = input.pendingDrafts[0];
    if (pending) {
      action = pending.kind === 'create' ? 'drafted_ticket' : 'drafted_update';
      reply = 'Ainda não registrei nada. Confira o rascunho e confirme para eu seguir.';
      if (!ui.some((b) => b.kind === 'draft')) ui.push({ kind: 'draft', draft: pending });
    } else {
      action = 'answered';
    }
    confidence = Math.min(confidence, 0.5);
  }
  if ((action === 'drafted_ticket' || action === 'drafted_update') && !ui.some((b) => b.kind === 'draft')) {
    guardrails.push('Ação "rascunho" sem rascunho válido; confiança reduzida.');
    confidence = Math.min(confidence, 0.4);
  }

  // 5) Confiança baixa: não decide sozinho, chama um analista (Anexo A).
  const lowConfidence = confidence < input.minConfidence && !NO_DECISION_INTENTS.includes(decision.intent);
  if (lowConfidence && !transfer && decision.intent !== 'unclear') {
    transfer = {
      kind: 'low_confidence',
      reason: `Agent sem segurança para decidir (confiança ${Math.round(confidence * 100)}%)`,
      summary: `O funcionário quer: ${decision.understood} Avaliação do agent: ${decision.reasoning}`,
      ticketId: decision.show_ticket_id?.toUpperCase() ?? null,
      confidence,
    };
    action = 'transferred';
    reply = 'Não tenho segurança para resolver isso sozinho, então chamei um analista do Suporte N1. Ele continua com você aqui nesta conversa.';
    guardrails.push(`Confiança ${Math.round(confidence * 100)}% abaixo do mínimo (${Math.round(input.minConfidence * 100)}%): transferido para analista.`);
    ui.length = 0;
  } else if (transfer) {
    action = 'transferred';
    if (transfer.confidence === null) transfer = { ...transfer, confidence };
  }

  // 6) Respostas rápidas (não fazem sentido depois de transferir).
  if (!transfer && (decision.options.length > 0 || decision.question)) {
    const options = decision.options.slice(0, 4).map((o) => ({ label: o, value: o }));
    if (options.length > 0 || decision.question) {
      ui.push({ kind: 'options', question: decision.question, options, numbered: Boolean(decision.question) && options.length > 2 });
    }
  }

  return {
    reply: reply || 'Certo.',
    ui,
    intent: decision.intent,
    action,
    confidence,
    understood: decision.understood,
    reasoning: decision.reasoning,
    guardrails,
    transfer,
  };
}
