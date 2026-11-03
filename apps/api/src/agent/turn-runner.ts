import { RequestContext } from '@mastra/core/request-context';
import type { AgentTrace, ChatMessage, ConversationView, Employee } from '@nexo/shared';
import type { HelpdeskClient } from '../clients/helpdesk-client.ts';
import type { AppConfig } from '../config.ts';
import type { ConversationService, TurnRunner } from '../domain/conversation-service.ts';
import type { Store } from '../persistence/store.ts';
import type { EventBus } from '../realtime/event-bus.ts';
import { DecisionSchema, type Decision } from './decision-schema.ts';
import { finalizeTurn } from './guardrails.ts';
import { toModelMessages } from './history.ts';
import { needsJsonPromptInjection, type createNexoAgent } from './nexo-agent.ts';
import { TURN_KEY, TurnContext } from './turn-context.ts';

type NexoAgent = ReturnType<typeof createNexoAgent>;

interface Deps {
  agent: NexoAgent;
  store: Store;
  bus: EventBus;
  conversations: ConversationService;
  helpdesk: HelpdeskClient;
  llm: AppConfig['llm'];
  minConfidence: number;
  log: { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

const PROFILE_TTL_MS = 5 * 60_000;

/**
 * Um turno = uma mensagem do funcionário → (tools…) → decisão estruturada →
 * travas do código → mensagem salva com trace → (transferência, se houver).
 */
export class AgentTurnRunner implements TurnRunner {
  private readonly profiles = new Map<string, { at: number; employee: Employee }>();

  constructor(private readonly deps: Deps) {}

  private async profile(conv: ConversationView): Promise<Employee> {
    const cached = this.profiles.get(conv.employee.email);
    if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.employee;
    try {
      const employee = await this.deps.helpdesk.getEmployee(conv.employee.email);
      this.profiles.set(employee.email, { at: Date.now(), employee });
      return employee;
    } catch {
      // Sem o cadastro (legado fora), segue com o que a sessão já sabe.
      return { ...conv.employee, role: 'employee', supportLevel: null, device: null };
    }
  }

  async run(conv: ConversationView, _userMessage: ChatMessage): Promise<void> {
    const { store, bus, conversations, agent, llm } = this.deps;
    const started = Date.now();
    const employee = await this.profile(conv);
    const turn = new TurnContext(employee, conv.id, conv.userMessageCount, (e) => bus.publish(conv.id, e));
    bus.publish(conv.id, { type: 'agent_thinking', turnId: turn.turnId });

    const requestContext = new RequestContext();
    requestContext.set(TURN_KEY, turn);
    const messages = toModelMessages(store.listMessages(conv.id, llm.historyWindow));

    let decision: Decision | null = null;
    let usage: AgentTrace['usage'] = null;
    let error: string | null = null;

    try {
      const stream = await agent.stream(messages, {
        requestContext,
        maxSteps: llm.maxSteps,
        modelSettings: { temperature: 0.2 },
        structuredOutput: { schema: DecisionSchema, jsonPromptInjection: needsJsonPromptInjection(llm) },
      });

      // Resposta em tempo real: o campo `reply` aparece na tela enquanto é gerado.
      let lastReply = '';
      for await (const partial of stream.objectStream) {
        const reply = (partial as Partial<Decision> | undefined)?.reply;
        if (typeof reply === 'string' && reply.length > lastReply.length) {
          lastReply = reply;
          bus.publish(conv.id, { type: 'agent_delta', turnId: turn.turnId, text: reply });
        }
      }
      const parsed = DecisionSchema.safeParse(await stream.object);
      if (parsed.success) decision = parsed.data;
      else error = `saída fora do schema: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`;
      const u = await stream.usage;
      usage = u ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 } : null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.deps.log.error({ err, conversationId: conv.id }, 'falha ao chamar o modelo');
    }

    const final = finalizeTurn({
      decision,
      error,
      tickets: turn.tickets,
      getDraft: (id) => {
        const d = store.getDraft(id);
        return d && d.conversationId === conv.id ? d : null;
      },
      pendingDrafts: store.listPendingDrafts(conv.id),
      draftsCreatedThisTurn: turn.draftIds,
      confirmedThisTurn: turn.confirmedDraftIds,
      pendingTransfer: turn.pendingTransfer,
      minConfidence: this.deps.minConfidence,
      now: new Date(),
    });

    const trace: AgentTrace = {
      understood: final.understood,
      intent: final.intent,
      action: final.action,
      confidence: final.confidence,
      reasoning: final.reasoning,
      steps: turn.steps,
      guardrails: [...turn.guardrails, ...final.guardrails],
      model: llm.model,
      latencyMs: Date.now() - started,
      usage,
      error,
    };

    conversations.addAgentMessage(conv.id, final.reply, final.ui, trace);
    if (final.transfer) await conversations.transfer(conv.id, final.transfer);
    bus.publish(conv.id, { type: 'agent_idle', turnId: turn.turnId });
    this.deps.log.info(
      { conversationId: conv.id, intent: final.intent, action: final.action, confidence: final.confidence, ms: trace.latencyMs, usage },
      'turno do agent',
    );
  }
}
