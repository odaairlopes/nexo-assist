import { SLA_RUNNING_STATUSES, type Priority, type Ticket } from '../domain.ts';
import { addBusinessMinutes, BUSINESS_MINUTES_PER_DAY } from './business-hours.ts';

export interface SlaPolicy {
  /** Minutos do prazo. */
  minutes: number;
  /** Crítica tem plantão 24h: conta em minutos corridos, não úteis. */
  calendar: boolean;
  label: string;
}

export const SLA_POLICIES: Record<Priority, SlaPolicy> = {
  critical: { minutes: 60, calendar: true, label: '1 hora' },
  high: { minutes: 4 * 60, calendar: false, label: '4 horas úteis' },
  medium: { minutes: 3 * BUSINESS_MINUTES_PER_DAY, calendar: false, label: '3 dias úteis' },
  low: { minutes: 5 * BUSINESS_MINUTES_PER_DAY, calendar: false, label: '5 dias úteis' },
};

/** Prazo da próxima resposta, contado a partir de `from` (abertura ou última atualização). */
export function computeDueDate(priority: Priority, from: Date): Date {
  const policy = SLA_POLICIES[priority];
  return policy.calendar ? new Date(from.getTime() + policy.minutes * 60_000) : addBusinessMinutes(from, policy.minutes);
}

export interface SlaStatus {
  /** O prazo está correndo (o service desk deve uma resposta)? */
  running: boolean;
  dueAt: string | null;
  overdue: boolean;
  policyLabel: string;
}

/**
 * "O prazo vale para a primeira resposta e para cada atualização; passado o
 * prazo, o chamado está vencido." — Anexo A.
 */
export function computeSlaStatus(ticket: Pick<Ticket, 'priority' | 'status' | 'updatedAt'>, now: Date = new Date()): SlaStatus {
  const policyLabel = SLA_POLICIES[ticket.priority].label;
  if (!SLA_RUNNING_STATUSES.includes(ticket.status)) {
    return { running: false, dueAt: null, overdue: false, policyLabel };
  }
  const due = computeDueDate(ticket.priority, new Date(ticket.updatedAt));
  return { running: true, dueAt: due.toISOString(), overdue: now > due, policyLabel };
}

/** Chamados resolvidos há até 7 dias podem ser reabertos (Anexo A). */
export const REOPEN_WINDOW_DAYS = 7;

export function canReopen(ticket: Pick<Ticket, 'status' | 'resolvedAt'>, now: Date = new Date()): boolean {
  if (ticket.status !== 'resolved' || !ticket.resolvedAt) return false;
  const ageMs = now.getTime() - new Date(ticket.resolvedAt).getTime();
  return ageMs <= REOPEN_WINDOW_DAYS * 24 * 60 * 60_000;
}
