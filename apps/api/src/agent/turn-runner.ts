import { RequestContext } from '@mastra/core/request-context';
import type { AgentTrace, ChatMessage, ConversationView, Employee } from '@nexo/shared';
import type { HelpdeskClient } from '../clients/helpdesk-client.ts';
import type { AppConfig } from '../config.ts';
import type { ConversationService, TurnRunner } from '../domain/conversation-service.ts';
import type { Store } from '../persistence/store.ts';
import type { EventBus } from '../realtime/event-bus.ts';
import { DecisionSchema, type Decision } from './decision-schema.ts';
import { finalizeTurn } from './guardrails.ts';
import { toModelMessages, type ModelMessage } from './history.ts';
import { providerOptionsFor, type AgentChain, type NexoAgent } from './nexo-agent.ts';
import { prefetchContext, relevantPrefetchSteps } from './prefetch.ts';
import { RESPOND_TOOL } from './tools.ts';
import { TURN_KEY, TurnContext } from './turn-context.ts';

interface Attempt {
  decision: Decision | null;
  usage: AgentTrace['usage'];
  error: string | null;
}

interface Deps {
  agents: AgentChain;
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
 * Alguns modelos escrevem os argumentos de `respond` como texto em vez de
 * chamar a ferramenta. Se o texto contém um objeto que passa no schema, ele
 * vale como decisão. Exportada para teste.
 */
export function decisionFromText(text: string): Decision | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = DecisionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Lê o valor de "reply" de um JSON ainda incompleto (argumentos da tool
 * chegando aos pedaços). Exportada para teste.
 */
export function partialReply(json: string): string | null {
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json);
  if (!m?.[1]) return null;
  // Remove um escape cortado no fim antes de decodificar.
  const raw = m[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

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

  private async repair(
    agent: NexoAgent,
    messages: ModelMessage[],
    draftText: string,
    requestContext: RequestContext,
  ): Promise<Decision | null> {
    const turn = requestContext.get(TURN_KEY) as TurnContext;
    const done = turn.steps.map((s) => `${s.tool}: ${JSON.stringify(s.output)}`).join('\n') || 'nenhuma ferramenta';
    try {
      await agent.generate(
        [
          ...messages,
          ...(draftText.trim() ? [{ role: 'assistant' as const, content: draftText.trim() }] : []),
          {
            role: 'user' as const,
            content: `[sistema] Você encerrou sem chamar a ferramenta respond. Resultados das ferramentas deste turno:\n${done}\nChame respond agora com a decisão e a mensagem para o funcionário.`,
          },
        ],
        {
          requestContext,
          maxSteps: 1,
          toolChoice: { type: 'tool', toolName: RESPOND_TOOL },
          modelSettings: { temperature: 0, maxRetries: 0 },
          abortSignal: AbortSignal.timeout(15_000),
        },
      );
    } catch (err) {
      this.deps.log.error({ err }, 'falha na chamada de reparo');
    }
    return turn.decision;
  }

  /** Uma tentativa completa com um modelo: stream + recuperações. */
  private async attempt(
    entry: { agent: NexoAgent; model: string },
    messages: ModelMessage[],
    requestContext: RequestContext,
    conv: ConversationView,
  ): Promise<Attempt> {
    const { bus, llm } = this.deps;
    const turn = requestContext.get(TURN_KEY) as TurnContext;
    let usage: AgentTrace['usage'] = null;
    let error: string | null = null;
    try {
      const providerOptions = providerOptionsFor(entry.model);
      // Aborta no primeiro erro do provedor (ex.: 429): o loop do Mastra trataria o
      // erro como um passo e tentaria de novo após ~30 s — melhor ir para a reserva.
      const failFast = new AbortController();
      const stream = await entry.agent.stream(messages, {
        requestContext,
        maxSteps: llm.maxSteps,
        modelSettings: { temperature: 0.2, maxOutputTokens: 1500, maxRetries: 0 },
        ...(providerOptions ? { providerOptions } : {}),
        // O turno acaba quando a tool `respond` é chamada. "auto" (e não "required"):
        // com "required", alguns provedores rejeitam a resposta inteira quando o
        // modelo escreve o JSON como texto — melhor recuperar abaixo.
        toolChoice: 'auto',
        stopWhen: () => turn.decision !== null,
        // Nunca deixa o funcionário esperando indefinidamente por um provedor lento.
        abortSignal: AbortSignal.any([AbortSignal.timeout(llm.turnTimeoutMs), failFast.signal]),
      });

      // Watchdog: um provedor saudável manda dados sem parar. Silêncio prolongado
      // (cota esgotada com espera interna de retry, provedor travado) = desiste e a
      // reserva assume, em vez de deixar o funcionário esperando.
      let lastActivity = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > llm.stallTimeoutMs) {
          error = `sem resposta do provedor por ${llm.stallTimeoutMs / 1000}s`;
          failFast.abort();
        }
      }, 500);

      // Resposta em tempo real: extrai o campo `reply` dos argumentos parciais de `respond`.
      const respondCalls = new Set<string>();
      let args = '';
      let lastReply = '';
      let fallbackText = '';
      try {
      for await (const chunk of stream.fullStream) {
        lastActivity = Date.now();
        if (failFast.signal.aborted) break;
        if (chunk.type === 'tool-call-input-streaming-start' && chunk.payload.toolName === RESPOND_TOOL) {
          respondCalls.add(chunk.payload.toolCallId);
          args = '';
        } else if (chunk.type === 'tool-call-delta' && respondCalls.has(chunk.payload.toolCallId)) {
          args += chunk.payload.argsTextDelta;
          const reply = partialReply(args);
          if (reply && reply.length > lastReply.length) {
            lastReply = reply;
            bus.publish(conv.id, { type: 'agent_delta', turnId: turn.turnId, text: reply });
          }
        } else if (chunk.type === 'text-delta') {
          fallbackText += chunk.payload.text;
        } else if (chunk.type === 'error') {
          error = chunk.payload.error instanceof Error ? chunk.payload.error.message : String(chunk.payload.error);
          if (!turn.decision) {
            failFast.abort();
            break;
          }
        }
      }
      } finally {
        clearInterval(watchdog);
      }
      if (!failFast.signal.aborted) {
        const u = await stream.usage;
        usage = u ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 } : null;
      }

      if (turn.decision) return { decision: turn.decision, usage, error: null };
      const salvaged = decisionFromText(fallbackText);
      if (salvaged) {
        turn.guardrails.push('Decisão veio como JSON no texto (sem chamar a ferramenta); validada pelo schema e aproveitada.');
        return { decision: salvaged, usage, error: null };
      }
      // Reparo só faz sentido se o provedor respondeu (não em erro de rede/cota).
      if (!error) {
        const repaired = await this.repair(entry.agent, messages, fallbackText, requestContext);
        if (repaired) {
          turn.guardrails.push('O modelo não registrou a decisão; uma chamada de reparo forçou a ferramenta respond.');
          return { decision: repaired, usage, error: null };
        }
      }
      if (fallbackText.trim()) {
        // O modelo respondeu em texto sem registrar a decisão: aproveita o texto, com confiança neutra.
        turn.guardrails.push('O modelo respondeu sem registrar a decisão; intenção e confiança não foram declaradas.');
        const decision = DecisionSchema.parse({
          understood: '(não declarado pelo modelo)',
          intent: 'unclear',
          action: 'answered',
          confidence: 0.5,
          reasoning: 'O modelo encerrou o turno com texto livre, sem chamar a ferramenta de decisão.',
          reply: fallbackText.trim(),
        });
        return { decision, usage, error: null };
      }
      return { decision: null, usage, error: error ?? 'o modelo encerrou o turno sem registrar a decisão' };
    } catch (err) {
      this.deps.log.error({ err, conversationId: conv.id, model: entry.model }, 'falha ao chamar o modelo');
      return { decision: null, usage, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async run(conv: ConversationView, userMessage: ChatMessage): Promise<void> {
    const { store, bus, conversations, agents, llm } = this.deps;
    const started = Date.now();
    const employee = await this.profile(conv);
    const turn = new TurnContext(employee, conv.id, conv.userMessageCount, (e) => bus.publish(conv.id, e));
    bus.publish(conv.id, { type: 'agent_thinking', turnId: turn.turnId });
    await prefetchContext(turn, this.deps.helpdesk, userMessage.content);

    const requestContext = new RequestContext();
    requestContext.set(TURN_KEY, turn);
    const messages = toModelMessages(store.listMessages(conv.id, llm.historyWindow));

    let modelUsed = agents.primary.model;
    let { decision, usage, error } = await this.attempt(agents.primary, messages, requestContext, conv);
    // Reserva: só se o principal falhou ANTES de qualquer ferramenta (sem efeitos a repetir).
    if (!decision && agents.fallback && turn.steps.length === 0) {
      turn.guardrails.push(`${agents.primary.model} falhou (${(error ?? '').slice(0, 120)}); resposta gerada pela reserva ${agents.fallback.model}.`);
      modelUsed = agents.fallback.model;
      ({ decision, usage, error } = await this.attempt(agents.fallback, messages, requestContext, conv));
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
      steps: [...relevantPrefetchSteps(turn, final.intent, final.ui), ...turn.steps],
      guardrails: [...turn.guardrails, ...final.guardrails],
      model: modelUsed,
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
