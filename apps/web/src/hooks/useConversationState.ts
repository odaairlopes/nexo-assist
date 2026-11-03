import { useCallback, useReducer } from 'react';
import type { ChatMessage, ConversationView, ServerEvent } from '@nexo/shared';

export interface LiveAction {
  stepId: string;
  label: string;
  state: 'running' | 'done' | 'error';
}

/** Turno do agent em andamento: ações aparecendo e texto sendo escrito. */
export interface LiveTurn {
  turnId: string;
  actions: LiveAction[];
  text: string;
}

export interface ConversationState {
  conversation: ConversationView | null;
  messages: ChatMessage[];
  live: LiveTurn | null;
}

type Action =
  | { type: 'load'; conversation: ConversationView; messages: ChatMessage[] }
  | { type: 'event'; event: ServerEvent }
  | { type: 'local_message'; message: ChatMessage };

function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const i = messages.findIndex((m) => m.id === message.id);
  if (i === -1) return [...messages, message];
  const next = messages.slice();
  next[i] = message;
  return next;
}

function reducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'load':
      return { conversation: action.conversation, messages: action.messages, live: null };
    case 'local_message':
      return { ...state, messages: upsert(state.messages, action.message) };
    case 'event': {
      const e = action.event;
      switch (e.type) {
        case 'message':
        case 'message_updated': {
          if (state.conversation && e.message.conversationId !== state.conversation.id) return state;
          const live = e.type === 'message' && e.message.role === 'agent' ? null : state.live;
          return { ...state, messages: upsert(state.messages, e.message), live };
        }
        case 'conversation':
          if (state.conversation && e.conversation.id !== state.conversation.id) return state;
          return { ...state, conversation: e.conversation };
        case 'agent_thinking':
          return { ...state, live: { turnId: e.turnId, actions: [], text: '' } };
        case 'agent_action': {
          const live = state.live ?? { turnId: e.turnId, actions: [], text: '' };
          const exists = live.actions.some((a) => a.stepId === e.stepId);
          const actions = exists
            ? live.actions.map((a) => (a.stepId === e.stepId ? { ...a, label: e.label, state: e.state } : a))
            : [...live.actions, { stepId: e.stepId, label: e.label, state: e.state }];
          return { ...state, live: { ...live, actions } };
        }
        case 'agent_delta': {
          const live = state.live ?? { turnId: e.turnId, actions: [], text: '' };
          return { ...state, live: { ...live, text: e.text } };
        }
        case 'agent_idle':
          return state.live?.turnId === e.turnId ? { ...state, live: null } : state;
      }
      return state;
    }
  }
}

/** Estado de uma conversa alimentado por carga inicial + eventos SSE. Usado no chat e no console. */
export function useConversationState() {
  const [state, dispatch] = useReducer(reducer, { conversation: null, messages: [], live: null });
  const load = useCallback((conversation: ConversationView, messages: ChatMessage[]) => dispatch({ type: 'load', conversation, messages }), []);
  const apply = useCallback((event: ServerEvent) => dispatch({ type: 'event', event }), []);
  const addLocal = useCallback((message: ChatMessage) => dispatch({ type: 'local_message', message }), []);
  return { state, load, apply, addLocal };
}
