import type { Impact, Priority, TicketStatus, TicketType } from './domain.ts';
import type { ConversationStatus } from './domain.ts';

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  waiting_analyst: 'Aguardando analista',
  in_progress: 'Em andamento',
  waiting_user: 'Aguardando você',
  approved: 'Aprovado',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

export const TYPE_LABEL: Record<TicketType, string> = {
  INC: 'Incidente',
  REQ: 'Requisição',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  me: 'Somente você',
  team: 'Sua equipe',
  company: 'Toda a empresa',
};

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  agent: 'Agent atendendo',
  waiting_human: 'Aguardando atendente',
  human: 'Analista atendendo',
  closed: 'Encerrada',
};

/** Tom visual (cor do ponto) por status de chamado. */
export type Tone = 'warning' | 'primary' | 'success' | 'danger' | 'neutral';

export const STATUS_TONE: Record<TicketStatus, Tone> = {
  open: 'primary',
  waiting_analyst: 'warning',
  in_progress: 'primary',
  waiting_user: 'warning',
  approved: 'success',
  resolved: 'neutral',
  closed: 'neutral',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
};

/** "há 5 dias", "há 3 h", "agora". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMin = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 14) return d === 1 ? 'há 1 dia' : `há ${d} dias`;
  const w = Math.round(d / 7);
  return w === 1 ? 'há 1 semana' : `há ${w} semanas`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
