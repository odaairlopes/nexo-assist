import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@nexo/shared';

type Listener = (event: ServerEvent) => void;

/**
 * Pub/sub em memória que alimenta os streams SSE.
 *
 * Dois canais: um por conversa (funcionário e analista que a abriu) e um
 * global do console (lista de conversas). Num deploy com várias instâncias,
 * isto vira Redis Pub/Sub — a interface fica igual.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(conversationId: string, event: ServerEvent): void {
    this.emitter.emit(`conv:${conversationId}`, event);
    // O console só precisa saber de mudanças de estado e mensagens novas.
    if (event.type === 'conversation' || event.type === 'message') this.emitter.emit('console', event);
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    const key = `conv:${conversationId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  subscribeConsole(listener: Listener): () => void {
    this.emitter.on('console', listener);
    return () => this.emitter.off('console', listener);
  }
}
