import type { FastifyInstance } from 'fastify';
import { buildApp as buildHelpdesk } from '../../helpdesk/src/app.ts';
import { openDatabase } from '../../helpdesk/src/db.ts';
import { HelpdeskRepository } from '../../helpdesk/src/repository.ts';
import { seed } from '../../helpdesk/src/seed.ts';
import { HelpdeskClient } from './clients/helpdesk-client.ts';

const TOKEN = 'test-token';

/**
 * Sobe o helpdesk real em memória e devolve um HelpdeskClient que fala com ele
 * via `inject` (sem rede). Testa a integração de verdade, sem mocks frágeis.
 */
export function inMemoryHelpdesk(opts: { failureRate?: number; random?: () => number } = {}): {
  app: FastifyInstance;
  client: HelpdeskClient;
} {
  const repo = new HelpdeskRepository(openDatabase(':memory:'));
  seed(repo);
  const app = buildHelpdesk({
    repo,
    serviceToken: TOKEN,
    failureRate: opts.failureRate ?? 0,
    maxLatencyMs: 0,
    ...(opts.random ? { random: opts.random } : {}),
  });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.pathname + url.search,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = new HelpdeskClient({
    baseUrl: 'http://helpdesk.test',
    serviceToken: TOKEN,
    timeoutMs: 1000,
    retries: 3,
    fetchImpl,
    sleep: async () => {},
  });
  return { app, client };
}
