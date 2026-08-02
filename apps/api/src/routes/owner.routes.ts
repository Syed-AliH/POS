import type { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../middleware/auth';
import * as reports from '../services/reports.service';
import * as eodReports from '../services/eodReports.service';

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

  // End of Day reports submitted by POS terminals — admin viewing only.
  app.get('/owner/eod-reports', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { startDate?: string; endDate?: string; limit?: string };
    return eodReports.listEodReports(app.db, {
      startDate: query.startDate,
      endDate: query.endDate,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.get('/owner/eod-reports/:id', { preHandler: ownerOnly }, async (request) => {
    const { id } = request.params as { id: string };
    return eodReports.getEodReport(app.db, id);
  });
}
