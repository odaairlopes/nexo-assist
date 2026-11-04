import type { ConversationView, SessionUser } from '@nexo/shared';

export type Filter = 'all' | 'needs_you' | 'agent' | 'mine';

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
