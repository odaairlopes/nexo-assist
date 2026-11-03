import type { ChatMessage, ConversationView, DraftEdit, DraftView, LoginRequest, SessionUser, TicketView } from '@nexo/shared';
import { api } from './client.ts';

export interface ConversationPayload {
  conversation: ConversationView;
  messages: ChatMessage[];
}

const conv = (id: string) => `/api/chat/conversations/${id}`;
const consoleConv = (id: string) => `/api/console/conversations/${id}`;

export const authApi = {
  login: (body: LoginRequest) => api<{ user: SessionUser }>('/api/auth/login', { body }),
  logout: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST', body: {} }),
  me: () => api<{ user: SessionUser }>('/api/auth/me'),
};

export const chatApi = {
  current: () => api<ConversationPayload>('/api/chat/conversation'),
  startNew: () => api<ConversationPayload>('/api/chat/conversations', { body: {} }),
  send: (id: string, content: string) => api<{ message: ChatMessage }>(`${conv(id)}/messages`, { body: { content } }),
  confirmDraft: (id: string, draftId: string) => api<{ draft: DraftView }>(`${conv(id)}/drafts/${draftId}/confirm`, { body: {} }),
  cancelDraft: (id: string, draftId: string) => api<{ draft: DraftView }>(`${conv(id)}/drafts/${draftId}/cancel`, { body: {} }),
  editDraft: (id: string, draftId: string, edit: DraftEdit) =>
    api<{ draft: DraftView }>(`${conv(id)}/drafts/${draftId}`, { method: 'PATCH', body: edit }),
};

export const consoleApi = {
  list: () => api<{ conversations: ConversationView[] }>('/api/console/conversations'),
  get: (id: string) => api<ConversationPayload>(consoleConv(id)),
  tickets: (id: string) => api<{ tickets: TicketView[] }>(`${consoleConv(id)}/tickets`),
  take: (id: string) => api<{ conversation: ConversationView }>(`${consoleConv(id)}/take`, { body: {} }),
  giveBack: (id: string) => api<{ conversation: ConversationView }>(`${consoleConv(id)}/return`, { body: {} }),
  close: (id: string) => api<{ conversation: ConversationView }>(`${consoleConv(id)}/close`, { body: {} }),
  send: (id: string, content: string) => api<{ message: ChatMessage }>(`${consoleConv(id)}/messages`, { body: { content } }),
};
