import type { Category, Employee, Impact, KbArticle, Priority, Ticket, TicketType } from '@nexo/shared';

export class HelpdeskUnavailableError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
  }
}

export class HelpdeskRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface HelpdeskClientOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
  retries: number;
  /** Injetável nos testes. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { path: string; attempt: number; reason: string }) => void;
}

export interface CreateTicketInput {
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  affected: Impact;
  queue: 'N1' | 'N2';
}

const RETRYABLE = new Set([502, 503, 504]);

/**
 * Cliente do legado. Concentra a resiliência num único lugar:
 * - timeout por tentativa;
 * - retry com backoff exponencial + jitter só para falhas transitórias (5xx de
 *   gateway, rede, timeout) — nunca para 4xx;
 * - escritas levam Idempotency-Key, então repetir é seguro e não duplica chamado.
 */
export class HelpdeskClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HelpdeskClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const maxAttempts = this.opts.retries + 1;
    let lastReason = 'desconhecido';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const headers: Record<string, string> = { 'x-service-token': this.opts.serviceToken };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
        const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.ok) return (await res.json()) as T;
        const payload: unknown = await res.json().catch(() => null);
        if (!RETRYABLE.has(res.status)) {
          const message = (payload as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
          throw new HelpdeskRequestError(message, res.status, payload);
        }
        lastReason = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof HelpdeskRequestError) throw err;
        lastReason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'erro de rede';
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxAttempts) {
        this.opts.onRetry?.({ path, attempt, reason: lastReason });
        const backoff = 200 * 2 ** (attempt - 1);
        await this.sleep(backoff + Math.floor(Math.random() * 100));
      }
    }
    throw new HelpdeskUnavailableError(`Sistema de chamados indisponível (${lastReason})`, maxAttempts);
  }

  private q(requester: string): string {
    return `requester=${encodeURIComponent(requester)}`;
  }

  getEmployee(email: string): Promise<Employee> {
    return this.request('GET', `/employees/${encodeURIComponent(email)}`);
  }

  async listTickets(requester: string): Promise<Ticket[]> {
    const res = await this.request<{ tickets: Ticket[] }>('GET', `/tickets?${this.q(requester)}`);
    return res.tickets;
  }

  getTicket(id: string, requester: string): Promise<Ticket> {
    return this.request('GET', `/tickets/${encodeURIComponent(id)}?${this.q(requester)}`);
  }

  createTicket(requester: string, input: CreateTicketInput, idempotencyKey: string): Promise<Ticket> {
    return this.request('POST', '/tickets', { requester, ...input, author: 'Nexo Assist' }, idempotencyKey);
  }

  addComment(id: string, requester: string, author: string, text: string, idempotencyKey: string): Promise<Ticket> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/comments`, { requester, author, text }, idempotencyKey);
  }

  reopen(id: string, requester: string, author: string, text: string, idempotencyKey: string): Promise<Ticket> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/reopen`, { requester, author, text }, idempotencyKey);
  }

  transfer(id: string, requester: string, queue: 'N1' | 'N2', summary: string, idempotencyKey: string): Promise<Ticket> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/transfer`, { requester, queue, summary }, idempotencyKey);
  }

  assign(id: string, requester: string, analystName: string): Promise<Ticket> {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/assign`, { requester, analystName });
  }

  async searchKb(query: string): Promise<{ article: KbArticle; score: number }[]> {
    const res = await this.request<{ results: { article: KbArticle; score: number }[] }>(
      'GET',
      `/kb/search?q=${encodeURIComponent(query)}`,
    );
    return res.results;
  }
}
