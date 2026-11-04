import type { Intent, TraceStep, UiBlock } from '@nexo/shared';
import type { HelpdeskClient } from '../clients/helpdesk-client.ts';
import { compact } from './tools.ts';
import type { TurnContext } from './turn-context.ts';

/**
 * Antes de chamar o modelo, o código já busca (por HTTP, sem LLM) os chamados
 * do funcionário e os artigos relevantes para a mensagem, e coloca um resumo
 * compacto no prompt. Na maioria dos turnos o modelo decide em UMA chamada,
 * em vez de gastar uma ida e volta só para "consultar" — menos latência,
 * menos tokens e menos risco de estourar a cota.
 *
 * Se o legado estiver fora, o prompt diz "indisponível" e o modelo ainda pode
 * usar as tools (que têm retry).
 */
export async function prefetchContext(turn: TurnContext, helpdesk: HelpdeskClient, userText: string, now = new Date()): Promise<void> {
  const [tickets, kb] = await Promise.allSettled([helpdesk.listTickets(turn.employee.email), helpdesk.searchKb(userText)]);

  if (tickets.status === 'fulfilled') {
    const started = Date.now();
    turn.rememberTickets(tickets.value);
    const lines = tickets.value.map((t) => {
      const c = compact(t, now);
      const flags = [c.vencido ? 'VENCIDO' : null, c.pode_reabrir ? 'pode reabrir' : null].filter(Boolean).join(', ');
      const desc = t.description.length > 110 ? `${t.description.slice(0, 110)}…` : t.description;
      return `- ${c.id} | ${c.titulo} | ${c.categoria} | ${c.prioridade} | ${c.status} | aberto ${c.aberto_em} | atualizado ${c.ultima_atualizacao}${flags ? ` | ${flags}` : ''} | ${desc}`;
    });
    turn.prefetched.ticketsText = lines.length ? lines.join('\n') : '(nenhum chamado)';
    turn.prefetched.steps.push({
      kind: 'tickets',
      step: {
        tool: 'list_my_tickets',
        label: 'consultou seus chamados',
        input: { pre_carregado: true },
        output: { total: tickets.value.length, ids: tickets.value.map((t) => t.id) },
        ok: true,
        durationMs: Date.now() - started,
      },
    });
  }

  if (kb.status === 'fulfilled' && kb.value.length > 0) {
    turn.prefetched.kbText = kb.value.map((r) => `- ${r.article.id} (relevância ${r.score}) ${r.article.title}: ${r.article.body}`).join('\n');
    turn.prefetched.steps.push({
      kind: 'kb',
      step: {
        tool: 'search_help_center',
        label: 'buscou na central de ajuda',
        input: { query: userText, pre_carregado: true },
        output: { artigos: kb.value.map((r) => `${r.article.id} (${r.score})`) },
        ok: true,
        durationMs: 0,
      },
    });
  }
}

const TICKET_INTENTS: readonly Intent[] = ['ticket_status', 'ticket_update', 'new_ticket', 'talk_to_human', 'confirm', 'cancel'];
const KB_INTENTS: readonly Intent[] = ['question', 'new_ticket'];

/**
 * Só mostra no trace ("consultou seus chamados") o que foi relevante para a
 * decisão — pré-carregar não pode poluir toda resposta com ações.
 */
export function relevantPrefetchSteps(turn: TurnContext, intent: Intent, ui: UiBlock[]): TraceStep[] {
  const calledTools = new Set(turn.steps.map((s) => s.tool));
  const showsTickets = ui.some((b) => b.kind === 'ticket' || b.kind === 'ticket_selector' || b.kind === 'draft');
  return turn.prefetched.steps
    .filter(({ kind, step }) => !calledTools.has(step.tool) && (kind === 'tickets' ? TICKET_INTENTS.includes(intent) || showsTickets : KB_INTENTS.includes(intent)))
    .map(({ step }) => step);
}
