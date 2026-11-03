import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase } from './db.ts';
import { HelpdeskRepository } from './repository.ts';
import { seed } from './seed.ts';

const TOKEN = 'test-token';
const headers = { 'x-service-token': TOKEN };

function setup(failureRate = 0): FastifyInstance {
  const repo = new HelpdeskRepository(openDatabase(':memory:'));
  seed(repo);
  return buildApp({ repo, serviceToken: TOKEN, failureRate, maxLatencyMs: 0 });
}

describe('helpdesk (legado simulado)', () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = setup();
  });

  it('recusa chamadas sem token de serviço', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?requester=ana.souza@nexo.com.br' });
    expect(res.statusCode).toBe(401);
  });

  it('lista apenas os chamados do solicitante', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?requester=ana.souza@nexo.com.br', headers });
    const { tickets } = res.json() as { tickets: { requesterEmail: string }[] };
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((t) => t.requesterEmail === 'ana.souza@nexo.com.br')).toBe(true);
  });

  it('privacidade: chamado de outra pessoa responde 404, não 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/INC-20290?requester=ana.souza@nexo.com.br', headers });
    expect(res.statusCode).toBe(404);
  });

  it('idempotência: repetir a criação com a mesma chave não duplica', async () => {
    const payload = {
      requester: 'ana.souza@nexo.com.br',
      type: 'INC',
      title: 'VPN não conecta',
      description: 'Erro 809 no Windows 11',
      category: 'Rede e VPN',
      priority: 'high',
      affected: 'me',
    };
    const h = { ...headers, 'idempotency-key': 'draft-1' };
    const a = await app.inject({ method: 'POST', url: '/tickets', headers: h, payload });
    const b = await app.inject({ method: 'POST', url: '/tickets', headers: h, payload });
    expect(a.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    const list = await app.inject({ method: 'GET', url: '/tickets?requester=ana.souza@nexo.com.br', headers });
    expect((list.json() as { tickets: { title: string }[] }).tickets.filter((t) => t.title === 'VPN não conecta')).toHaveLength(1);
  });

  it('reabre chamado resolvido há 4 dias, mas não o de 2 meses', async () => {
    const body = { requester: 'ana.souza@nexo.com.br', author: 'Ana', text: 'Voltou a bloquear' };
    const ok = await app.inject({ method: 'POST', url: '/tickets/INC-20150/reopen', headers, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('waiting_analyst');
    const old = await app.inject({ method: 'POST', url: '/tickets/INC-19877/reopen', headers, payload: body });
    expect(old.statusCode).toBe(409);
  });

  it('busca na central de ajuda pelo código do erro', async () => {
    const res = await app.inject({ method: 'GET', url: `/kb/search?q=${encodeURIComponent('VPN não conecta, erro 809')}`, headers });
    const { results } = res.json() as { results: { article: { id: string } }[] };
    expect(results[0]?.article.id).toBe('KB-001');
  });

  it('simula indisponibilidade do legado', async () => {
    const flaky = setup(1);
    const res = await flaky.inject({ method: 'GET', url: '/tickets?requester=ana.souza@nexo.com.br', headers });
    expect(res.statusCode).toBe(503);
  });
});
