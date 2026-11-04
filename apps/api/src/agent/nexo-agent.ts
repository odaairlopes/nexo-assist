import { Agent } from '@mastra/core/agent';
import type { AppConfig } from '../config.ts';
import type { Store } from '../persistence/store.ts';
import { buildInstructions } from './instructions.ts';
import { buildTools, type ToolDeps } from './tools.ts';
import { TURN_KEY, type TurnContext } from './turn-context.ts';

type ModelId = `${string}/${string}`;
type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

function modelConfig(model: string, llm: AppConfig['llm']): string | { id: ModelId; url: string; apiKey?: string } {
  if (llm.baseUrl) {
    const id = (model.includes('/') ? model : `custom/${model}`) as ModelId;
    return { id, url: llm.baseUrl, ...(llm.apiKey ? { apiKey: llm.apiKey } : {}) };
  }
  return model;
}

/**
 * Raciocínio no mínimo: as regras pesadas são código, então o modelo não
 * precisa "pensar" muito — isso economiza cota e latência.
 */
export function providerOptionsFor(model: string): Record<string, Record<string, JsonValue>> | undefined {
  if (model.startsWith('google/gemini-2.5')) return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  if (model.startsWith('groq/openai/gpt-oss')) return { groq: { reasoningEffort: 'low' } };
  return undefined;
}

/**
 * Um agent por modelo. A reserva (quando configurada) é um segundo agent que
 * o AgentTurnRunner aciona se o principal falhar antes de executar qualquer
 * ferramenta. Decisão: não usamos a lista de fallbacks nativa do Mastra
 * porque, na versão usada, ela adicionava ~40 s de espera em toda chamada.
 */
export function createNexoAgent(llm: AppConfig['llm'], deps: ToolDeps & { store: Store }, model: string = llm.model) {
  return new Agent({
    id: `nexo-assist-${model.replace(/[^a-z0-9]+/gi, '-')}`,
    name: 'Nexo Assist',
    description: 'Agent de atendimento do service desk de TI da Nexo',
    instructions: ({ requestContext }) => {
      const turn = requestContext.get(TURN_KEY) as TurnContext;
      return buildInstructions(
        turn.employee,
        deps.now?.() ?? new Date(),
        deps.store.listPendingDrafts(turn.conversationId),
        turn.prefetched,
      );
    },
    model: modelConfig(model, llm),
    // Sem novas tentativas no mesmo provedor: em 429/erro, a reserva assume na hora
    // (com cota esgotada, repetir só faria o funcionário esperar).
    maxRetries: 0,
    tools: buildTools(deps),
  });
}

export type NexoAgent = ReturnType<typeof createNexoAgent>;

export interface AgentChain {
  primary: { agent: NexoAgent; model: string };
  fallback: { agent: NexoAgent; model: string } | null;
}

export function createAgentChain(llm: AppConfig['llm'], deps: ToolDeps & { store: Store }): AgentChain {
  return {
    primary: { agent: createNexoAgent(llm, deps, llm.model), model: llm.model },
    fallback: llm.fallbackModel ? { agent: createNexoAgent(llm, deps, llm.fallbackModel), model: llm.fallbackModel } : null,
  };
}
