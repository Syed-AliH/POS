import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { AppConfig } from './config';
import { jwtSignOptions } from './config';
import { registerDatabase } from './plugins/database';
import { registerRoutes } from './routes';

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization'],
    },
    trustProxy: true,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.ip,
  });

  // ── JWT ───────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: jwtSignOptions(config.JWT_EXPIRES_IN),
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(422).send({
        success: false,
        error: 'Validation failed',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      const detail = (err as { detail?: string }).detail;
      return reply.code(409).send({
        success: false,
        error: detail ?? 'Duplicate value — this record already exists',
      });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({ success: false, error: 'Too many requests. Try again later.' });
    }
    app.log.error({ err }, 'Unhandled error');
    const code = statusCode ?? 500;
    const message = (err as Error).message ?? 'Internal server error';
    return reply.code(code).send({
      success: false,
      error: config.NODE_ENV === 'production' ? 'Internal server error' : message,
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ success: false, error: 'Not found' });
  });

  // ── Database + routes ─────────────────────────────────────────────────────
  await registerDatabase(app, config);
  await registerRoutes(app, config);

  return app;
}
