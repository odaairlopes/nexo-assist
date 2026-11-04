import { describe, expect, it } from 'vitest';
import { ConversationService } from '../domain/conversation-service.ts';
import { Store } from '../persistence/store.ts';
import { EventBus } from '../realtime/event-bus.ts';
import { inMemoryHelpdesk } from '../test-utils.ts';
import { createNexoMastra, FALLBACK_AGENT, PRIMARY_AGENT } from './index.ts';

const llm = {
  model: 'groq/openai/gpt-oss-120b',
  fallbackModel: 'groq/qwen/qwen3.8-27b',
  baseUrl: null,
  apiKey: null,
  maxSteps: 6,
  turnTimeoutMs: 45_000,
  stallTimeoutMs: 8_000,
  historyWindow: 10,
};

function deps() {
  const { client } = inMemoryHelpdesk();
  const store = new Store(':memory:');
  return { helpdesk: client, store, conversations: new ConversationService(store, new EventBus(), client, console) };
}

describe('instância Mastra', () => {
  it('registra o agent principal e a reserva e os resolve pelo registro', () => {
    const { mastra, agents } = createNexoMastra(llm, deps());
    expect(Object.keys(mastra.listAgents())).toEqual([PRIMARY_AGENT, FALLBACK_AGENT]);
    expect(agents.primary.agent).toBe(mastra.listAgents()[PRIMARY_AGENT]);
    expect(agents.fallback?.model).toBe('groq/qwen/qwen3.8-27b');
  });

  it('sem reserva configurada, registra só o principal', () => {
    const { mastra, agents } = createNexoMastra({ ...llm, fallbackModel: null }, deps());
    expect(Object.keys(mastra.listAgents())).toEqual([PRIMARY_AGENT]);
    expect(agents.fallback).toBeNull();
  });
});
