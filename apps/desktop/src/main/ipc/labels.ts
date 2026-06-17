import { eq } from 'drizzle-orm';
import { products } from '@mama-babi/db-schema';
import type { ApiResult, LabelTemplateSummary } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { listLabelTemplates, getLabelTemplateById } from '../services/labelTemplates';
import { printLabelsFromTemplate } from '../services/labelPrintTemplate';
import { normalizeBarcodeForPrint } from '@mama-babi/printer';

export function handleLabelTemplates(): ApiResult<LabelTemplateSummary[]> {
  try {
    requireRole('super_admin', 'manager');
    return { success: true, data: listLabelTemplates() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleLabelTemplateGet(id: string): ApiResult<LabelTemplateSummary> {
  try {
    requireRole('super_admin', 'manager');
    const template = getLabelTemplateById(id);
    if (!template) return { success: false, error: 'Template not found' };
    return { success: true, data: template };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Load failed' };
  }
}

export async function handleLabelPrintBatch(input: {
  templateId: string;
  items: Array<{ productId: string; copies: number }>;
}): Promise<ApiResult<{ printed: boolean; labelCount: number }>> {
  try {
    requireRole('super_admin', 'manager');
    if (!input.items.length) return { success: false, error: 'No products selected' };

    const template = getLabelTemplateById(input.templateId);
    if (!template) return { success: false, error: 'Template not found' };

    const db = getDb();
    const labelProducts: Array<{ name: string; sku: string; barcode: string; price: number }> = [];
    const notFound: string[] = [];

    for (const item of input.items) {
      const product = db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .get();
      if (!product) {
        notFound.push(item.productId);
        continue;
      }

      const copies = Math.max(1, item.copies);
      const labelProduct = {
        name: product.name,
        sku: product.sku,
        barcode: normalizeBarcodeForPrint(product.barcode ?? ''),
        price: product.salePrice ?? product.retailPrice,
      };
      for (let i = 0; i < copies; i++) {
        labelProducts.push({ ...labelProduct });
      }
    }

    console.log('[label:print-batch] items received:', input.items.length,
      '| products found:', labelProducts.length,
      '| not found:', notFound.length,
      '| products:', labelProducts.map((p) => ({ sku: p.sku, barcode: p.barcode })));

    if (!labelProducts.length) {
      return {
        success: false,
        error: notFound.length
          ? `Products not found in database (${notFound.length} IDs missing). Refresh the product list and try again.`
          : 'No valid products',
      };
    }

    const result = await printLabelsFromTemplate(input.templateId, labelProducts);
    logAudit('labels', 'print_batch', input.templateId, undefined, { labelCount: result.labelCount });
    return { success: true, data: result };
  } catch (e) {
    console.error('[label:print-batch] error:', e);
    return { success: false, error: e instanceof Error ? e.message : 'Print failed' };
  }
}
