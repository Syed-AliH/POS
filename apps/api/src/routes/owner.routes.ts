import type { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../middleware/auth';
import * as reports from '../services/reports.service';

const ownerOnly = [authenticate, requireRoles('super_admin', 'manager')];

export async function ownerRoutes(app: FastifyInstance) {
  app.get('/owner/dashboard', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { startDate?: string; endDate?: string };
    return reports.getOwnerDashboard(app.db, query);
  });

  app.get('/owner/sales', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as {
      startDate?: string;
      endDate?: string;
      limit?: string;
      search?: string;
    };
    return reports.listOwnerSales(app.db, {
      startDate: query.startDate,
      endDate: query.endDate,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      search: query.search,
    });
  });

  app.get('/owner/top-products', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { startDate?: string; endDate?: string; limit?: string };
    return reports.getTopProducts(app.db, {
      startDate: query.startDate,
      endDate: query.endDate,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });
}
