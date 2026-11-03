import { z } from 'zod';
import type {
  Category,
  ConversationStatus,
  Impact,
  MessageRole,
  Priority,
  TicketStatus,
  TicketType,
} from './domain.ts';
import type { SlaStatus } from './rules/sla.ts';

/**
 * Contratos entre API e interface. Ficam no pacote compartilhado para que o
 * front e o back quebrem juntos na compilação quando algo muda.
 */

// ---------- Decisão do agent (o "porquê" de cada resposta) ----------

export const INTENTS = [
  'question',
  'ticket_status',
  'ticket_update',
  'new_ticket',
  'talk_to_human',
  'confirm',
  'cancel',
  'out_of_scope',
  'greeting',
  'unclear',
] as const;
export const IntentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof IntentSchema>;

export const ACTIONS = [
  'answered_from_kb',
  'answered',
  'asked_clarification',
  'listed_tickets',
  'showed_ticket',
  'drafted_ticket',
  'drafted_update',
  'confirmed_draft',
  'transferred',
  'redirected_out_of_scope',
  'offered_options',
] as const;
export const ActionSchema = z.enum(ACTIONS);
export type AgentAction = z.infer<typeof ActionSchema>;

export interface TraceStep {
  tool: string;
  /** Rótulo humano exibido acima da resposta ("consultou seus chamados"). */
  label: string;
  input: unknown;
  /** Resumo do resultado (nunca o payload inteiro). */
  output: unknown;
  ok: boolean;
  durationMs: number;
}

export interface AgentTrace {
  understood: string;
  intent: Intent;
  action: AgentAction;
  /** 0..1 — autoavaliação do agent, ajustada pelas travas do código. */
  confidence: number;
  reasoning: string;
  steps: TraceStep[];
  /** Regras aplicadas pelo código por cima da decisão do modelo. */
  guardrails: string[];
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
}

// ---------- Visões de chamado ----------

export interface TicketSummary {
  id: string;
  type: TicketType;
  title: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  sla: SlaStatus;
  canReopen: boolean;
}

export interface TicketView extends TicketSummary {
  description: string;
  affected: Impact;
  lastEvent: { at: string; text: string } | null;
}

export type DraftKind = 'create' | 'update' | 'reopen';
export type DraftStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed';

export interface DraftView {
  id: string;
  /** Código curto exibido no card ("Rascunho D-381"). */
  code: string;
  kind: DraftKind;
  status: DraftStatus;
  /** Para update/reopen: o chamado alvo. Para create: preenchido após confirmar. */
  ticketId: string | null;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  priorityRule: string;
  dueAt: string;
  slaLabel: string;
  affected: Impact;
  /** Texto que será adicionado ao chamado (update/reopen). */
  comment: string | null;
  error: string | null;
}

// ---------- Blocos de interface anexados a uma mensagem do agent ----------

export interface QuickOption {
  label: string;
  /** Texto enviado como mensagem do funcionário ao clicar. */
  value: string;
}

export type UiBlock =
  | { kind: 'options'; question: string | null; options: QuickOption[]; numbered: boolean }
  | { kind: 'ticket_selector'; tickets: TicketSummary[] }
  | { kind: 'ticket'; ticket: TicketView }
  | { kind: 'draft'; draft: DraftView };

// ---------- Conversa e mensagens ----------

export interface PersonRef {
  email: string;
  name: string;
}

export type TransferKind = 'requested' | 'critical' | 'overdue' | 'low_confidence' | 'agent_error';

export interface TransferInfo {
  kind: TransferKind;
  reason: string;
  summary: string;
  queue: 'N1' | 'N2';
  at: string;
  confidence: number | null;
  ticketId: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  author: PersonRef | null;
  content: string;
  ui: UiBlock[];
  trace: AgentTrace | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  employee: PersonRef & { department: string };
  status: ConversationStatus;
  assignedAnalyst: PersonRef | null;
  transfer: TransferInfo | null;
  ticketRef: string | null;
  userMessageCount: number;
  messageLimit: number;
  lastMessage: { role: MessageRole; content: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Eventos em tempo real (SSE) ----------

export type ServerEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'message_updated'; message: ChatMessage }
  | { type: 'conversation'; conversation: ConversationView }
  | { type: 'agent_thinking'; turnId: string }
  | { type: 'agent_action'; turnId: string; stepId: string; label: string; state: 'running' | 'done' | 'error' }
  | { type: 'agent_delta'; turnId: string; text: string }
  | { type: 'agent_idle'; turnId: string };

// ---------- Requests ----------

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SendMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const DraftEditSchema = z.object({
  title: z.string().trim().min(5).max(120).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  category: z.enum(['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros']).optional(),
  comment: z.string().trim().min(3).max(2000).optional(),
});
export type DraftEdit = z.infer<typeof DraftEditSchema>;

export interface SessionUser {
  email: string;
  name: string;
  department: string;
  role: 'employee' | 'analyst';
  supportLevel: 'N1' | 'N2' | null;
}
