import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_USER_MESSAGES_PER_SESSION,
  type AgentTrace,
  type ChatMessage,
  type ConversationStatus,
  type ConversationView,
  type DraftStatus,
  type DraftView,
  type MessageRole,
  type PersonRef,
  type TransferInfo,
  type UiBlock,
} from '@nexo/shared';

interface ConversationRow {
  id: string;
  employee_email: string;
  employee_name: string;
  department: string;
  status: ConversationStatus;
  assigned_email: string | null;
  assigned_name: string | null;
  transfer_json: string | null;
  ticket_ref: string | null;
  user_message_count: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  author_json: string | null;
  content: string;
  ui_json: string;
  trace_json: string | null;
  created_at: string;
}

interface DraftRow {
  id: string;
  conversation_id: string;
  status: DraftStatus;
  data: string;
  created_turn: number;
}

export type NewDraft = Omit<DraftView, 'id' | 'code' | 'status' | 'error'>;

/**
 * Persistência da API: conversas, mensagens (com o trace de cada decisão) e
 * rascunhos. Tudo em SQLite — sobrevive a reinício, como pede o PRD.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(file: string, private readonly now: () => Date = () => new Date()) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS conversations (
        id                 TEXT PRIMARY KEY,
        employee_email     TEXT NOT NULL,
        employee_name      TEXT NOT NULL,
        department         TEXT NOT NULL,
        status             TEXT NOT NULL,
        assigned_email     TEXT,
        assigned_name      TEXT,
        transfer_json      TEXT,
        ticket_ref         TEXT,
        user_message_count INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_employee ON conversations(employee_email, updated_at);
      CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status, updated_at);

      CREATE TABLE IF NOT EXISTS messages (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        id              TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role            TEXT NOT NULL,
        author_json     TEXT,
        content         TEXT NOT NULL,
        ui_json         TEXT NOT NULL DEFAULT '[]',
        trace_json      TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, seq);

      CREATE TABLE IF NOT EXISTS drafts (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        status          TEXT NOT NULL,
        data            TEXT NOT NULL,
        created_turn    INTEGER NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    `);
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---------- Conversas ----------

  private toView(row: ConversationRow): ConversationView {
    const last = this.db
      .prepare(`SELECT role, content, created_at FROM messages WHERE conversation_id = ? AND role != 'system' ORDER BY seq DESC LIMIT 1`)
      .get(row.id) as { role: MessageRole; content: string; created_at: string } | undefined;
    return {
      id: row.id,
      employee: { email: row.employee_email, name: row.employee_name, department: row.department },
      status: row.status,
      assignedAnalyst: row.assigned_email ? { email: row.assigned_email, name: row.assigned_name ?? row.assigned_email } : null,
      transfer: row.transfer_json ? (JSON.parse(row.transfer_json) as TransferInfo) : null,
      ticketRef: row.ticket_ref,
      userMessageCount: row.user_message_count,
      messageLimit: MAX_USER_MESSAGES_PER_SESSION,
      lastMessage: last ? { role: last.role, content: last.content, at: last.created_at } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createConversation(employee: PersonRef & { department: string }): ConversationView {
    const id = randomUUID();
    const at = this.iso();
    this.db
      .prepare(
        `INSERT INTO conversations (id, employee_email, employee_name, department, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'agent', ?, ?)`,
      )
      .run(id, employee.email, employee.name, employee.department, at, at);
    return this.getConversation(id)!;
  }

  getConversation(id: string): ConversationView | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
    return row ? this.toView(row) : null;
  }

  /** Última conversa não encerrada do funcionário — "voltar outro dia e continuar de onde parei". */
  findActiveConversation(employeeEmail: string): ConversationView | null {
    const row = this.db
      .prepare(`SELECT * FROM conversations WHERE employee_email = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1`)
      .get(employeeEmail) as ConversationRow | undefined;
    return row ? this.toView(row) : null;
  }

  listConversations(): ConversationView[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200').all() as unknown as ConversationRow[];
    return rows.map((r) => this.toView(r));
  }

  updateConversation(
    id: string,
    patch: Partial<{
      status: ConversationStatus;
      assigned: PersonRef | null;
      transfer: TransferInfo | null;
      ticketRef: string | null;
    }>,
  ): ConversationView {
    const sets: string[] = ['updated_at = ?'];
    const values: (string | null)[] = [this.iso()];
    if (patch.status !== undefined) {
      sets.push('status = ?');
      values.push(patch.status);
    }
    if (patch.assigned !== undefined) {
      sets.push('assigned_email = ?', 'assigned_name = ?');
      values.push(patch.assigned?.email ?? null, patch.assigned?.name ?? null);
    }
    if (patch.transfer !== undefined) {
      sets.push('transfer_json = ?');
      values.push(patch.transfer ? JSON.stringify(patch.transfer) : null);
    }
    if (patch.ticketRef !== undefined) {
      sets.push('ticket_ref = ?');
      values.push(patch.ticketRef);
    }
    this.db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    return this.getConversation(id)!;
  }

  // ---------- Mensagens ----------

  private toMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      author: row.author_json ? (JSON.parse(row.author_json) as PersonRef) : null,
      content: row.content,
      ui: JSON.parse(row.ui_json) as UiBlock[],
      trace: row.trace_json ? (JSON.parse(row.trace_json) as AgentTrace) : null,
      createdAt: row.created_at,
    };
  }

  addMessage(input: {
    conversationId: string;
    role: MessageRole;
    author: PersonRef | null;
    content: string;
    ui?: UiBlock[];
    trace?: AgentTrace | null;
  }): ChatMessage {
    const id = randomUUID();
    const at = this.iso();
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, author_json, content, ui_json, trace_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.role,
        input.author ? JSON.stringify(input.author) : null,
        input.content,
        JSON.stringify(input.ui ?? []),
        input.trace ? JSON.stringify(input.trace) : null,
        at,
      );
    const counter = input.role === 'user' ? ', user_message_count = user_message_count + 1' : '';
    this.db.prepare(`UPDATE conversations SET updated_at = ?${counter} WHERE id = ?`).run(at, input.conversationId);
    return this.getMessage(id)!;
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? this.toMessage(row) : null;
  }

  listMessages(conversationId: string, limit?: number): ChatMessage[] {
    const rows = (
      limit
        ? this.db
            .prepare('SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC')
            .all(conversationId, limit)
        : this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC').all(conversationId)
    ) as unknown as MessageRow[];
    return rows.map((r) => this.toMessage(r));
  }

  /** Reescreve os blocos de UI de uma mensagem (ex.: rascunho confirmado). */
  updateMessageUi(id: string, ui: UiBlock[]): ChatMessage | null {
    this.db.prepare('UPDATE messages SET ui_json = ? WHERE id = ?').run(JSON.stringify(ui), id);
    return this.getMessage(id);
  }

  /** Mensagens que exibem um rascunho — para atualizar o card quando ele muda. */
  findMessagesWithDraft(conversationId: string, draftId: string): ChatMessage[] {
    return this.listMessages(conversationId).filter((m) => m.ui.some((b) => b.kind === 'draft' && b.draft.id === draftId));
  }

  // ---------- Rascunhos ----------

  private nextDraftCode(): string {
    this.db.prepare(`INSERT OR IGNORE INTO counters (name, value) VALUES ('draft', 380)`).run();
    this.db.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'draft'`).run();
    const row = this.db.prepare(`SELECT value FROM counters WHERE name = 'draft'`).get() as { value: number };
    return `D-${row.value}`;
  }

  createDraft(conversationId: string, turn: number, draft: NewDraft): DraftView {
    const id = randomUUID();
    const view: DraftView = { ...draft, id, code: this.nextDraftCode(), status: 'pending', error: null };
    const at = this.iso();
    // Um rascunho pendente por vez: o novo substitui o anterior da mesma conversa.
    this.db
      .prepare(`UPDATE drafts SET status = 'cancelled', updated_at = ? WHERE conversation_id = ? AND status = 'pending'`)
      .run(at, conversationId);
    this.db
      .prepare(`INSERT INTO drafts (id, conversation_id, status, data, created_turn, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)`)
      .run(id, conversationId, JSON.stringify(view), turn, at, at);
    return view;
  }

  getDraft(id: string): (DraftView & { conversationId: string; createdTurn: number }) | null {
    const row = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as DraftRow | undefined;
    if (!row) return null;
    const view = JSON.parse(row.data) as DraftView;
    return { ...view, status: row.status, conversationId: row.conversation_id, createdTurn: row.created_turn };
  }

  listPendingDrafts(conversationId: string): DraftView[] {
    const rows = this.db
      .prepare(`SELECT * FROM drafts WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at DESC`)
      .all(conversationId) as unknown as DraftRow[];
    return rows.map((r) => ({ ...(JSON.parse(r.data) as DraftView), status: r.status }));
  }

  saveDraft(view: DraftView): void {
    this.db.prepare('UPDATE drafts SET status = ?, data = ?, updated_at = ? WHERE id = ?').run(view.status, JSON.stringify(view), this.iso(), view.id);
  }

  close(): void {
    this.db.close();
  }
}
