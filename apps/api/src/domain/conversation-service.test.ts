import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationView, SessionUser } from '@nexo/shared';
import { HelpdeskUnavailableError } from '../clients/helpdesk-client.ts';
import { Store } from '../persistence/store.ts';
import { EventBus } from '../realtime/event-bus.ts';
import { inMemoryHelpdesk } from '../test-utils.ts';
import { ConversationService, type TurnRunner } from './conversation-service.ts';
import { DomainError } from './errors.ts';

const ana: SessionUser = { email: 'ana.souza@nexo.com.br', name: 'Ana Souza', department: 'Financeiro', role: 'employee', supportLevel: null };
const diego: SessionUser = { email: 'diego.ramos@nexo.com.br', name: 'Diego Ramos', department: 'Engenharia', role: 'employee', supportLevel: null };
const rafael: SessionUser = { email: 'rafael.lima@nexo.com.br', name: 'Rafael Lima', department: 'TI', role: 'analyst', supportLevel: 'N2' };

const silentLog = { error: () => {}, warn: () => {} };

class RecordingRunner implements TurnRunner {
  calls: string[] = [];
  async run(conv: ConversationView, msg: ChatMessage) {
    this.calls.push(`${conv.id}:${msg.content}`);
  }
}

function setup() {
  const store = new Store(':memory:');
  const { client } = inMemoryHelpdesk();
  const service = new ConversationService(store, new EventBus(), client, silentLog);
  const runner = new RecordingRunner();
  service.attachRunner(runner);
  return { store, service, runner, client };
}

describe('ConversationService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('retoma a conversa ativa ao voltar ("continuar de onde parei")', () => {
    const a = ctx.service.currentConversation(ana);
    const b = ctx.service.currentConversation(ana);
    expect(b.id).toBe(a.id);
  });

  it('funcionário não acessa conversa de outro (responde como inexistente)', () => {
    const conv = ctx.service.currentConversation(ana);
    expect(() => ctx.service.requireConversation(diego, conv.id)).toThrowError(DomainError);
  });

  it('o agent responde enquanto a conversa está com ele', async () => {
    const conv = ctx.service.currentConversation(ana);
    await ctx.service.postUserMessage(ana, conv.id, 'oi');
    await ctx.service.idle(conv.id);
    expect(ctx.runner.calls).toHaveLength(1);
  });

  it('o agent NÃO responde enquanto aguarda ou está com analista', async () => {
    const conv = ctx.service.currentConversation(ana);
    await ctx.service.transfer(conv.id, { kind: 'requested', reason: 'pediu', summary: 'Quer analista', ticketId: null, confidence: null });
    await ctx.service.postUserMessage(ana, conv.id, 'alô?');
    ctx.service.takeOver(rafael, conv.id);
    await ctx.service.postUserMessage(ana, conv.id, 'ainda aí?');
    await ctx.service.idle(conv.id);
    expect(ctx.runner.calls).toHaveLength(0);
    expect(ctx.store.getConversation(conv.id)?.status).toBe('human');
  });

  it('ciclo do analista: assumir → responder → devolver → agent volta a responder', async () => {
    const conv = ctx.service.currentConversation(ana);
    await ctx.service.transfer(conv.id, { kind: 'requested', reason: 'pediu', summary: 'Quer analista', ticketId: null, confidence: null });
    expect(() => ctx.service.postAnalystMessage(rafael, conv.id, 'oi')).toThrowError(/Assuma/);
    ctx.service.takeOver(rafael, conv.id);
    ctx.service.postAnalystMessage(rafael, conv.id, 'Oi, Ana!');
    ctx.service.returnToAgent(rafael, conv.id);
    await ctx.service.postUserMessage(ana, conv.id, 'obrigada');
    await ctx.service.idle(conv.id);
    expect(ctx.runner.calls).toHaveLength(1);
    const system = ctx.store.listMessages(conv.id).filter((m) => m.role === 'system').map((m) => m.content);
    expect(system.some((s) => s.startsWith('Rafael Lima assumiu'))).toBe(true);
  });

  it('limita a 30 mensagens por sessão', async () => {
    const conv = ctx.service.currentConversation(ana);
    await ctx.service.transfer(conv.id, { kind: 'requested', reason: 'x', summary: 'sem agent para o teste', ticketId: null, confidence: null });
    for (let i = 0; i < 30; i++) await ctx.service.postUserMessage(ana, conv.id, `msg ${i}`);
    await expect(ctx.service.postUserMessage(ana, conv.id, 'mais uma')).rejects.toMatchObject({ code: 'message_limit_reached' });
  });

  it('confirmar pelo botão cria o chamado uma única vez (idempotente)', async () => {
    const conv = ctx.service.currentConversation(ana);
    const draft = ctx.store.createDraft(conv.id, 0, {
      kind: 'create',
      ticketId: null,
      type: 'INC',
      title: 'VPN não conecta no notebook — erro 809',
      description: 'Windows 11, erro 809 desde ontem; reunião às 14h.',
      category: 'Rede e VPN',
      priority: 'high',
      priorityRule: 'Há um compromisso em risco no mesmo dia',
      dueAt: new Date().toISOString(),
      slaLabel: '4 horas úteis',
      affected: 'me',
      comment: null,
    });
    await ctx.service.confirmDraftByUser(ana, conv.id, draft.id);
    await ctx.service.confirmDraftByUser(ana, conv.id, draft.id);
    const vpn = (await ctx.client.listTickets(ana.email)).filter((t) => t.title.includes('erro 809'));
    expect(vpn).toHaveLength(1);
    const agentMsgs = ctx.store.listMessages(conv.id).filter((m) => m.role === 'agent');
    expect(agentMsgs[0]?.content).toMatch(/Pronto: abri o INC-/);
    expect(agentMsgs[0]?.trace?.action).toBe('confirmed_draft');
  });

  it('chamado crítico confirmado transfere automaticamente para o N2', async () => {
    const conv = ctx.service.currentConversation(ana);
    const draft = ctx.store.createDraft(conv.id, 0, {
      kind: 'create',
      ticketId: null,
      type: 'INC',
      title: 'Sistema de faturamento fora do ar',
      description: 'Ninguém da equipe Financeiro consegue faturar.',
      category: 'Software',
      priority: 'critical',
      priorityRule: 'Algo parado para uma equipe',
      dueAt: new Date().toISOString(),
      slaLabel: '1 hora',
      affected: 'team',
      comment: null,
    });
    await ctx.service.confirmDraftByUser(ana, conv.id, draft.id);
    const after = ctx.store.getConversation(conv.id)!;
    expect(after.status).toBe('waiting_human');
    expect(after.transfer).toMatchObject({ kind: 'critical', queue: 'N2' });
  });
});

describe('HelpdeskClient (legado instável)', () => {
  it('repete em 503 e se recupera', async () => {
    let n = 0;
    // Falha nas duas primeiras tentativas, responde na terceira.
    const { client } = inMemoryHelpdesk({ failureRate: 0.5, random: () => (n++ < 2 ? 0.1 : 0.9) });
    const tickets = await client.listTickets('ana.souza@nexo.com.br');
    expect(tickets.length).toBeGreaterThan(0);
  });

  it('desiste após as tentativas e sinaliza indisponibilidade', async () => {
    const { client } = inMemoryHelpdesk({ failureRate: 1 });
    await expect(client.listTickets('ana.souza@nexo.com.br')).rejects.toBeInstanceOf(HelpdeskUnavailableError);
  });
});
