import { Agent } from '@mastra/core/agent';
import type { AppConfig } from '../config.ts';
import type { Store } from '../persistence/store.ts';
import { buildInstructions } from './instructions.ts';
import { buildTools, type ToolDeps } from './tools.ts';
import { TURN_KEY, type TurnContext } from './turn-context.ts';

type ModelId = `${string}/${string}`;
export type SingleModel = string | { id: ModelId; url: string; apiKey?: string };

function single(model: string, llm: AppConfig['llm']): SingleModel {
  if (llm.baseUrl) {
    const id = (model.includes('/') ? model : `custom/${model}`) as ModelId;
    return { id, url: llm.baseUrl, ...(llm.apiKey ? { apiKey: llm.apiKey } : {}) };
  }
  return model;
}

/** Desliga o "thinking" do Gemini 2.5: o agent não precisa e ele custa cota e latência. */
function providerOptionsFor(model: string) {
  return model.startsWith('google/gemini-2.5') ? { google: { thinkingConfig: { thinkingBudget: 0 } } } : undefined;
}

/**
 * Modelo principal + reserva opcional. Com a reserva, o Mastra troca de
 * provedor sozinho em erro 5xx, rate limit (429) ou timeout — importante com
 * cotas gratuitas, que são baixas e instáveis.
 */
export function resolveModel(llm: AppConfig['llm']) {
  const chain = [llm.model, ...(llm.fallbackModel ? [llm.fallbackModel] : [])];
  return chain.map((m, i) => {
    const providerOptions = providerOptionsFor(m);
    return {
      model: single(m, llm),
      maxRetries: i === 0 ? 1 : 2,
      ...(providerOptions ? { providerOptions } : {}),
    };
  });
}

/**
 * Gemini não aceita response_format JSON junto com tools, e endpoints locais
 * costumam não suportar: nesses casos o schema vai no prompt. Como a reserva
 * pode assumir no meio da conversa, vale para a cadeia inteira.
 */
export function needsJsonPromptInjection(llm: AppConfig['llm']): boolean {
  const models = [llm.model, llm.fallbackModel ?? ''];
  return Boolean(llm.baseUrl) || models.some((m) => m.startsWith('google/'));
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
