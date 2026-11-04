import type { ChatMessage, UiBlock } from '@nexo/shared';

export type ModelMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string };

function describeBlock(b: UiBlock): string {
  switch (b.kind) {
    case 'ticket':
      return `card do chamado ${b.ticket.id} (${b.ticket.status}${b.ticket.sla.overdue ? ', vencido' : ''})`;
    case 'ticket_selector':
      return `seletor com ${b.tickets.map((t) => `${t.id} "${t.title}"`).join(', ')}`;
    case 'draft':
      return `rascunho ${b.draft.code} (draft_id=${b.draft.id}, ${b.draft.status})${b.draft.ticketId ? ` → ${b.draft.ticketId}` : ''}`;
    case 'options':
      return `opções: ${b.options.map((o) => o.label).join(' | ')}`;
  }
}

/**
 * O que o funcionário está vendo agora (cards da última resposta do agent) e
 * eventos recentes. Vai para o prompt de sistema, NÃO para o histórico: se
 * as respostas anteriores do assistente tivessem anotações, o modelo passaria
 * a imitá-las no texto (aconteceu nos testes).
 */
export function describeScreen(history: ChatMessage[]): string | null {
  const parts: string[] = [];
  const lastAgent = [...history].reverse().find((m) => m.role === 'agent');
  if (lastAgent?.ui.length) parts.push(`Na tela: ${lastAgent.ui.map(describeBlock).join('; ')}.`);
  const events = history.filter((m) => m.role === 'system').slice(-3);
  if (events.length) parts.push(`Eventos recentes: ${events.map((m) => m.content).join('; ')}.`);
  return parts.length ? parts.join('\n') : null;
}

/**
 * Converte o histórico persistido em mensagens para o modelo, só com a janela
 * recente e só com falas reais. Custo por conversa fica limitado mesmo em
 * sessões longas; o que importa de turnos antigos (rascunhos pendentes, tela
 * atual) volta pelo prompt de sistema.
 */
export function toModelMessages(history: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'agent') out.push({ role: 'assistant', content: m.content });
    else if (m.role === 'analyst') out.push({ role: 'assistant', content: `(${m.author?.name ?? 'Analista'}, do service desk): ${m.content}` });
  }
  // Garante que a janela comece numa fala do funcionário.
  while (out.length > 1 && out[0]?.role !== 'user') out.shift();
  return out;
}
