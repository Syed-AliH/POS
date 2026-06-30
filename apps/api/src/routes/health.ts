import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'mama-babi-api',
    build: process.env.API_BUILD_STAMP ?? 'unknown',
    /** Bump when adding routes the desktop app depends on (used to detect stale local API). */
    capabilities: [
      'product-history',
      'returns',
      'owner-dashboard',
    ],
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/db', async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1 as ok`);
      return { status: 'ok', database: 'connected' };
    } catch (err) {
      reply.code(503);
      return {
        status: 'error',
        database: 'disconnected',
        error: err instanceof Error ? err.message : 'Unknown database error',
      };
    }
  });
}
