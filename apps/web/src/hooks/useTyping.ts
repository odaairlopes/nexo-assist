import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '@nexo/shared';
import { api } from '../api/client.ts';

type TypingEvent = Extract<ServerEvent, { type: 'typing' }>;

/** Intervalo mínimo entre avisos de "digitando" enviados ao servidor. */
const SEND_THROTTLE_MS = 2500;
/** Por quanto tempo o indicador fica visível após o último aviso recebido. */
const SHOW_FOR_MS = 4000;

/**
 * Avisa o servidor que o usuário está digitando. Chamado a cada tecla, mas
 * só faz uma requisição a cada 2,5 s — barato e suficiente para o indicador.
 */
export function useTypingNotifier(conversationId: string | null, enabled = true) {
  const lastSent = useRef(0);
  return useCallback(() => {
    if (!conversationId || !enabled) return;
    const now = Date.now();
    if (now - lastSent.current < SEND_THROTTLE_MS) return;
    lastSent.current = now;
    void api(`/api/conversations/${conversationId}/typing`, { body: {} }).catch(() => undefined);
  }, [conversationId, enabled]);
}

export interface TypingInfo {
  role: TypingEvent['role'];
  name: string;
  until: number;
}

/** Quem está digitando em cada conversa (expira sozinho). */
export function useTypingState() {
  const [typing, setTyping] = useState<Record<string, TypingInfo>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const alive = Object.entries(current).filter(([, info]) => info.until > now);
        return alive.length === Object.keys(current).length ? current : Object.fromEntries(alive);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const onTyping = useCallback((e: TypingEvent) => {
    setTyping((current) => ({ ...current, [e.conversationId]: { role: e.role, name: e.name, until: Date.now() + SHOW_FOR_MS } }));
  }, []);

  /** A mensagem chegou: a pessoa parou de digitar. */
  const clear = useCallback((conversationId: string) => {
    setTyping((current) => {
      if (!(conversationId in current)) return current;
      const { [conversationId]: _gone, ...rest } = current;
      return rest;
    });
  }, []);

  return { typing, onTyping, clear };
}
