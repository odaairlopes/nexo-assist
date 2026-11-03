import { z } from 'zod';

/**
 * Vocabulário do service desk (Anexo A). Valores internos em inglês/snake_case
 * para o código; rótulos em português ficam em `labels.ts`.
 */

export const TICKET_TYPES = ['INC', 'REQ'] as const;
export const TicketTypeSchema = z.enum(TICKET_TYPES);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const CATEGORIES = ['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros'] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;

export const IMPACTS = ['me', 'team', 'company'] as const;
export const ImpactSchema = z.enum(IMPACTS);
export type Impact = z.infer<typeof ImpactSchema>;

export const TICKET_STATUSES = [
  'open',
  'waiting_analyst',
  'in_progress',
  'waiting_user',
  'approved',
  'resolved',
  'closed',
] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/** Status em que o chamado ainda está "vivo" — conta para duplicidade e prazo. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['open', 'waiting_analyst', 'in_progress', 'waiting_user', 'approved'];
/** Status em que o service desk deve uma resposta (o prazo corre). */
export const SLA_RUNNING_STATUSES: readonly TicketStatus[] = ['open', 'waiting_analyst', 'in_progress'];

export const TicketEventSchema = z.object({
  at: z.string(),
  kind: z.enum(['created', 'comment', 'status', 'transfer', 'reopen', 'assign']),
  author: z.string(),
  text: z.string(),
});
export type TicketEvent = z.infer<typeof TicketEventSchema>;

export const TicketSchema = z.object({
  id: z.string(),
  type: TicketTypeSchema,
  title: z.string(),
  description: z.string(),
  category: CategorySchema,
  subcategory: z.string().nullable(),
  priority: PrioritySchema,
  status: TicketStatusSchema,
  requesterEmail: z.string(),
  affected: ImpactSchema,
  queue: z.enum(['N1', 'N2']),
  createdAt: z.string(),
  /** Última atualização feita pelo service desk — é dela que o prazo é contado. */
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  events: z.array(TicketEventSchema),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const EmployeeSchema = z.object({
  email: z.string(),
  name: z.string(),
  department: z.string(),
  role: z.enum(['employee', 'analyst']),
  /** Para analistas: nível de suporte. */
  supportLevel: z.enum(['N1', 'N2']).nullable(),
  device: z
    .object({
      kind: z.string(),
      model: z.string(),
      os: z.string(),
    })
    .nullable(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const KbArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  category: CategorySchema,
  tags: z.array(z.string()),
});
export type KbArticle = z.infer<typeof KbArticleSchema>;

// ---------- Conversa ----------

export const CONVERSATION_STATUSES = ['agent', 'waiting_human', 'human', 'closed'] as const;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const MESSAGE_ROLES = ['user', 'agent', 'analyst', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MAX_USER_MESSAGES_PER_SESSION = 30;
