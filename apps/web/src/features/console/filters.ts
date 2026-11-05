import type { ConversationView, SessionUser } from '@nexo/shared';

export type Filter = 'all' | 'needs_you' | 'agent' | 'mine';

/** Rótulo e explicação de cada filtro (a explicação aparece embaixo das abas). */
export const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'all', label: 'Todas', hint: 'Todas as conversas abertas e a última de cada pessoa.' },
  { id: 'needs_you', label: 'Para você', hint: 'Transferidas pelo agent, esperando um analista assumir.' },
  { id: 'agent', label: 'Com o agent', hint: 'O agent está atendendo. Você pode assumir a qualquer momento.' },
  { id: 'mine', label: 'Minhas', hint: 'Conversas que você assumiu e ainda não encerrou.' },
];

/**
 * Mantém conversas abertas e, de cada pessoa, a mais recente. Sessões
 * encerradas antigas da mesma pessoa saem da lista (continuam no banco).
 */
export function latestPerEmployee(conversations: ConversationView[]): ConversationView[] {
  const newest = new Map<string, string>();
  for (const c of conversations) {
    const seen = newest.get(c.employee.email);
    if (!seen || c.updatedAt > seen) newest.set(c.employee.email, c.updatedAt);
  }
  return conversations.filter((c) => c.status !== 'closed' || newest.get(c.employee.email) === c.updatedAt);
}

export function matchesFilter(c: ConversationView, filter: Filter, me: SessionUser): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_you':
      return c.status === 'waiting_human';
    case 'agent':
      return c.status === 'agent';
    case 'mine':
      return c.status === 'human' && c.assignedAnalyst?.email === me.email;
  }
}

/** Última atividade da conversa: mensagem nova ou mudança de estado (assumir, transferir…). */
export function lastActivity(c: ConversationView): string {
  const msg = c.lastMessage?.at ?? '';
  return msg > c.updatedAt ? msg : c.updatedAt;
}

/** Como num app de mensagens: quem falou por último fica no topo. */
export function byRecentActivity(a: ConversationView, b: ConversationView): number {
  return lastActivity(b).localeCompare(lastActivity(a));
}

/** Busca por nome, área, e-mail, chamado ou texto da última mensagem (sem diferenciar acentos). */
export function matchesQuery(c: ConversationView, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return [c.employee.name, c.employee.department, c.employee.email, c.ticketRef ?? '', c.transfer?.ticketId ?? '', c.lastMessage?.content ?? '']
    .some((field) => normalize(field).includes(q));
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
