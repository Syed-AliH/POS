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

  app.get('/owner/products', { preHandler: ownerOnly }, async (request, reply) => {
    const query = request.query as { search?: string; limit?: string };
    // Prices move rarely; a short private cache makes repeat lookups feel instant.
    reply.header('Cache-Control', 'private, max-age=30');
    return reports.searchOwnerProducts(app.db, {
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
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

  // Goods received notes — read-only here; editing stays in the POS app.
  app.get('/owner/grns', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as {
      id?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      limit?: string;
    };
    // ?id=… returns the detail, matching the single serverless route the portal calls
    // when it runs on Vercel.
    if (query.id) return reports.getOwnerGrn(app.db, query.id);
    return reports.listOwnerGrns(app.db, {
      search: query.search,
      startDate: query.startDate,
      endDate: query.endDate,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.get('/owner/grns/:id', { preHandler: ownerOnly }, async (request) => {
    const { id } = request.params as { id: string };
    return reports.getOwnerGrn(app.db, id);
  });

  // Saved label templates, so the portal prints with the same design as the POS.
  app.get('/owner/label-templates', { preHandler: ownerOnly }, async (_request, reply) => {
    reply.header('Cache-Control', 'private, max-age=60');
    return reports.listOwnerLabelTemplates(app.db);
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
