import { eq } from 'drizzle-orm';
import { products } from '@mama-babi/db-schema';
import type { ApiResult, LabelTemplateSummary } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { listLabelTemplates } from '../services/labelTemplates';
import { printLabelsBatch } from '../services/labelPrinter';

export function handleLabelTemplates(): ApiResult<LabelTemplateSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    return { success: true, data: listLabelTemplates() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export async function handleLabelPrintBatch(input: {
  templateId: string;
  items: Array<{ productId: string; copies: number }>;
}): Promise<ApiResult<{ printed: boolean; labelCount: number }>> {
  try {
    requireRole('super_admin', 'manager');
    if (!input.items.length) return { success: false, error: 'No products selected' };

    const templates = listLabelTemplates();
    const template = templates.find((t) => t.id === input.templateId);
    if (!template) return { success: false, error: 'Template not found' };

    const db = getDb();
    const labelProducts = [];

    for (const item of input.items) {
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .get();
      if (!product) continue;

      const copies = Math.max(1, item.copies);
      for (let i = 0; i < copies; i++) {
        labelProducts.push({
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          price: product.salePrice ?? product.retailPrice,
        });
      }
    }

    if (!labelProducts.length) return { success: false, error: 'No valid products' };

    const result = await printLabelsBatch(labelProducts, template.layout, template.widthMm);
    logAudit('labels', 'print_batch', input.templateId, undefined, { labelCount: result.labelCount });
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
  }
}
