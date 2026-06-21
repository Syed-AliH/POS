import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loginUser, verifyManagerRole } from '../services/auth.service';
import { logAuditEvent } from '../services/audit.service';
import { authenticate } from '../middleware/auth';
import type { AppConfig } from '../config';
import type { JwtUser } from '../types';

export async function authRoutes(app: FastifyInstance, config: AppConfig) {
  // Login — strict rate limit: 10 attempts per 15 min per IP
  app.post('/auth/login', {
    config: {
      rateLimit: {
        max: config.RATE_LIMIT_MAX_AUTH,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: 'Too many login attempts. Try again in 15 minutes.',
        }),
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      username: z.string().min(1).max(64).trim(),
      password: z.string().min(1).max(128),
    }).parse(request.body);

    const result = await loginUser(app.db, body.username, body.password);

    if (!result.success) {
      await logAuditEvent(app.db, {
        userId: null,
        module: 'auth',
        action: 'login_failed',
        recordId: body.username,
        ip: request.ip,
      });
      return reply.code(401).send(result);
    }

    await logAuditEvent(app.db, {
      userId: result.data.id,
      module: 'auth',
      action: 'login_success',
      ip: request.ip,
    });

    const token = await reply.jwtSign(result.data);
    return { success: true, data: { ...result.data, token } };
  });

  app.get('/auth/session', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as JwtUser;
    return { success: true, data: user };
  });

  app.post('/auth/logout', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as JwtUser;
    await logAuditEvent(app.db, {
      userId: user.id,
      module: 'auth',
      action: 'logout',
      ip: request.ip,
    });
    return { success: true, data: undefined };
  });

  app.post('/auth/verify-manager-pin', { preHandler: [authenticate] }, async (request) => {
    const user = request.user as JwtUser;
    return { success: true, data: verifyManagerRole(user) };
  });
}
