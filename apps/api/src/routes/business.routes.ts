import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth';
import { getAllSettings, getSetting, setSetting } from '../services/settings.service';
import { logAuditEvent } from '../services/audit.service';
import * as products from '../services/products.service';
import * as vendors from '../services/vendors.service';
import * as grn from '../services/grn.service';
import * as sales from '../services/sales.service';
import * as returns from '../services/returns.service';
import * as reports from '../services/reports.service';
import * as customers from '../services/customers.service';
import * as templates from '../services/templates.service';
import * as promoCodes from '../services/promoCodes.service';
import * as eodReports from '../services/eodReports.service';
import type { JwtUser } from '../types';

const manager = [authenticate, requireRoles('super_admin', 'manager')];
const anyUser = [authenticate, requireRoles('super_admin', 'manager', 'cashier')];

export async function businessRoutes(app: FastifyInstance) {
  // ── Settings ────────────────────────────────────────────────────────────
  app.get('/settings', { preHandler: anyUser }, async () => {
    const data = await getAllSettings(app.db);
    return { success: true, data };
  });

  app.get('/settings/:key', { preHandler: anyUser }, async (request) => {
    const { key } = request.params as { key: string };
    const data = await getSetting(app.db, key);
    return { success: true, data };
  });

  app.patch('/settings', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.record(z.string()).parse(request.body);
    for (const [key, value] of Object.entries(body)) {
      await setSetting(app.db, key, value);
    }
    await logAuditEvent(app.db, {
      userId: user.id,
      module: 'settings',
      action: 'update',
      newValue: JSON.stringify(body),
      ip: request.ip,
    });
    const data = await getAllSettings(app.db);
    return { success: true, data };
  });

  // Products
  app.get('/products/search', { preHandler: anyUser }, async (request) => {
    const { q } = request.query as { q?: string };
    return products.searchProducts(app.db, q ?? '');
  });

  // Slim catalogue for the till's local search cache.
  app.get('/products/search-payload', { preHandler: anyUser }, async () => {
    return products.getProductSearchPayload(app.db);
  });

  app.post('/products/search/advanced', { preHandler: anyUser }, async (request) => {
    const body = z.object({
      sku: z.string().optional(),
      master: z.string().optional(),
      refine: z.string().optional(),
    }).parse(request.body);
    return products.advancedSearchProducts(app.db, body);
  });

  app.get('/products', { preHandler: anyUser }, async (request) => {
    const query = request.query as { status?: string; limit?: string };
    return products.listProducts(app.db, {
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.get('/products/barcode/:code', { preHandler: anyUser }, async (request) => {
    const { code } = request.params as { code: string };
    return products.barcodeLookup(app.db, code);
  });

  app.get('/products/:id/history', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return products.getProductHistory(app.db, id);
  });

  app.get('/products/:id', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return products.getProduct(app.db, id);
  });

  app.post('/products', { preHandler: manager }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      sku: z.string().optional(),
      barcode: z.string().optional(),
      categoryId: z.string().optional(),
      brandId: z.string().optional(),
      vendorId: z.string().optional(),
      costPrice: z.number().optional(),
      retailPrice: z.number().optional(),
      salePrice: z.number().optional(),
      taxRate: z.number().optional(),
      stockQty: z.number().optional(),
      reorderLevel: z.number().optional(),
      description: z.string().optional(),
    }).parse(request.body);
    return products.createProduct(app.db, body);
  });

  app.post('/products/import', { preHandler: manager }, async (request) => {
    const body = z.object({
      rows: z.array(z.object({
        name: z.string().min(1),
        category: z.string().min(1),
        cost_price: z.number().optional(),
        retail_price: z.number().positive(),
        sale_price: z.number().optional(),
      })).min(1),
    }).parse(request.body);
    return products.importProductRows(app.db, body.rows);
  });

  app.patch('/products/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return products.updateProduct(app.db, id, body as Parameters<typeof products.updateProduct>[2]);
  });

  app.post('/products/bulk-price-increase', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      percent: z.number(),
      productIds: z.array(z.string()).optional(),
      categoryIds: z.array(z.string()).optional(),
      applyToAll: z.boolean().optional(),
    }).parse(request.body);
    const result = await products.bulkIncreasePrice(app.db, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'products',
        action: 'bulk-price-increase',
        newValue: JSON.stringify(body),
        ip: request.ip,
      });
    }
    return result;
  });

  app.post('/products/bulk-price-revert', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      mode: z.enum(['original', 'last']),
      productIds: z.array(z.string()).optional(),
      categoryIds: z.array(z.string()).optional(),
      applyToAll: z.boolean().optional(),
    }).parse(request.body);
    const result = await products.bulkRevertPrice(app.db, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'products',
        action: 'bulk-price-revert',
        newValue: JSON.stringify(body),
        ip: request.ip,
      });
    }
    return result;
  });

  // Categories
  app.get('/categories', { preHandler: anyUser }, async () => products.listCategories(app.db));

  app.post('/categories', { preHandler: manager }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      color: z.string().optional(),
      skuPrefix: z.string().optional(),
    }).parse(request.body);
    return products.createCategory(app.db, body.name, body.color, body.skuPrefix);
  });

  app.patch('/categories/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      color: z.string().optional(),
      skuPrefix: z.string().optional(),
    }).parse(request.body);
    return products.updateCategory(app.db, id, body);
  });

  // Vendors
  app.get('/vendors', { preHandler: manager }, async () => vendors.listVendors(app.db));

  app.post('/vendors', { preHandler: manager }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      contact: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      paymentTerms: z.string().optional(),
    }).parse(request.body);
    return vendors.createVendor(app.db, body);
  });

  app.patch('/vendors/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return vendors.updateVendor(app.db, id, request.body as Parameters<typeof vendors.updateVendor>[2]);
  });

  // GRN
  app.get('/grn', { preHandler: manager }, async (request) => {
    const q = request.query as Record<string, string | undefined>;
    return grn.listGrns(app.db, {
      status: q.status,
      vendorId: q.vendorId,
      grnNumber: q.grnNumber,
      startDate: q.startDate,
      endDate: q.endDate,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
  });

  app.get('/grn/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return grn.getGrn(app.db, id);
  });

  app.post('/grn', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = request.body as Parameters<typeof grn.createGrn>[2];
    return grn.createGrn(app.db, user.id, body);
  });

  app.patch('/grn/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return grn.updateGrn(app.db, id, request.body as Parameters<typeof grn.updateGrn>[2]);
  });

  app.post('/grn/:id/finalize', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const result = await grn.finalizeGrn(app.db, id);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'grn',
        action: 'finalize',
        recordId: id,
        ip: request.ip,
      });
    }
    return result;
  });

  app.post('/grn/:id/cancel', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const result = await grn.cancelGrn(app.db, id);
    if (result.success) {
      await logAuditEvent(app.db, { userId: user.id, module: 'grn', action: 'cancel', recordId: id, ip: request.ip });
    }
    return result;
  });

  app.post('/grn/:id/void', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const result = await grn.voidGrn(app.db, id);
    if (result.success) {
      await logAuditEvent(app.db, { userId: user.id, module: 'grn', action: 'void', recordId: id, ip: request.ip });
    }
    return result;
  });

  // ── Sales ────────────────────────────────────────────────────────────────
  app.post('/sales', { preHandler: anyUser }, async (request) => {
    const user = request.user as JwtUser;
    const result = await sales.createSale(app.db, user.id, request.body as Parameters<typeof sales.createSale>[2]);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'sales',
        action: 'create',
        recordId: result.data?.id,
        ip: request.ip,
      });
    }
    return result;
  });

  app.get('/sales', { preHandler: anyUser }, async (request) => {
    const q = request.query as {
      status?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };
    return sales.listSales(app.db, {
      status: q.status,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      search: q.search,
      startDate: q.startDate,
      endDate: q.endDate,
    });
  });

  app.get('/sales/lookup/:saleNumber', { preHandler: anyUser }, async (request) => {
    const { saleNumber } = request.params as { saleNumber: string };
    return sales.lookupSaleByNumber(app.db, decodeURIComponent(saleNumber));
  });

  app.get('/sales/:id/receipt-preview', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return sales.getSaleReceiptPreview(app.db, id);
  });

  app.get('/sales/:id', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return sales.getSale(app.db, id);
  });

  app.patch('/sales/:id', { preHandler: anyUser }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const body = request.body as Omit<Parameters<typeof sales.updateSale>[1], 'saleId'>;
    const result = await sales.updateSale(app.db, { ...body, saleId: id });
    if (result.success) {
      await logAuditEvent(app.db, { userId: user.id, module: 'sales', action: 'update', recordId: id, ip: request.ip });
    }
    return result;
  });

  app.post('/sales/:id/void', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const result = await sales.voidSale(app.db, id);
    if (result.success) {
      await logAuditEvent(app.db, { userId: user.id, module: 'sales', action: 'void', recordId: id, ip: request.ip });
    }
    return result;
  });

  app.post('/sales/:id/discard-held', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return sales.discardHeldSale(app.db, id);
  });

  app.get('/sales/resume/:heldKey', { preHandler: anyUser }, async (request) => {
    const { heldKey } = request.params as { heldKey: string };
    return sales.resumeHeldSale(app.db, heldKey);
  });

  app.get('/returns', { preHandler: anyUser }, async (request) => {
    const q = request.query as { limit?: string; startDate?: string; endDate?: string };
    return returns.listReturns(app.db, {
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      startDate: q.startDate,
      endDate: q.endDate,
    });
  });

  app.post('/returns', { preHandler: anyUser }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      saleNumber: z.string().min(1),
      reason: z.string().min(1),
      refundMethod: z.enum(['cash', 'store_credit', 'loyalty']),
      items: z.array(z.object({
        saleItemId: z.string().min(1),
        qtyReturned: z.number().int().positive(),
        restocked: z.boolean().optional(),
      })).min(1),
    }).parse(request.body);
    const result = await returns.createReturn(app.db, user.id, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'returns',
        action: 'create',
        recordId: result.data.id,
        ip: request.ip,
      });
    }
    return result;
  });

  app.get('/reports/daily-sales', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string };
    return reports.getDailySales(app.db, { startDate: q.startDate, endDate: q.endDate });
  });

  app.get('/reports/eod', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string };
    return reports.getEodReport(app.db, { startDate: q.startDate, endDate: q.endDate });
  });

  app.get('/reports/sales-by-category', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string };
    return reports.getSalesByCategory(app.db, { startDate: q.startDate, endDate: q.endDate });
  });

  app.get('/reports/top-products', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string; limit?: string };
    return reports.getTopProducts(app.db, {
      startDate: q.startDate,
      endDate: q.endDate,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
  });

  app.get('/reports/payment-breakdown', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string };
    return reports.getPaymentBreakdown(app.db, { startDate: q.startDate, endDate: q.endDate });
  });

  app.get('/reports/inventory-valuation', { preHandler: manager }, async () => {
    return reports.getInventoryValuation(app.db);
  });

  app.get('/reports/profit', { preHandler: manager }, async (request) => {
    const q = request.query as { startDate?: string; endDate?: string };
    return reports.getProfitReport(app.db, {
      startDate: q.startDate,
      endDate: q.endDate,
    });
  });

  app.get('/reports/inventory', { preHandler: manager }, async (request) => {
    const q = request.query as {
      search?: string;
      categoryId?: string;
      stockFilter?: 'all' | 'negative' | 'zero' | 'low';
    };
    return reports.getInventoryReport(app.db, {
      search: q.search,
      categoryId: q.categoryId,
      stockFilter: q.stockFilter,
    });
  });

  // ── Promo codes ───────────────────────────────────────────────────────────
  const promoCodeBody = z.object({
    code: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['percent', 'fixed']),
    value: z.number().positive(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    minPurchase: z.number().optional(),
    productIds: z.array(z.string()).optional(),
    categoryIds: z.array(z.string()).optional(),
    usageLimit: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  });

  app.get('/promo-codes', { preHandler: manager }, async () => promoCodes.listPromoCodes(app.db));

  app.post('/promo-codes', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = promoCodeBody.parse(request.body);
    const result = await promoCodes.createPromoCode(app.db, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'promo_codes',
        action: 'create',
        recordId: result.data.id,
        newValue: JSON.stringify(body),
        ip: request.ip,
      });
    }
    return result;
  });

  app.patch('/promo-codes/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    const body = promoCodeBody.partial().parse(request.body);
    return promoCodes.updatePromoCode(app.db, id, body);
  });

  app.delete('/promo-codes/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return promoCodes.deletePromoCode(app.db, id);
  });

  app.post('/promo-codes/validate', { preHandler: anyUser }, async (request) => {
    const body = z.object({
      code: z.string().min(1),
      subtotal: z.number(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        categoryId: z.string().nullable().optional(),
      })),
    }).parse(request.body);
    return promoCodes.validatePromoCode(app.db, body);
  });

  app.post('/promo-codes/:id/redeem', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return promoCodes.redeemPromoCode(app.db, id);
  });

  // ── End of Day reports (submitted by POS, viewed by admin on owner portal) ──
  app.post('/eod-reports', { preHandler: anyUser }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      reportDate: z.string().min(1),
      storeName: z.string().optional(),
      cashierName: z.string().optional(),
      openingCash: z.number(),
      cardPayments: z.number(),
      onlinePayments: z.number(),
      totalCashCount: z.number(),
      totalExpenses: z.number(),
      dailySales: z.number(),
      pdfBase64: z.string().min(1),
    }).parse(request.body);
    const result = await eodReports.createEodReport(app.db, { id: user.id, name: user.name }, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'eod_reports',
        action: 'create',
        recordId: result.data.id,
        ip: request.ip,
      });
    }
    return result;
  });

  // Customers
  app.get('/customers/search', { preHandler: anyUser }, async (request) => {
    const { q } = request.query as { q?: string };
    return customers.searchCustomers(app.db, q ?? '');
  });

  app.get('/customers', { preHandler: manager }, async (request) => {
    const { limit } = request.query as { limit?: string };
    return customers.listCustomers(app.db, limit ? parseInt(limit, 10) : 50);
  });

  app.get('/customers/:id', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return customers.getCustomer(app.db, id);
  });

  app.post('/customers', { preHandler: anyUser }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
      loyaltyPoints: z.number().int().min(0).optional(),
    }).parse(request.body);
    const result = await customers.createCustomer(app.db, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'customers',
        action: 'create',
        recordId: result.data.id,
        ip: request.ip,
      });
    }
    return result;
  });

  app.patch('/customers/:id', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
      loyaltyPoints: z.number().int().min(0).optional(),
    }).parse(request.body);
    const result = await customers.updateCustomer(app.db, id, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'customers',
        action: 'update',
        recordId: id,
        ip: request.ip,
      });
    }
    return result;
  });

  app.get('/loyalty-rules', { preHandler: anyUser }, async () =>
    customers.listLoyaltyRules(app.db));

  app.put('/loyalty-rules', { preHandler: manager }, async (request) => {
    const user = request.user as JwtUser;
    const body = z.object({
      spendThreshold: z.number().positive(),
      pointsAwarded: z.number().int().min(0),
      redemptionRate: z.number().positive().optional(),
    }).parse(request.body);
    const result = await customers.saveLoyaltyRule(app.db, body);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: user.id,
        module: 'customers',
        action: 'loyalty_rule_update',
        recordId: result.data.id,
        newValue: JSON.stringify(body),
        ip: request.ip,
      });
    }
    return result;
  });

  // Receipt & label designs (shared across all POS machines)
  app.get('/receipt-templates', { preHandler: manager }, async () =>
    templates.listReceiptTemplates(app.db));

  app.patch('/receipt-templates/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return templates.updateReceiptTemplate(app.db, id, request.body as Parameters<typeof templates.updateReceiptTemplate>[2]);
  });

  app.get('/label-templates', { preHandler: manager }, async () =>
    templates.listLabelTemplates(app.db));

  app.get('/label-templates/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return templates.getLabelTemplate(app.db, id);
  });

  app.patch('/label-templates/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return templates.updateLabelTemplate(app.db, id, request.body as Parameters<typeof templates.updateLabelTemplate>[2]);
  });

  app.post('/label-templates', { preHandler: manager }, async (request) => {
    return templates.createLabelTemplate(app.db, request.body as Parameters<typeof templates.createLabelTemplate>[1]);
  });

  app.delete('/label-templates/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return templates.deleteLabelTemplate(app.db, id);
  });

  app.post('/label-templates/:id/set-default', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    return templates.setDefaultLabelTemplate(app.db, id);
  });
}
