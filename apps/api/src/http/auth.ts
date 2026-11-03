import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginRequestSchema, type SessionUser } from '@nexo/shared';
import { HelpdeskRequestError, HelpdeskUnavailableError, type HelpdeskClient } from '../clients/helpdesk-client.ts';

export const SESSION_COOKIE = 'nexo_session';
const SESSION_HOURS = 8;
const REMEMBER_DAYS = 30;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionUser & { sub: string };
    user: SessionUser & { sub: string };
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify({ onlyCookie: true });
  } catch {
    return reply.code(401).send({ error: 'unauthenticated', message: 'Sessão expirada. Entre novamente.' });
  }
}

export function requireRole(role: SessionUser['role']) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireUser(req, reply);
    if (reply.sent) return;
    if (req.user.role !== role) return reply.code(403).send({ error: 'forbidden', message: 'Acesso não permitido para este perfil.' });
  };
}

export function sessionUser(req: FastifyRequest): SessionUser {
  const { email, name, department, role, supportLevel } = req.user;
  return { email, name, department, role, supportLevel };
}

/**
 * Login do desafio: aceita qualquer senha para os funcionários cadastrados
 * (requisito do PRD). Num ambiente real, isto seria SSO corporativo (OIDC).
 * A sessão é um JWT curto num cookie HttpOnly + SameSite — o front nunca vê o token.
 */
export function registerAuthRoutes(app: FastifyInstance, helpdesk: HelpdeskClient, secureCookies: boolean): void {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
    }
    const { email, remember } = parsed.data;
    if (!email.endsWith('@nexo.com.br')) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Use seu e-mail corporativo @nexo.com.br.' });
    }
    try {
      const employee = await helpdesk.getEmployee(email);
      const user: SessionUser = {
        email: employee.email,
        name: employee.name,
        department: employee.department,
        role: employee.role,
        supportLevel: employee.supportLevel,
      };
      const token = await reply.jwtSign({ ...user, sub: user.email }, { expiresIn: remember ? `${REMEMBER_DAYS}d` : `${SESSION_HOURS}h` });
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
        ...(remember ? { maxAge: REMEMBER_DAYS * 24 * 3600 } : {}),
      });
      return { user };
    } catch (err) {
      if (err instanceof HelpdeskRequestError && err.status === 404) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'E-mail não encontrado. Confira o endereço ou ligue no ramal 4000.' });
      }
      if (err instanceof HelpdeskUnavailableError) {
        return reply.code(503).send({ error: 'helpdesk_unavailable', message: 'O diretório de funcionários está instável. Tente de novo em instantes.' });
      }
      throw err;
    }
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => ({ user: sessionUser(req) }));
}
