import { describe, expect, it } from 'vitest';
import type { DraftView, Ticket } from '@nexo/shared';
import type { Decision } from './decision-schema.ts';
import { finalizeTurn, stripInternalNotes, type FinalizeInput } from './guardrails.ts';

const now = new Date('2026-10-20T13:00:00Z');

const ticket = (id: string): Ticket => ({
  id,
  type: 'INC',
  title: 'Notebook lento',
  description: 'Lento',
  category: 'Hardware',
  subcategory: null,
  priority: 'medium',
  status: 'waiting_analyst',
  requesterEmail: 'ana.souza@nexo.com.br',
  affected: 'me',
  queue: 'N1',
  createdAt: '2026-10-10T13:00:00Z',
  updatedAt: '2026-10-10T13:00:00Z',
  resolvedAt: null,
  events: [],
});

const draft: DraftView = {
  id: 'd1',
  code: 'D-381',
  kind: 'create',
  status: 'pending',
  ticketId: null,
  type: 'INC',
  title: 'VPN não conecta',
  description: 'Erro 809',
  category: 'Rede e VPN',
  priority: 'high',
  priorityRule: 'Há um compromisso em risco no mesmo dia',
  dueAt: now.toISOString(),
  slaLabel: '4 horas úteis',
  affected: 'me',
  comment: null,
  error: null,
};

const decision = (over: Partial<Decision> = {}): Decision => ({
  understood: 'Quer saber o status do chamado',
  intent: 'ticket_status',
  action: 'showed_ticket',
  confidence: 0.9,
  reasoning: 'Consultou o chamado',
  reply: 'Está aguardando analista.',
  question: null,
  options: [],
  show_ticket_id: null,
  show_ticket_selector: [],
  show_draft_id: null,
  ...over,
});

const base = (over: Partial<FinalizeInput> = {}): FinalizeInput => ({
  decision: decision(),
  error: null,
  tickets: new Map([['INC-20311', ticket('INC-20311')]]),
  getDraft: (id) => (id === 'd1' ? draft : null),
  pendingDrafts: [],
  draftsCreatedThisTurn: new Set(),
  confirmedThisTurn: new Set(),
  pendingTransfer: null,
  minConfidence: 0.5,
  now,
  ...over,
});

describe('finalizeTurn (travas determinísticas)', () => {
  it('mostra o card de um chamado verificado do funcionário', () => {
    const out = finalizeTurn(base({ decision: decision({ show_ticket_id: 'INC-20311' }) }));
    expect(out.ui[0]).toMatchObject({ kind: 'ticket', ticket: { id: 'INC-20311' } });
    expect(out.ui[0]?.kind === 'ticket' && out.ui[0].ticket.sla.overdue).toBe(true);
  });

  it('privacidade: não exibe chamado que não foi lido como do funcionário', () => {
    const out = finalizeTurn(base({ decision: decision({ show_ticket_id: 'INC-20290' }) }));
    expect(out.ui).toHaveLength(0);
    expect(out.guardrails.join(' ')).toMatch(/omitido/);
  });

  it('confiança baixa vira transferência para analista', () => {
    const out = finalizeTurn(base({ decision: decision({ confidence: 0.41, intent: 'ticket_update' }) }));
    expect(out.action).toBe('transferred');
    expect(out.transfer).toMatchObject({ kind: 'low_confidence', confidence: 0.41 });
  });

  it('não transfere saudação ou assunto fora do escopo por confiança baixa', () => {
    const out = finalizeTurn(base({ decision: decision({ confidence: 0.3, intent: 'out_of_scope', action: 'redirected_out_of_scope' }) }));
    expect(out.transfer).toBeNull();
  });

  it('corrige o modelo quando ele diz que confirmou sem ter executado', () => {
    const out = finalizeTurn(
      base({ decision: decision({ action: 'confirmed_draft', reply: 'Chamado criado!' }), pendingDrafts: [draft] }),
    );
    expect(out.reply).not.toMatch(/criado/);
    expect(out.action).toBe('drafted_ticket');
  });

  it('anexa o rascunho criado no turno mesmo se o modelo esquecer de exibi-lo', () => {
    const out = finalizeTurn(base({ decision: decision({ action: 'drafted_ticket' }), draftsCreatedThisTurn: new Set(['d1']) }));
    expect(out.ui.some((b) => b.kind === 'draft')).toBe(true);
  });

  it('resposta de contingência quando o modelo falha', () => {
    const out = finalizeTurn(base({ decision: null, error: 'timeout' }));
    expect(out.confidence).toBe(0);
    expect(out.ui[0]).toMatchObject({ kind: 'options' });
    expect(out.reasoning).toMatch(/timeout/);
  });

  it('aplica a transferência pedida mesmo se o modelo falhar depois', () => {
    const transfer = { kind: 'requested' as const, reason: 'pediu', summary: 'Quer analista', ticketId: null, confidence: null };
    const out = finalizeTurn(base({ decision: null, error: '429', pendingTransfer: transfer }));
    expect(out.transfer).toEqual(transfer);
    expect(out.action).toBe('transferred');
  });

  it('remove anotações internas que o modelo copie do histórico', () => {
    expect(stripInternalNotes('Qual deles?\n\n[exibido: opções: "INC-1", "INC-2"]')).toBe('Qual deles?');
    const out = finalizeTurn(base({ decision: decision({ reply: 'Ok. [Evento do sistema: Transferida]' }) }));
    expect(out.reply).toBe('Ok.');
  });

  it('numera as opções quando há pergunta destacada', () => {
    const out = finalizeTurn(
      base({
        decision: decision({
          intent: 'new_ticket',
          action: 'asked_clarification',
          question: 'Quem está sendo afetado?',
          options: ['Só eu', 'Minha equipe', 'Toda a empresa', 'Não sei'],
        }),
      }),
    );
    expect(out.ui[0]).toMatchObject({ kind: 'options', numbered: true });
  });
});
