import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { createAgentChain } from './agent/nexo-agent.ts';
import { AgentTurnRunner } from './agent/turn-runner.ts';
import { HelpdeskClient } from './clients/helpdesk-client.ts';
import type { AppConfig } from './config.ts';
import { ConversationService, type TurnRunner } from './domain/conversation-service.ts';
import { DomainError, STATUS_BY_CODE } from './domain/errors.ts';
import { registerAuthRoutes, SESSION_COOKIE } from './http/auth.ts';
import { registerRoutes } from './http/routes.ts';
import { Store } from './persistence/store.ts';
import { EventBus } from './realtime/event-bus.ts';

export interface BuildOptions {
  config: AppConfig;
  /** Substitui o agent real (testes). */
  runnerFactory?: (deps: { conversations: ConversationService; store: Store; bus: EventBus; helpdesk: HelpdeskClient }) => TurnRunner;
  helpdesk?: HelpdeskClient;
  store?: Store;
  logger?: boolean;
  /** Pasta com o build do front, servida em produção. */
  staticDir?: string;
}

/**
 * Composition root: monta as dependências uma vez e injeta nas camadas.
 * Interface (rotas) → domínio (ConversationService) → agent/serviços externos.
 */
export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; conversations: ConversationService; store: Store }> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.isProduction ? 'info' : 'info', redact: ['req.headers.cookie'] },
    trustProxy: config.isProduction,
  });

  const store = opts.store ?? new Store(config.dbPath);
  const bus = new EventBus();
  const helpdesk =
    opts.helpdesk ??
    new HelpdeskClient({
      ...config.helpdesk,
      onRetry: (info) => app.log.warn(info, 'legado instável: nova tentativa'),
    });
  const conversations = new ConversationService(store, bus, helpdesk, app.log);

  const runner =
    opts.runnerFactory?.({ conversations, store, bus, helpdesk }) ??
    new AgentTurnRunner({
      agents: createAgentChain(config.llm, { helpdesk, store, conversations }),
      store,
      bus,
      conversations,
      helpdesk,
      llm: config.llm,
      minConfidence: config.agent.minConfidence,
      log: app.log,
    });
  conversations.attachRunner(runner);

  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) return reply.code(STATUS_BY_CODE[err.code]).send({ error: err.code, message: err.message });
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_request', message: err.issues[0]?.message ?? 'Dados inválidos', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.' });
    if (status && status < 500) return reply.code(status).send({ error: 'request_error', message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Algo deu errado do nosso lado. Tente de novo.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  registerAuthRoutes(app, helpdesk, config.isProduction);
  registerRoutes(app, { conversations, store, bus, messagesPerMinute: config.rateLimit.messagesPerMinute });

  // Em produção a própria API serve o front (um único processo para deploy).
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    const index = fs.readFileSync(path.join(opts.staticDir, 'index.html'));
    const types: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
    };
    app.get('/*', async (req, reply) => {
      const urlPath = decodeURIComponent((req.params as { '*': string })['*'] ?? '');
      const file = path.resolve(opts.staticDir!, urlPath);
      if (file.startsWith(path.resolve(opts.staticDir!)) && urlPath && fs.existsSync(file) && fs.statSync(file).isFile()) {
        reply.header('cache-control', urlPath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        return reply.type(types[path.extname(file)] ?? 'application/octet-stream').send(fs.readFileSync(file));
      }
      return reply.type('text/html').header('cache-control', 'no-cache').send(index);
    });
  }

  return { app, conversations, store };
}
