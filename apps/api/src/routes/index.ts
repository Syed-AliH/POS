import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import { healthRoutes } from './health';
import { authRoutes } from './auth.routes';
import { businessRoutes } from './business.routes';
import { userRoutes } from './users.routes';

export async function registerRoutes(app: FastifyInstance, config: AppConfig) {
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(
    async (instance) => authRoutes(instance, config),
    { prefix: '/api/v1' },
  );
  await app.register(businessRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
}
