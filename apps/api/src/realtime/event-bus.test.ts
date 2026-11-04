import { describe, expect, it } from 'vitest';
import type { ServerEvent, SessionUser } from '@nexo/shared';
import { ConversationService } from '../domain/conversation-service.ts';
import { Store } from '../persistence/store.ts';
import { inMemoryHelpdesk } from '../test-utils.ts';
import { EventBus } from './event-bus.ts';

const ana: SessionUser = { email: 'ana.souza@nexo.com.br', name: 'Ana Souza', department: 'Financeiro', role: 'employee', supportLevel: null };
const rafael: SessionUser = { email: 'rafael.lima@nexo.com.br', name: 'Rafael Lima', department: 'TI', role: 'analyst', supportLevel: 'N2' };
const julia: SessionUser = { email: 'julia.costa@nexo.com.br', name: 'Júlia Costa', department: 'TI', role: 'analyst', supportLevel: 'N1' };

function setup() {
  const bus = new EventBus();
  const store = new Store(':memory:');
  const { client } = inMemoryHelpdesk();
  const service = new ConversationService(store, bus, client, { error: () => {}, warn: () => {} });
  service.attachRunner({ run: async () => {} });
  const consoleEvents: ServerEvent[] = [];
  bus.subscribeConsole((e) => consoleEvents.push(e));
  return { bus, store, service, consoleEvents };
}

describe('presença', () => {
  it('fica online com a primeira conexão e offline só quando todas fecham', () => {
    const { bus, consoleEvents } = setup();
    const aba1 = bus.connect(ana.email);
    const aba2 = bus.connect(ana.email);
    expect(bus.isOnline(ana.email)).toBe(true);
    aba1();
    aba1(); // fechar duas vezes não conta em dobro
    expect(bus.isOnline(ana.email)).toBe(true);
    aba2();
    expect(bus.isOnline(ana.email)).toBe(false);
    expect(consoleEvents.filter((e) => e.type === 'presence')).toEqual([
      { type: 'presence', email: ana.email, online: true },
      { type: 'presence', email: ana.email, online: false },
    ]);
  });

  it('a visão da conversa reflete a presença do funcionário', () => {
    const { bus, service } = setup();
    const conv = service.currentConversation(ana);
    expect(service.requireConversation(rafael, conv.id).employeeOnline).toBe(false);
    const leave = bus.connect(ana.email);
    expect(service.listForConsole()[0]?.employeeOnline).toBe(true);
    leave();
  });
});

describe('digitando', () => {
  it('funcionário digitando chega ao console', () => {
    const { service, consoleEvents } = setup();
    const conv = service.currentConversation(ana);
    service.notifyTyping(ana, conv.id);
    expect(consoleEvents).toContainEqual({ type: 'typing', conversationId: conv.id, role: 'user', name: 'Ana Souza' });
  });

  it('só o analista que está atendendo emite "digitando" para o funcionário', async () => {
    const { bus, service } = setup();
    const conv = service.currentConversation(ana);
    const seen: ServerEvent[] = [];
    bus.subscribe(conv.id, (e) => seen.push(e));
    service.notifyTyping(rafael, conv.id); // ainda não assumiu
    await service.transfer(conv.id, { kind: 'requested', reason: 'x', summary: 'pediu analista', ticketId: null, confidence: null });
    service.takeOver(rafael, conv.id);
    service.notifyTyping(julia, conv.id); // não é a responsável
    service.notifyTyping(rafael, conv.id);
    expect(seen.filter((e) => e.type === 'typing')).toEqual([{ type: 'typing', conversationId: conv.id, role: 'analyst', name: 'Rafael Lima' }]);
  });
});

describe('não lidas', () => {
  it('conta as mensagens do funcionário ainda sem resposta', async () => {
    const { service, store } = setup();
    const conv = service.currentConversation(ana);
    await service.transfer(conv.id, { kind: 'requested', reason: 'x', summary: 'pediu analista', ticketId: null, confidence: null });
    await service.postUserMessage(ana, conv.id, 'Está parado há 5 dias.');
    await service.postUserMessage(ana, conv.id, 'Quero falar com um analista.');
    expect(store.getConversation(conv.id)?.pendingUserMessages).toBe(2);
    service.takeOver(rafael, conv.id);
    service.postAnalystMessage(rafael, conv.id, 'Oi, Ana!');
    expect(store.getConversation(conv.id)?.pendingUserMessages).toBe(0);
  });
});
