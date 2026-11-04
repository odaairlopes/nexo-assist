import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@nexo/shared';

type Listener = (event: ServerEvent) => void;

/** Eventos de uma conversa que também interessam à lista do console. */
const CONSOLE_EVENTS: ReadonlySet<ServerEvent['type']> = new Set(['conversation', 'message', 'typing']);

/**
 * Pub/sub em memória que alimenta os streams SSE, e o registro de presença.
 *
 * Dois canais: um por conversa (funcionário e analista que a abriu) e um
 * global do console (lista de conversas). Presença = ter ao menos uma conexão
 * SSE aberta (várias abas contam como uma pessoa). Num deploy com várias
 * instâncias, isto vira Redis Pub/Sub + chaves com TTL — a interface fica igual.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly connections = new Map<string, number>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(conversationId: string, event: ServerEvent): void {
    this.emitter.emit(`conv:${conversationId}`, event);
    if (CONSOLE_EVENTS.has(event.type)) this.emitter.emit('console', event);
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

  // ---------- Presença ----------

  /** Registra uma conexão da pessoa; devolve a função que a encerra. */
  connect(email: string): () => void {
    const before = this.connections.get(email) ?? 0;
    this.connections.set(email, before + 1);
    if (before === 0) this.emitter.emit('console', { type: 'presence', email, online: true } satisfies ServerEvent);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const now = (this.connections.get(email) ?? 1) - 1;
      if (now <= 0) {
        this.connections.delete(email);
        this.emitter.emit('console', { type: 'presence', email, online: false } satisfies ServerEvent);
      } else {
        this.connections.set(email, now);
      }
    };
  }

  isOnline(email: string): boolean {
    return (this.connections.get(email) ?? 0) > 0;
  }
}
