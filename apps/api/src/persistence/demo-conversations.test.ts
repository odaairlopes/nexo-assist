import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDemoConversations } from './demo-conversations.ts';
import { Store } from './store.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-demo-'));
  dirs.push(dir);
  return path.join(dir, 'api.db');
}

describe('conversas de exemplo', () => {
  it('cria conversas em todos os estados do console e não roda de novo', () => {
    const db = tempDb();
    expect(seedDemoConversations(db)).toBe(8);
    expect(seedDemoConversations(db)).toBe(0);

    const store = new Store(db);
    const convs = store.listConversations();
    store.close();
    const statuses = new Set(convs.map((c) => c.status));
    expect(statuses).toEqual(new Set(['agent', 'waiting_human', 'human', 'closed']));
    expect(convs.some((c) => c.transfer?.kind === 'low_confidence' && c.transfer.confidence === 0.41)).toBe(true);
    expect(convs.some((c) => c.transfer?.kind === 'critical' && c.transfer.queue === 'N2')).toBe(true);
    // Contas reservadas para testar o chat do zero.
    const people = convs.map((c) => c.employee.email);
    for (const free of ['ana.souza@nexo.com.br', 'marcos.vieira@nexo.com.br', 'renata.lopes@nexo.com.br']) {
      expect(people).not.toContain(free);
    }
  });
});
