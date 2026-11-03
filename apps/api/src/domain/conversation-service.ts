import {
  formatLocalTime,
  MAX_USER_MESSAGES_PER_SESSION,
  PRIORITY_LABEL,
  formatLocalDateTime,
  type AgentTrace,
  type ChatMessage,
  type ConversationView,
  type DraftEdit,
  type DraftView,
  type PersonRef,
  type SessionUser,
  type Ticket,
  type TransferInfo,
  type TransferKind,
  type UiBlock,
} from '@nexo/shared';
import { HelpdeskUnavailableError, type HelpdeskClient } from '../clients/helpdesk-client.ts';
import type { Store } from '../persistence/store.ts';
import type { EventBus } from '../realtime/event-bus.ts';
import { DomainError } from './errors.ts';
import { toView } from './ticket-views.ts';

export const AGENT_AUTHOR: PersonRef = { email: 'assist@nexo.com.br', name: 'Nexo Assist' };

/** Quem processa um turno do agent. Implementado em agent/turn-runner.ts. */
export interface TurnRunner {
  run(conversation: ConversationView, userMessage: ChatMessage): Promise<void>;
}

export interface TransferRequest {
  kind: TransferKind;
  reason: string;
  summary: string;
  ticketId: string | null;
  confidence: number | null;
}

/** Fila por tipo de transferência: o que é grave ou atrasado vai direto ao N2. */
export function queueFor(kind: TransferKind): 'N1' | 'N2' {
  return kind === 'critical' || kind === 'overdue' ? 'N2' : 'N1';
}

/**
 * Regras da conversa (máquina de estados agent → aguardando atendente →
 * analista → agent/encerrada) e operações que mudam chamados.
 *
 * Ponto-chave de arquitetura: criar/atualizar chamado e transferir são feitos
 * AQUI, por código, nunca "pelo texto" do modelo. O agent só pede (via tools)
 * e esta camada valida estado, dono e confirmação.
 */
export class ConversationService {
  private runner: TurnRunner | null = null;
  /** Fila por conversa: turnos do agent nunca rodam em paralelo na mesma conversa. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly helpdesk: HelpdeskClient,
    private readonly log: { error: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void },
  ) {}

  attachRunner(runner: TurnRunner): void {
    this.runner = runner;
  }

  // ---------- Acesso ----------

  /** Garante que a conversa existe e pertence a quem pede (funcionário) — ou que quem pede é analista. */
  requireConversation(user: SessionUser, id: string): ConversationView {
    const conv = this.store.getConversation(id);
    if (!conv) throw new DomainError('not_found', 'Conversa não encontrada');
    if (user.role === 'employee' && conv.employee.email !== user.email) {
      // Mesma resposta de "não existe": não revela que a conversa é de outra pessoa.
      throw new DomainError('not_found', 'Conversa não encontrada');
    }
    return conv;
  }

  currentConversation(user: SessionUser): ConversationView {
    return this.store.findActiveConversation(user.email) ?? this.store.createConversation(user);
  }

  /** Nova sessão: encerra a atual (se estiver com o agent) e abre outra. */
  startNewConversation(user: SessionUser): ConversationView {
    const current = this.store.findActiveConversation(user.email);
    if (current && (current.status === 'waiting_human' || current.status === 'human')) {
      throw new DomainError('invalid_state', 'Sua conversa está com um analista. Aguarde o encerramento para iniciar outra.');
    }
    if (current) {
      this.addSystem(current.id, 'Sessão encerrada pelo funcionário');
      this.publishConversation(this.store.updateConversation(current.id, { status: 'closed' }));
    }
    return this.store.createConversation(user);
  }

  // ---------- Publicação ----------

  publishMessage(message: ChatMessage): void {
    this.bus.publish(message.conversationId, { type: 'message', message });
  }

  publishConversation(conversation: ConversationView): void {
    this.bus.publish(conversation.id, { type: 'conversation', conversation });
  }

  addSystem(conversationId: string, content: string): ChatMessage {
    const msg = this.store.addMessage({ conversationId, role: 'system', author: null, content });
    this.publishMessage(msg);
    return msg;
  }

  addAgentMessage(conversationId: string, content: string, ui: UiBlock[], trace: AgentTrace | null): ChatMessage {
    const msg = this.store.addMessage({ conversationId, role: 'agent', author: AGENT_AUTHOR, content, ui, trace });
    this.publishMessage(msg);
    return msg;
  }

  // ---------- Funcionário ----------

  async postUserMessage(user: SessionUser, conversationId: string, content: string): Promise<ChatMessage> {
    const conv = this.requireConversation(user, conversationId);
    if (conv.status === 'closed') throw new DomainError('conversation_closed', 'Esta conversa foi encerrada. Inicie uma nova.');
    if (conv.userMessageCount >= MAX_USER_MESSAGES_PER_SESSION) {
      throw new DomainError('message_limit_reached', `Limite de ${MAX_USER_MESSAGES_PER_SESSION} mensagens nesta sessão. Inicie uma nova conversa.`);
    }
    const message = this.store.addMessage({ conversationId, role: 'user', author: { email: user.email, name: user.name }, content });
    this.publishMessage(message);
    const updated = this.store.getConversation(conversationId)!;
    this.publishConversation(updated);

    // Com um analista (ou aguardando um), o agent NÃO responde.
    if (updated.status === 'agent') this.enqueueTurn(updated.id, message);
    return message;
  }

  private enqueueTurn(conversationId: string, message: ChatMessage): void {
    const runner = this.runner;
    if (!runner) throw new Error('TurnRunner não configurado');
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        // Reavalia o estado na hora de rodar: pode ter sido transferida enquanto esperava.
        const conv = this.store.getConversation(conversationId);
        if (!conv || conv.status !== 'agent') return;
        await runner.run(conv, message);
      })
      .catch((err: unknown) => this.log.error({ err, conversationId }, 'falha no turno do agent'))
      .finally(() => {
        if (this.locks.get(conversationId) === next) this.locks.delete(conversationId);
      });
    this.locks.set(conversationId, next);
  }

  /** Para testes e para o eval: aguarda os turnos pendentes. */
  async idle(conversationId: string): Promise<void> {
    await this.locks.get(conversationId);
  }

  // ---------- Rascunhos ----------

  requireDraft(conversationId: string, draftId: string): DraftView & { createdTurn: number } {
    const draft = this.store.getDraft(draftId);
    if (!draft || draft.conversationId !== conversationId) throw new DomainError('not_found', 'Rascunho não encontrado');
    return draft;
  }

  /** Atualiza o card do rascunho em todas as mensagens que o exibem. */
  private refreshDraftCards(conversationId: string, draft: DraftView): void {
    for (const msg of this.store.findMessagesWithDraft(conversationId, draft.id)) {
      const ui = msg.ui.map((b) => (b.kind === 'draft' && b.draft.id === draft.id ? { ...b, draft } : b));
      const updated = this.store.updateMessageUi(msg.id, ui);
      if (updated) this.bus.publish(conversationId, { type: 'message_updated', message: updated });
    }
  }

  editDraft(user: SessionUser, conversationId: string, draftId: string, edit: DraftEdit): DraftView {
    this.requireConversation(user, conversationId);
    const draft = this.requireDraft(conversationId, draftId);
    if (draft.status !== 'pending') throw new DomainError('invalid_state', 'Este rascunho não pode mais ser editado');
    const next: DraftView = {
      ...draft,
      title: edit.title ?? draft.title,
      description: edit.description ?? draft.description,
      category: edit.category ?? draft.category,
      comment: edit.comment ?? draft.comment,
      error: null,
    };
    this.store.saveDraft(next);
    this.refreshDraftCards(conversationId, next);
    return next;
  }

  cancelDraft(user: SessionUser, conversationId: string, draftId: string): DraftView {
    this.requireConversation(user, conversationId);
    const draft = this.requireDraft(conversationId, draftId);
    if (draft.status !== 'pending') throw new DomainError('invalid_state', 'Este rascunho já foi finalizado');
    const next: DraftView = { ...draft, status: 'cancelled' };
    this.store.saveDraft(next);
    this.refreshDraftCards(conversationId, next);
    return next;
  }

  /**
   * Executa um rascunho confirmado. É o ÚNICO caminho que cria ou altera
   * chamado — usado pelo botão "Confirmar" e pela tool do agent (que só pode
   * confirmar rascunhos mostrados num turno anterior).
   */
  async executeDraft(
    employee: PersonRef,
    conversationId: string,
    draftId: string,
  ): Promise<{ draft: DraftView; ticket: Ticket }> {
    const draft = this.requireDraft(conversationId, draftId);
    if (draft.status === 'confirmed' && draft.ticketId) {
      // Duplo clique / retry: devolve o resultado já obtido.
      return { draft, ticket: await this.helpdesk.getTicket(draft.ticketId, employee.email) };
    }
    if (draft.status !== 'pending') throw new DomainError('invalid_state', 'Este rascunho foi cancelado');

    try {
      let ticket: Ticket;
      if (draft.kind === 'create') {
        ticket = await this.helpdesk.createTicket(
          employee.email,
          {
            type: draft.type,
            title: draft.title,
            description: draft.description,
            category: draft.category,
            subcategory: null,
            priority: draft.priority,
            affected: draft.affected,
            queue: draft.priority === 'critical' ? 'N2' : 'N1',
          },
          `draft:${draft.id}`,
        );
      } else if (draft.kind === 'reopen') {
        ticket = await this.helpdesk.reopen(draft.ticketId!, employee.email, employee.name, draft.comment ?? '', `draft:${draft.id}`);
      } else {
        ticket = await this.helpdesk.addComment(draft.ticketId!, employee.email, employee.name, draft.comment ?? '', `draft:${draft.id}`);
      }
      const done: DraftView = { ...draft, status: 'confirmed', ticketId: ticket.id, error: null };
      this.store.saveDraft(done);
      this.refreshDraftCards(conversationId, done);
      this.publishConversation(this.store.updateConversation(conversationId, { ticketRef: ticket.id }));
      return { draft: done, ticket };
    } catch (err) {
      if (err instanceof HelpdeskUnavailableError) {
        const failed: DraftView = { ...draft, error: 'O sistema de chamados está instável agora. Tente confirmar de novo em alguns segundos.' };
        this.store.saveDraft(failed);
        this.refreshDraftCards(conversationId, failed);
        throw new DomainError('helpdesk_unavailable', failed.error!);
      }
      throw err;
    }
  }

  /** Confirmação pelo botão do card: executa e o agent comunica o resultado. */
  async confirmDraftByUser(user: SessionUser, conversationId: string, draftId: string): Promise<DraftView> {
    const conv = this.requireConversation(user, conversationId);
    if (conv.status === 'closed') throw new DomainError('conversation_closed', 'Conversa encerrada');
    const started = Date.now();
    const { draft, ticket } = await this.executeDraft(user, conversationId, draftId);

    const view = toView(ticket);
    const dueText = view.sla.dueAt ? `Um analista responde até ${formatLocalDateTime(new Date(view.sla.dueAt))}.` : '';
    const text =
      draft.kind === 'create'
        ? `Pronto: abri o ${ticket.id} com prioridade ${PRIORITY_LABEL[ticket.priority].toLowerCase()}. ${dueText}`.trim()
        : draft.kind === 'reopen'
          ? `Pronto: reabri o ${ticket.id} com a sua informação. ${dueText}`.trim()
          : `Pronto: adicionei a informação ao ${ticket.id}. O analista responsável vai ver no histórico do chamado.`;

    const trace: AgentTrace = {
      understood: 'Funcionário confirmou o rascunho pelo botão "Confirmar".',
      intent: 'confirm',
      action: 'confirmed_draft',
      confidence: 1,
      reasoning: `Confirmação explícita do funcionário no card ${draft.code}. A operação foi executada pelo código (não pelo modelo), com chave de idempotência draft:${draft.id}.`,
      steps: [
        {
          tool: 'executar_rascunho',
          label: draft.kind === 'create' ? 'criou o chamado' : 'atualizou o chamado',
          input: { draft: draft.code, kind: draft.kind },
          output: { ticketId: ticket.id, status: ticket.status },
          ok: true,
          durationMs: Date.now() - started,
        },
      ],
      guardrails: ['Chamado só é criado/atualizado após confirmação explícita (Anexo A).'],
      model: 'nenhum (ação determinística)',
      latencyMs: Date.now() - started,
      usage: null,
      error: null,
    };
    this.addAgentMessage(conversationId, text, [{ kind: 'ticket', ticket: view }], trace);

    if (ticket.priority === 'critical' && draft.kind === 'create') {
      await this.transfer(conversationId, {
        kind: 'critical',
        reason: 'Chamado crítico: algo parado para uma equipe ou para a empresa',
        summary: `${ticket.id} — ${ticket.title}. ${ticket.description}`,
        ticketId: ticket.id,
        confidence: null,
      });
      this.addAgentMessage(
        conversationId,
        'Como é um caso crítico, já chamei um analista do Suporte N2 — ele continua com você por aqui.',
        [],
        null,
      );
    }
    return draft;
  }

  // ---------- Transferência ----------

  async transfer(conversationId: string, req: TransferRequest): Promise<ConversationView> {
    const conv = this.store.getConversation(conversationId);
    if (!conv) throw new DomainError('not_found', 'Conversa não encontrada');
    if (conv.status === 'waiting_human' || conv.status === 'human') return conv;
    const queue = queueFor(req.kind);
    const now = new Date();
    let summary = req.summary;

    if (req.ticketId) {
      try {
        await this.helpdesk.transfer(req.ticketId, conv.employee.email, queue, req.summary, `transfer:${conversationId}:${req.ticketId}`);
      } catch (err) {
        // A transferência da CONVERSA não pode falhar por causa do legado: o analista vê o aviso.
        this.log.warn({ err, ticketId: req.ticketId }, 'falha ao transferir chamado no legado');
        summary += ' (Aviso: não foi possível marcar a transferência no sistema de chamados; o legado estava indisponível.)';
      }
    }

    const transfer: TransferInfo = {
      kind: req.kind,
      reason: req.reason,
      summary,
      queue,
      at: now.toISOString(),
      confidence: req.confidence,
      ticketId: req.ticketId,
    };
    const updated = this.store.updateConversation(conversationId, {
      status: 'waiting_human',
      transfer,
      ticketRef: req.ticketId ?? conv.ticketRef,
    });
    this.addSystem(conversationId, `Transferida para Suporte ${queue} · ${formatLocalTime(now)}`);
    this.publishConversation(updated);
    return updated;
  }

  // ---------- Analista ----------

  takeOver(analyst: SessionUser, conversationId: string): ConversationView {
    const conv = this.requireConversation(analyst, conversationId);
    if (conv.status === 'closed') throw new DomainError('invalid_state', 'Conversa encerrada');
    if (conv.status === 'human' && conv.assignedAnalyst?.email !== analyst.email) {
      throw new DomainError('invalid_state', `${conv.assignedAnalyst?.name} já está atendendo esta conversa`);
    }
    const updated = this.store.updateConversation(conversationId, {
      status: 'human',
      assigned: { email: analyst.email, name: analyst.name },
    });
    if (conv.ticketRef) {
      this.helpdesk
        .assign(conv.ticketRef, conv.employee.email, analyst.name)
        .catch((err: unknown) => this.log.warn({ err }, 'falha ao marcar responsável no legado'));
    }
    this.addSystem(conversationId, `${analyst.name} assumiu · agent pausado · ${formatLocalTime(new Date())}`);
    this.publishConversation(updated);
    return updated;
  }

  returnToAgent(analyst: SessionUser, conversationId: string): ConversationView {
    const conv = this.requireConversation(analyst, conversationId);
    if (conv.status !== 'human' && conv.status !== 'waiting_human') {
      throw new DomainError('invalid_state', 'A conversa já está com o agent');
    }
    const updated = this.store.updateConversation(conversationId, { status: 'agent', assigned: null, transfer: null });
    this.addSystem(conversationId, `${analyst.name} devolveu a conversa ao Nexo Assist · ${formatLocalTime(new Date())}`);
    this.publishConversation(updated);
    return updated;
  }

  closeConversation(analyst: SessionUser, conversationId: string): ConversationView {
    const conv = this.requireConversation(analyst, conversationId);
    if (conv.status === 'closed') return conv;
    const updated = this.store.updateConversation(conversationId, { status: 'closed' });
    this.addSystem(conversationId, `Atendimento encerrado por ${analyst.name} · ${formatLocalTime(new Date())}`);
    this.publishConversation(updated);
    return updated;
  }

  postAnalystMessage(analyst: SessionUser, conversationId: string, content: string): ChatMessage {
    const conv = this.requireConversation(analyst, conversationId);
    if (conv.status !== 'human' || conv.assignedAnalyst?.email !== analyst.email) {
      throw new DomainError('invalid_state', 'Assuma o atendimento para responder');
    }
    const message = this.store.addMessage({
      conversationId,
      role: 'analyst',
      author: { email: analyst.email, name: analyst.name },
      content,
    });
    this.publishMessage(message);
    this.publishConversation(this.store.getConversation(conversationId)!);
    return message;
  }

  /** Chamados do funcionário da conversa, para o painel do analista. */
  async employeeTickets(analyst: SessionUser, conversationId: string) {
    const conv = this.requireConversation(analyst, conversationId);
    const tickets = await this.helpdesk.listTickets(conv.employee.email);
    return tickets.map((t) => toView(t));
  }
}
