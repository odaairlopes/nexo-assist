import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DraftEditSchema, SendMessageSchema } from '@nexo/shared';
import type { ConversationService } from '../domain/conversation-service.ts';
import type { Store } from '../persistence/store.ts';
import type { EventBus } from '../realtime/event-bus.ts';
import { requireRole, requireUser, SESSION_COOKIE, sessionUser } from './auth.ts';
import { openSse } from './sse.ts';

interface RouteDeps {
  conversations: ConversationService;
  store: Store;
  bus: EventBus;
  messagesPerMinute: number;
}

const ConvParams = z.object({ id: z.string().uuid() });
const DraftParams = z.object({ id: z.string().uuid(), draftId: z.string().uuid() });

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { conversations, store, bus } = deps;
  const employeeOnly = { preHandler: requireRole('employee') };
  const analystOnly = { preHandler: requireRole('analyst') };

  // ---------- Funcionário ----------

  app.get('/api/chat/conversation', employeeOnly, async (req) => {
    const conv = conversations.currentConversation(sessionUser(req));
    return { conversation: conv, messages: store.listMessages(conv.id) };
  });

  app.post('/api/chat/conversations', employeeOnly, async (req) => {
    const conv = conversations.startNewConversation(sessionUser(req));
    return { conversation: conv, messages: [] };
  });

  app.post(
    '/api/chat/conversations/:id/messages',
    {
      preHandler: requireRole('employee'),
      config: {
        // Limite por usuário (não por IP): protege o custo de LLM.
        // O rate limit roda antes do preHandler, então lê a identidade do cookie direto.
        rateLimit: {
          max: deps.messagesPerMinute,
          timeWindow: '1 minute',
          keyGenerator: (req) => {
            try {
              return app.jwt.verify<{ email: string }>(req.cookies[SESSION_COOKIE] ?? '').email;
            } catch {
              return req.ip;
            }
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = ConvParams.parse(req.params);
      const { content } = SendMessageSchema.parse(req.body);
      const message = await conversations.postUserMessage(sessionUser(req), id, content);
      return reply.code(202).send({ message });
    },
  );

  app.post('/api/chat/conversations/:id/drafts/:draftId/confirm', employeeOnly, async (req) => {
    const { id, draftId } = DraftParams.parse(req.params);
    return { draft: await conversations.confirmDraftByUser(sessionUser(req), id, draftId) };
  });

  app.post('/api/chat/conversations/:id/drafts/:draftId/cancel', employeeOnly, async (req) => {
    const { id, draftId } = DraftParams.parse(req.params);
    return { draft: conversations.cancelDraft(sessionUser(req), id, draftId) };
  });

  app.patch('/api/chat/conversations/:id/drafts/:draftId', employeeOnly, async (req) => {
    const { id, draftId } = DraftParams.parse(req.params);
    const edit = DraftEditSchema.parse(req.body);
    return { draft: conversations.editDraft(sessionUser(req), id, draftId, edit) };
  });

  // ---------- Tempo real (funcionário dono ou analista) ----------

  app.get('/api/conversations/:id/events', { preHandler: requireUser }, async (req, reply) => {
    const { id } = ConvParams.parse(req.params);
    conversations.requireConversation(sessionUser(req), id);
    openSse(req, reply, (send) => bus.subscribe(id, send));
  });

  // ---------- Console do analista ----------

  app.get('/api/console/conversations', analystOnly, async () => ({ conversations: store.listConversations() }));

  app.get('/api/console/conversations/:id', analystOnly, async (req) => {
    const { id } = ConvParams.parse(req.params);
    const conversation = conversations.requireConversation(sessionUser(req), id);
    return { conversation, messages: store.listMessages(id) };
  });

  app.get('/api/console/conversations/:id/tickets', analystOnly, async (req) => {
    const { id } = ConvParams.parse(req.params);
    return { tickets: await conversations.employeeTickets(sessionUser(req), id) };
  });

  app.post('/api/console/conversations/:id/take', analystOnly, async (req) => {
    const { id } = ConvParams.parse(req.params);
    return { conversation: conversations.takeOver(sessionUser(req), id) };
  });

  app.post('/api/console/conversations/:id/return', analystOnly, async (req) => {
    const { id } = ConvParams.parse(req.params);
    return { conversation: conversations.returnToAgent(sessionUser(req), id) };
  });

  app.post('/api/console/conversations/:id/close', analystOnly, async (req) => {
    const { id } = ConvParams.parse(req.params);
    return { conversation: conversations.closeConversation(sessionUser(req), id) };
  });

  app.post('/api/console/conversations/:id/messages', analystOnly, async (req, reply) => {
    const { id } = ConvParams.parse(req.params);
    const { content } = SendMessageSchema.parse(req.body);
    return reply.code(201).send({ message: conversations.postAnalystMessage(sessionUser(req), id, content) });
  });

  app.get('/api/console/events', analystOnly, async (req, reply) => {
    openSse(req, reply, (send) => bus.subscribeConsole(send));
  });
}
