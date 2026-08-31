import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppError, toErrorEnvelope } from '@frontdesk-q/contracts';
import type { TenantRepository } from '@frontdesk-q/tenant';
import { createTenantAuthenticator } from './tenant-auth.js';

export interface BuildAppOptions {
  tenantRepository: TenantRepository;
  bridgeTokenPepper: string;
  requireTenantHeader?: boolean;
  readinessCheck: () => Promise<boolean>;
  logger?: boolean | Record<string, unknown>;
}

const devCorsOrigins = new Set(['http://127.0.0.1:4173', 'http://localhost:4173']);

function safeId(v: unknown) {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return x && x.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(x) ? x : null;
}

function applyDevCors(req: any, reply: any) {
  if (process.env.APP_ENV === 'production') return;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && devCorsOrigins.has(origin)) {
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
  }
  reply.header(
    'access-control-allow-headers',
    'authorization, x-tenant-id, x-request-id, x-idempotency-key, content-type, accept',
  );
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
}

export function buildApp(o: BuildAppOptions) {
  const app = Fastify({
    logger: o.logger ?? {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: ['req.headers.authorization', '*.password', '*.token', '*.api_key'],
        censor: '[REDACTED]',
      },
    },
    genReqId: (req) => safeId(req.headers['x-request-id']) ?? randomUUID(),
  });

  app.decorateRequest('bridgePrincipal', null);

  const auth = createTenantAuthenticator({
    repository: o.tenantRepository,
    pepper: o.bridgeTokenPepper,
    requireTenantHeader: o.requireTenantHeader ?? true,
  });

  app.addHook('onRequest', async (req, reply) => {
    applyDevCors(req, reply);
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (path.startsWith('/v1/')) req.bridgePrincipal = await auth(req);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    applyDevCors(req, reply);
    reply.header('x-request-id', req.id);
    return payload;
  });

  app.get('/', async () => ({
    ok: true,
    service: 'frontdesk-q-bridge',
    status: 'alive',
    routes: ['/health', '/ready', '/v1/*'],
  }));

  app.get('/health', async () => ({ ok: true, service: 'frontdesk-q-bridge', status: 'alive' }));

  app.get('/ready', async (_req, reply) =>
    (await o.readinessCheck())
      ? { ok: true, service: 'frontdesk-q-bridge', status: 'ready' }
      : reply.code(503).send({ ok: false, service: 'frontdesk-q-bridge', status: 'not_ready' }),
  );

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError)
      return reply.code(err.httpStatus).send(toErrorEnvelope(err, req.id));
    if ((err as any).validation) {
      const e = new AppError(
        'VALIDATION_ERROR',
        'Request validation failed',
        422,
        false,
        'Some request fields are invalid.',
      );
      return reply.code(422).send(toErrorEnvelope(e, req.id));
    }
    req.log.error({ err, request_id: req.id }, 'Unhandled request error');
    const e = new AppError(
      'INTERNAL_ERROR',
      'Internal server error',
      500,
      false,
      'Something went wrong.',
    );
    return reply.code(500).send(toErrorEnvelope(e, req.id));
  });

  return app;
}
