import { Mastra } from '@mastra/core/mastra';
import { createAgentChain, type AgentChain, type NexoAgent } from '../agent/nexo-agent.ts';
import type { ToolDeps } from '../agent/tools.ts';
import type { AppConfig } from '../config.ts';
import type { Store } from '../persistence/store.ts';

export const PRIMARY_AGENT = 'nexoAssist';
export const FALLBACK_AGENT = 'nexoAssistReserva';

/**
 * Instância central do Mastra (estrutura convencional `src/mastra/index.ts`).
 *
 * Os agents ficam registrados aqui — principal e reserva — e passam a
 * compartilhar os serviços do Mastra (logger, observabilidade). O
 * AgentTurnRunner busca os agents por nome via `mastra.getAgent`.
 *
 * As dependências (cliente do legado, store, serviço de conversas) são
 * injetadas pelo composition root (app.ts), em vez de importadas como
 * singletons: assim os testes e o eval montam o Mastra com o helpdesk em
 * memória.
 */
export function createNexoMastra(llm: AppConfig['llm'], deps: ToolDeps & { store: Store }) {
  const chain = createAgentChain(llm, deps);
  const mastra = new Mastra({
    agents: {
      [PRIMARY_AGENT]: chain.primary.agent,
      ...(chain.fallback ? { [FALLBACK_AGENT]: chain.fallback.agent } : {}),
    },
  });

  /** Cadeia de agents resolvida a partir do registro do Mastra. */
  const agents: AgentChain = {
    primary: { agent: registered(mastra, PRIMARY_AGENT), model: chain.primary.model },
    fallback: chain.fallback ? { agent: registered(mastra, FALLBACK_AGENT), model: chain.fallback.model } : null,
  };
  return { mastra, agents };
}

/** Busca um agent registrado por nome, falhando cedo se ele não existir. */
function registered(mastra: Mastra, name: string): NexoAgent {
  const found = (mastra.listAgents() as Record<string, NexoAgent | undefined>)[name];
  if (!found) throw new Error(`Agent "${name}" não registrado no Mastra`);
  return found;
}
