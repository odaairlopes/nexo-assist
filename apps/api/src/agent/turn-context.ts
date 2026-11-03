import { randomUUID } from 'node:crypto';
import type { Employee, ServerEvent, Ticket, TraceStep } from '@nexo/shared';
import type { TransferRequest } from '../domain/conversation-service.ts';

/**
 * Estado de UM turno do agent. Vive no RequestContext do Mastra, então as
 * tools recebem a identidade do funcionário do servidor — nunca de um
 * argumento que o modelo possa inventar. É isso que impede o agent de
 * consultar chamados de outra pessoa, mesmo sob prompt injection.
 */
export class TurnContext {
  readonly turnId = randomUUID();
  readonly steps: TraceStep[] = [];
  readonly guardrails: string[] = [];
  /** Chamados lidos neste turno (já filtrados pelo dono) — os únicos que a UI pode exibir. */
  readonly tickets = new Map<string, Ticket>();
  /** Rascunhos criados neste turno. */
  readonly draftIds = new Set<string>();
  pendingTransfer: TransferRequest | null = null;
  confirmedDraftIds = new Set<string>();

  constructor(
    readonly employee: Employee,
    readonly conversationId: string,
    /** Número do turno = quantidade de mensagens do funcionário até agora. */
    readonly turnNumber: number,
    private readonly emit: (event: ServerEvent) => void,
  ) {}

  rememberTickets(tickets: Ticket[]): void {
    for (const t of tickets) this.tickets.set(t.id, t);
  }

  /** Executa uma tool registrando o passo no trace e avisando a UI em tempo real. */
  async traced<T>(
    tool: string,
    runningLabel: string,
    input: unknown,
    fn: () => Promise<{ result: T; labels?: string[]; summary?: unknown }>,
  ): Promise<T> {
    const stepId = randomUUID();
    const started = Date.now();
    this.emit({ type: 'agent_action', turnId: this.turnId, stepId, label: runningLabel, state: 'running' });
    try {
      const { result, labels, summary } = await fn();
      const finalLabels = labels && labels.length > 0 ? labels : [runningLabel];
      this.steps.push({
        tool,
        label: finalLabels.join(' · '),
        input,
        output: summary ?? result,
        ok: true,
        durationMs: Date.now() - started,
      });
      finalLabels.forEach((label, i) =>
        this.emit({ type: 'agent_action', turnId: this.turnId, stepId: i === 0 ? stepId : `${stepId}:${i}`, label, state: 'done' }),
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push({ tool, label: runningLabel, input, output: { error: message }, ok: false, durationMs: Date.now() - started });
      this.emit({ type: 'agent_action', turnId: this.turnId, stepId, label: runningLabel, state: 'error' });
      throw err;
    }
  }
}

export const TURN_KEY = 'turn';
export type AgentRequestContext = { [TURN_KEY]: TurnContext };
