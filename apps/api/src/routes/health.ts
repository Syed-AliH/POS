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
      const raw = err instanceof Error ? err.message : 'Unknown database error';
      return {
        status: 'error',
        database: 'disconnected',
        // Driver errors can embed the whole connection string — strip the password.
        error: raw.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]*@/gi, '$1***@'),
      };
    }
  });
}
