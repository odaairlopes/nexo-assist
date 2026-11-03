import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CategorySchema, ImpactSchema, PrioritySchema, TicketTypeSchema } from '@nexo/shared';
import { ConflictError, NotFoundError, type HelpdeskRepository } from './repository.ts';

export interface AppOptions {
  repo: HelpdeskRepository;
  serviceToken: string;
  failureRate: number;
  maxLatencyMs: number;
  logger?: boolean;
  random?: () => number;
}

const RequesterQuery = z.object({ requester: z.string().email() });
const IdParam = z.object({ id: z.string().regex(/^(INC|REQ)-\d+$/i) });

const CreateBody = z.object({
  requester: z.string().email(),
  type: TicketTypeSchema,
  title: z.string().min(3).max(140),
  description: z.string().min(3).max(4000),
  category: CategorySchema,
  subcategory: z.string().max(60).nullable().default(null),
  priority: PrioritySchema,
  affected: ImpactSchema,
  queue: z.enum(['N1', 'N2']).default('N1'),
  author: z.string().default('Nexo Assist'),
});

const CommentBody = z.object({ requester: z.string().email(), author: z.string(), text: z.string().min(1).max(4000) });
const TransferBody = z.object({ requester: z.string().email(), queue: z.enum(['N1', 'N2']), summary: z.string().max(2000) });
const AssignBody = z.object({ requester: z.string().email(), analystName: z.string() });

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Simulador do sistema de chamados legado + central de ajuda.
 *
 * É um processo separado do agent de propósito: o agent só fala com ele por
 * HTTP (como falaria com um ServiceNow/GLPI real), então instabilidade,
 * latência e autorização ficam do lado de cá — e o agent precisa lidar com isso.
 */
export function buildApp(opts: AppOptions): FastifyInstance {
  const { repo } = opts;
  const random = opts.random ?? Math.random;
  const app = Fastify({ logger: opts.logger ?? false });

  // Autenticação serviço-a-serviço.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const token = req.headers['x-service-token'];
    if (typeof token !== 'string' || !safeEqual(token, opts.serviceToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // "De vez em quando fica indisponível por alguns segundos." — PRD.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (opts.maxLatencyMs > 0) await new Promise((r) => setTimeout(r, Math.floor(random() * opts.maxLatencyMs)));
    if (random() < opts.failureRate) {
      req.log.warn({ url: req.url }, 'falha simulada do legado');
      return reply.code(503).header('retry-after', '1').send({ error: 'service_unavailable' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', issues: err.issues });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  /** Repete a resposta de uma escrita já feita com a mesma Idempotency-Key. */
  function idempotent<T>(key: string | string[] | undefined, fn: () => T): T {
    if (typeof key !== 'string' || key.length === 0) return fn();
    const previous = repo.getIdempotent(key);
    if (previous !== undefined) return previous as T;
    const result = fn();
    repo.saveIdempotent(key, result);
    return result;
  }

  app.get('/health', async () => ({ ok: true }));

  app.get('/employees/:email', async (req, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.params);
    const employee = repo.getEmployee(email);
    if (!employee) return reply.code(404).send({ error: 'not_found' });
    return employee;
  });

  app.get('/tickets', async (req) => {
    const { requester } = RequesterQuery.parse(req.query);
    return { tickets: repo.listTickets(requester) };
  });

  app.get('/tickets/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const { requester } = RequesterQuery.parse(req.query);
    return repo.getTicket(id, requester);
  });

  app.post('/tickets', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const ticket = idempotent(req.headers['idempotency-key'], () => repo.createTicket(body.requester, body));
    return reply.code(201).send(ticket);
  });

  app.post('/tickets/:id/comments', async (req) => {
    const { id } = IdParam.parse(req.params);
    const body = CommentBody.parse(req.body);
    return idempotent(req.headers['idempotency-key'], () => repo.addComment(id, body.requester, body.author, body.text));
  });

  app.post('/tickets/:id/reopen', async (req) => {
    const { id } = IdParam.parse(req.params);
    const body = CommentBody.parse(req.body);
    return idempotent(req.headers['idempotency-key'], () => repo.reopen(id, body.requester, body.author, body.text));
  });

  app.post('/tickets/:id/transfer', async (req) => {
    const { id } = IdParam.parse(req.params);
    const body = TransferBody.parse(req.body);
    return idempotent(req.headers['idempotency-key'], () => repo.transfer(id, body.requester, body.queue, body.summary));
  });

  app.post('/tickets/:id/assign', async (req) => {
    const { id } = IdParam.parse(req.params);
    const body = AssignBody.parse(req.body);
    return repo.assign(id, body.requester, body.analystName);
  });

  app.get('/kb/search', async (req) => {
    const { q } = z.object({ q: z.string().min(1).max(500) }).parse(req.query);
    return { results: repo.searchArticles(q) };
  });

  app.get('/kb/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const article = repo.getArticle(id);
    if (!article) return reply.code(404).send({ error: 'not_found' });
    return article;
  });

  return app;
}
