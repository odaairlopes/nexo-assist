import { Agent } from '@mastra/core/agent';
import type { AppConfig } from '../config.ts';
import type { Store } from '../persistence/store.ts';
import { buildInstructions } from './instructions.ts';
import { buildTools, type ToolDeps } from './tools.ts';
import { TURN_KEY, type TurnContext } from './turn-context.ts';

export type ModelConfig = string | { id: `${string}/${string}`; url: string; apiKey?: string };

export function resolveModel(llm: AppConfig['llm']): ModelConfig {
  if (llm.baseUrl) {
    const id = (llm.model.includes('/') ? llm.model : `custom/${llm.model}`) as `${string}/${string}`;
    return { id, url: llm.baseUrl, ...(llm.apiKey ? { apiKey: llm.apiKey } : {}) };
  }
  return llm.model;
}

/**
 * Modelos que não aceitam response_format JSON junto com tools (Gemini 2.5,
 * e a maioria dos endpoints locais) recebem o schema no prompt.
 */
export function needsJsonPromptInjection(llm: AppConfig['llm']): boolean {
  return Boolean(llm.baseUrl) || llm.model.startsWith('google/');
}

export function createNexoAgent(llm: AppConfig['llm'], deps: ToolDeps & { store: Store }) {
  return new Agent({
    id: 'nexo-assist',
    name: 'Nexo Assist',
    description: 'Agent de atendimento do service desk de TI da Nexo',
    instructions: ({ requestContext }) => {
      const turn = requestContext.get(TURN_KEY) as TurnContext;
      return buildInstructions(turn.employee, deps.now?.() ?? new Date(), deps.store.listPendingDrafts(turn.conversationId));
    },
    model: resolveModel(llm),
    tools: buildTools(deps),
  });
}
