import type { ChatMessage, UiBlock } from '@nexo/shared';

export type ModelMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string };

/** Descreve em texto curto os cards que o funcionário viu (o modelo não "vê" a UI). */
function describeUi(ui: UiBlock[]): string {
  const parts = ui.map((b) => {
    switch (b.kind) {
      case 'ticket':
        return `card do chamado ${b.ticket.id} (${b.ticket.status}${b.ticket.sla.overdue ? ', vencido' : ''})`;
      case 'ticket_selector':
        return `seletor com ${b.tickets.map((t) => `${t.id} "${t.title}"`).join(', ')}`;
      case 'draft':
        return `rascunho ${b.draft.code} draft_id=${b.draft.id} [${b.draft.status}]${b.draft.ticketId ? ` → ${b.draft.ticketId}` : ''}`;
      case 'options':
        return `opções: ${b.options.map((o) => o.label).join(' | ')}`;
    }
  });
  return parts.length ? `\n[exibido: ${parts.join('; ')}]` : '';
}

/**
 * Converte o histórico persistido em mensagens para o modelo, só com a janela
 * recente. Custo por conversa fica limitado mesmo em sessões longas; o que
 * importa de turnos antigos (rascunhos pendentes) volta pelo prompt de sistema.
 */
export function toModelMessages(history: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'agent') out.push({ role: 'assistant', content: m.content + describeUi(m.ui) });
    else if (m.role === 'analyst') out.push({ role: 'assistant', content: `[Analista ${m.author?.name ?? ''}]: ${m.content}` });
    else out.push({ role: 'assistant', content: `[Evento do sistema: ${m.content}]` });
  }
  // Garante que a janela comece numa fala do funcionário.
  while (out.length > 1 && out[0]?.role !== 'user') out.shift();
  return out;
}
