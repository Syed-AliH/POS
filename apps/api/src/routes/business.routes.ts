import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth';
import { getAllSettings, getSetting, setSetting } from '../services/settings.service';
import { logAuditEvent } from '../services/audit.service';
import * as products from '../services/products.service';
import * as vendors from '../services/vendors.service';
import * as grn from '../services/grn.service';
import * as sales from '../services/sales.service';
import * as templates from '../services/templates.service';
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

  app.patch('/products/:id', { preHandler: manager }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return products.updateProduct(app.db, id, body as Parameters<typeof products.updateProduct>[2]);
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
    const q = request.query as { status?: string; limit?: string; search?: string };
    return sales.listSales(app.db, {
      status: q.status,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      search: q.search,
    });
  });

  app.get('/sales/:id', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return sales.getSale(app.db, id);
  });

  app.post('/sales/:id/discard-held', { preHandler: anyUser }, async (request) => {
    const { id } = request.params as { id: string };
    return sales.discardHeldSale(app.db, id);
  });

  app.get('/sales/resume/:heldKey', { preHandler: anyUser }, async (request) => {
    const { heldKey } = request.params as { heldKey: string };
    return sales.resumeHeldSale(app.db, heldKey);
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
