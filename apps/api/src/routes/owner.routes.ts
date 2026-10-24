import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth';
import * as reports from '../services/reports.service';
import * as eodReports from '../services/eodReports.service';
import * as expenses from '../services/expenses.service';
import * as products from '../services/products.service';
import type { JwtUser } from '../types';

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

  // Served by api/v1/owner/products.ts on Vercel; without this the Products tab 500s
  // in local dev (VITE_API_URL points the portal here).
  app.get('/owner/products', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { search?: string; limit?: string };
    return products.getOwnerProducts(app.db, {
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.get('/owner/sales-trend', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { startDate?: string; endDate?: string };
    return reports.getSalesTrend(app.db, query);
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

  // ── Cash expenses ──────────────────────────────────────────────────────
  app.get('/owner/expense-categories', { preHandler: ownerOnly }, async () => {
    return expenses.listExpenseCategories(app.db);
  });

  app.get('/owner/expenses', { preHandler: ownerOnly }, async (request) => {
    const query = request.query as { startDate?: string; endDate?: string; limit?: string };
    return expenses.listOwnerExpenses(app.db, {
      startDate: query.startDate,
      endDate: query.endDate,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.post('/owner/expenses', { preHandler: ownerOnly }, async (request) => {
    const user = request.user as JwtUser;
    const body = z
      .object({
        categoryId: z.string().min(1),
        amount: z.number(),
        notes: z.string().optional(),
        expenseDate: z.string().optional(),
      })
      .parse(request.body);
    return expenses.createExpense(app.db, { id: user.id, name: user.name, role: user.role }, body);
  });

  // Owner corrections — served by api/v1/owner/[...path].ts on Vercel.
  app.patch('/owner/expenses/:id', { preHandler: ownerOnly }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const body = z
      .object({
        categoryId: z.string().min(1).optional(),
        amount: z.number().optional(),
        notes: z.string().nullable().optional(),
        expenseDate: z.string().optional(),
      })
      .parse(request.body);
    return expenses.updateExpense(app.db, { id: user.id, name: user.name, role: user.role }, id, body);
  });

  app.delete('/owner/expenses/:id', { preHandler: ownerOnly }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    return expenses.deleteExpense(app.db, { id: user.id, name: user.name, role: user.role }, id);
  });
}
