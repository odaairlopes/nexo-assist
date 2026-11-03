import { canReopen, computeSlaStatus, type Ticket, type TicketSummary, type TicketView } from '@nexo/shared';

export function toSummary(t: Ticket, now: Date = new Date()): TicketSummary {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    category: t.category,
    subcategory: t.subcategory,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    sla: computeSlaStatus(t, now),
    canReopen: canReopen(t, now),
  };
}

export function toView(t: Ticket, now: Date = new Date()): TicketView {
  const last = t.events[t.events.length - 1];
  return {
    ...toSummary(t, now),
    description: t.description,
    affected: t.affected,
    lastEvent: last ? { at: last.at, text: last.text } : null,
  };
}
