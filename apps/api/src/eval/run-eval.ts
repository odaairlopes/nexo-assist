/**
 * Avaliação do agent com o modelo de verdade: `npm run eval`.
 *
 * Cada cenário roda numa conversa nova, contra o helpdesk simulado em memória
 * (dados do seed, sem falhas aleatórias), e verifica a DECISÃO — ferramentas
 * usadas, cards exibidos, estado da conversa — não o texto exato.
 * Filtre com: npm run eval -- duplicidade privacidade
 */
import type { SessionUser } from '@nexo/shared';
import { createAgentChain } from '../agent/nexo-agent.ts';
import { AgentTurnRunner } from '../agent/turn-runner.ts';
import { config } from '../config.ts';
import { ConversationService } from '../domain/conversation-service.ts';
import { Store } from '../persistence/store.ts';
import { EventBus } from '../realtime/event-bus.ts';
import { inMemoryHelpdesk } from '../test-utils.ts';
import { SCENARIOS, type TurnResult } from './scenarios.ts';

const quiet = { error: (o: unknown) => console.error('  [erro]', (o as { err?: Error })?.err?.message ?? o), warn: () => {}, info: () => {} };
const filter = process.argv.slice(2);
const scenarios = filter.length ? SCENARIOS.filter((s) => filter.includes(s.id)) : SCENARIOS;

let passed = 0;
let total = 0;
let tokens = 0;
const rows: string[] = [];

console.log(`\nNexo Assist · eval com ${config.llm.model} · ${scenarios.length} cenários\n`);

// Pausa entre cenários: o plano gratuito do Groq limita tokens por minuto (8k).
const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? 20_000);

for (const [i, sc] of scenarios.entries()) {
  if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  const store = new Store(':memory:');
  const bus = new EventBus();
  const { client } = inMemoryHelpdesk();
  const conversations = new ConversationService(store, bus, client, quiet);
  const agents = createAgentChain(config.llm, { helpdesk: client, store, conversations });
  conversations.attachRunner(
    new AgentTurnRunner({ agents, store, bus, conversations, helpdesk: client, llm: config.llm, minConfidence: config.agent.minConfidence, log: quiet }),
  );

  const e = await client.getEmployee(sc.employee);
  const user: SessionUser = { email: e.email, name: e.name, department: e.department, role: e.role, supportLevel: e.supportLevel };
  const conv = conversations.currentConversation(user);
  const started = Date.now();

  for (const text of sc.messages) {
    if (store.getConversation(conv.id)?.status !== 'agent') break;
    await conversations.postUserMessage(user, conv.id, text);
    await conversations.idle(conv.id);
  }

  const messages = store.listMessages(conv.id);
  const last = [...messages].reverse().find((m) => m.role === 'agent');
  if (!last) {
    rows.push(`✗ ${sc.id} — sem resposta do agent`);
    total += sc.checks.length;
    continue;
  }
  const result: TurnResult = {
    last,
    conversation: store.getConversation(conv.id)!,
    tools: messages.flatMap((m) => m.trace?.steps.map((s) => s.tool) ?? []),
  };
  tokens += messages.reduce((n, m) => n + (m.trace?.usage ? m.trace.usage.inputTokens + m.trace.usage.outputTokens : 0), 0);

  const outcomes = sc.checks.map((c) => ({ name: c.name, ok: c.ok(result) }));
  const ok = outcomes.filter((o) => o.ok).length;
  passed += ok;
  total += outcomes.length;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok === outcomes.length ? '✓' : '✗'} ${sc.id}  (${ok}/${outcomes.length}, ${secs}s) — ${sc.covers}`);
  for (const o of outcomes) if (!o.ok) console.log(`    ✗ ${o.name}`);
  console.log(`    agent: ${last.content.slice(0, 160)}`);
  console.log(`    decisão: ${last.trace?.intent} → ${last.trace?.action} · confiança ${Math.round((last.trace?.confidence ?? 0) * 100)}% · tools: ${result.tools.join(', ') || '—'}`);
  if (last.trace?.error) console.log(`    erro: ${last.trace.error.slice(0, 200)}`);
  store.close();
}

console.log(`\nResultado: ${passed}/${total} checagens (${Math.round((passed / Math.max(1, total)) * 100)}%) · ~${tokens} tokens no total\n`);
process.exit(passed === total ? 0 : 1);
