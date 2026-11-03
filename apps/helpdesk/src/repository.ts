import type { DatabaseSync } from 'node:sqlite';
import {
  canReopen,
  normalize,
  tokenize,
  type Category,
  type Employee,
  type Impact,
  type KbArticle,
  type Priority,
  type Ticket,
  type TicketEvent,
  type TicketStatus,
  type TicketType,
} from '@nexo/shared';

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export interface NewTicketInput {
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  affected: Impact;
  queue: 'N1' | 'N2';
  author: string;
}

/**
 * Acesso aos dados do "legado". Toda leitura de chamado exige o e-mail de
 * quem pede: a regra de privacidade fica na fonte, não só no agent.
 */
export class HelpdeskRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---------- Funcionários ----------

  upsertEmployee(e: Employee): void {
    this.db.prepare('INSERT OR REPLACE INTO employees (email, data) VALUES (?, ?)').run(e.email, JSON.stringify(e));
  }

  getEmployee(email: string): Employee | null {
    const row = this.db.prepare('SELECT data FROM employees WHERE email = ?').get(email.toLowerCase()) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Employee) : null;
  }

  // ---------- Chamados ----------

  saveTicket(t: Ticket): void {
    this.db
      .prepare('INSERT OR REPLACE INTO tickets (id, requester_email, data) VALUES (?, ?, ?)')
      .run(t.id, t.requesterEmail, JSON.stringify(t));
  }

  listTickets(requesterEmail: string): Ticket[] {
    const rows = this.db.prepare('SELECT data FROM tickets WHERE requester_email = ?').all(requesterEmail.toLowerCase()) as {
      data: string;
    }[];
    return rows.map((r) => JSON.parse(r.data) as Ticket).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Retorna o chamado só se pertencer ao solicitante — senão, "não existe". */
  getTicket(id: string, requesterEmail: string): Ticket {
    const row = this.db.prepare('SELECT data FROM tickets WHERE id = ? AND requester_email = ?').get(
      id.toUpperCase(),
      requesterEmail.toLowerCase(),
    ) as { data: string } | undefined;
    if (!row) throw new NotFoundError(`Chamado ${id} não encontrado`);
    return JSON.parse(row.data) as Ticket;
  }

  private nextId(type: TicketType): string {
    const name = type === 'INC' ? 'INC' : 'REQ';
    const start = type === 'INC' ? 20500 : 10500;
    this.db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, ?)').run(name, start);
    this.db.prepare('UPDATE sequences SET value = value + 1 WHERE name = ?').run(name);
    const row = this.db.prepare('SELECT value FROM sequences WHERE name = ?').get(name) as { value: number };
    return `${name}-${row.value}`;
  }

  createTicket(requesterEmail: string, input: NewTicketInput): Ticket {
    const at = this.now().toISOString();
    const ticket: Ticket = {
      id: this.nextId(input.type),
      type: input.type,
      title: input.title,
      description: input.description,
      category: input.category,
      subcategory: input.subcategory,
      priority: input.priority,
      status: 'open',
      requesterEmail: requesterEmail.toLowerCase(),
      affected: input.affected,
      queue: input.queue,
      createdAt: at,
      updatedAt: at,
      resolvedAt: null,
      events: [{ at, kind: 'created', author: input.author, text: 'Chamado aberto pelo Nexo Assist' }],
    };
    this.saveTicket(ticket);
    return ticket;
  }

  private mutate(id: string, requesterEmail: string, fn: (t: Ticket, at: string) => void): Ticket {
    const ticket = this.getTicket(id, requesterEmail);
    const at = this.now().toISOString();
    fn(ticket, at);
    this.saveTicket(ticket);
    return ticket;
  }

  private pushEvent(t: Ticket, event: TicketEvent): void {
    t.events.push(event);
  }

  /** Complemento do funcionário. Não reinicia o prazo: ele conta das respostas do service desk. */
  addComment(id: string, requesterEmail: string, author: string, text: string): Ticket {
    return this.mutate(id, requesterEmail, (t, at) => {
      if (t.status === 'closed' || t.status === 'resolved') {
        throw new ConflictError(`${t.id} está ${t.status === 'closed' ? 'encerrado' : 'resolvido'}; use a reabertura`);
      }
      if (t.status === 'waiting_user') t.status = 'waiting_analyst';
      this.pushEvent(t, { at, kind: 'comment', author, text });
    });
  }

  reopen(id: string, requesterEmail: string, author: string, text: string): Ticket {
    return this.mutate(id, requesterEmail, (t, at) => {
      if (!canReopen(t, this.now())) throw new ConflictError(`${t.id} não pode ser reaberto (só até 7 dias após resolvido)`);
      t.status = 'waiting_analyst';
      t.resolvedAt = null;
      t.updatedAt = at;
      this.pushEvent(t, { at, kind: 'reopen', author, text });
    });
  }

  transfer(id: string, requesterEmail: string, queue: 'N1' | 'N2', summary: string): Ticket {
    return this.mutate(id, requesterEmail, (t, at) => {
      t.queue = queue;
      if (t.status === 'open' || t.status === 'waiting_user') t.status = 'waiting_analyst';
      this.pushEvent(t, { at, kind: 'transfer', author: 'Nexo Assist', text: `Transferido para Suporte ${queue}: ${summary}` });
    });
  }

  /** Analista assumiu o atendimento: o chamado passa a "em andamento" e o prazo reinicia. */
  assign(id: string, requesterEmail: string, analystName: string): Ticket {
    return this.mutate(id, requesterEmail, (t, at) => {
      if (t.status === 'resolved' || t.status === 'closed') return;
      t.status = 'in_progress';
      t.updatedAt = at;
      this.pushEvent(t, { at, kind: 'assign', author: analystName, text: `Assumido por ${analystName}` });
    });
  }

  setStatus(id: string, requesterEmail: string, status: TicketStatus, author: string): Ticket {
    return this.mutate(id, requesterEmail, (t, at) => {
      t.status = status;
      t.updatedAt = at;
      t.resolvedAt = status === 'resolved' ? at : null;
      this.pushEvent(t, { at, kind: 'status', author, text: `Status alterado para ${status}` });
    });
  }

  // ---------- Central de ajuda ----------

  upsertArticle(a: KbArticle): void {
    this.db.prepare('INSERT OR REPLACE INTO kb_articles (id, data) VALUES (?, ?)').run(a.id, JSON.stringify(a));
  }

  getArticle(id: string): KbArticle | null {
    const row = this.db.prepare('SELECT data FROM kb_articles WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as KbArticle) : null;
  }

  /**
   * Busca lexical com pesos (título e tags valem mais que o corpo). Com 10
   * artigos, isso é instantâneo e gratuito; com milhares, trocaríamos por
   * busca vetorial (ver README).
   */
  searchArticles(query: string, limit = 3): { article: KbArticle; score: number }[] {
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const rows = this.db.prepare('SELECT data FROM kb_articles').all() as { data: string }[];
    const qNorm = normalize(query);
    return rows
      .map((r) => JSON.parse(r.data) as KbArticle)
      .map((article) => {
        const title = new Set(tokenize(article.title));
        const tags = new Set(article.tags.flatMap((t) => tokenize(t)));
        const body = new Set(tokenize(article.body));
        let score = 0;
        for (const t of terms) {
          if (title.has(t)) score += 3;
          if (tags.has(t)) score += 2;
          if (body.has(t)) score += 1;
        }
        // Códigos de erro ("809") e frases exatas pesam muito.
        for (const tag of article.tags) if (qNorm.includes(normalize(tag)) && normalize(tag).length > 2) score += 2;
        return { article, score: score / (terms.size * 3) };
      })
      .filter((r) => r.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ ...r, score: Number(Math.min(1, r.score).toFixed(2)) }));
  }

  // ---------- Idempotência ----------

  getIdempotent(key: string): unknown {
    const row = this.db.prepare('SELECT response FROM idempotency WHERE key = ?').get(key) as { response: string } | undefined;
    return row ? JSON.parse(row.response) : undefined;
  }

  saveIdempotent(key: string, response: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO idempotency (key, response, created_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(response), this.now().toISOString());
  }

  isEmpty(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM employees').get() as { n: number };
    return row.n === 0;
  }
}
