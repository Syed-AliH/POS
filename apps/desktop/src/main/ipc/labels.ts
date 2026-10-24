import { inArray } from 'drizzle-orm';
import { products } from '@mama-babi/db-schema';
import type { ApiResult, LabelTemplateSummary, Product } from '@shared/types';
import { fetchCloudProductsByIds } from '../cloud/client';
import { isCloudMode } from '../cloud/config';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { listLabelTemplates, getLabelTemplateById } from '../services/labelTemplates';
import { printLabelsFromTemplate } from '../services/labelPrintTemplate';
import { normalizeBarcodeForPrint } from '@mama-babi/printer';

type LabelPrintProduct = {
  name: string;
  sku: string;
  barcode: string;
  price: number;
  originalPrice?: number;
};

/**
 * All the products a batch needs, in one round trip. In cloud mode this used to be one
 * sequential HTTP request per GRN line, so a large GRN spent most of its "printing"
 * time just looking products up before the printer received anything.
 */
async function loadProductsForLabels(productIds: string[]): Promise<Map<string, Product>> {
  const unique = [...new Set(productIds)];
  if (!unique.length) return new Map();
  if (isCloudMode()) {
    const result = await fetchCloudProductsByIds(unique);
    if (!result.success) throw new Error(result.error);
    return new Map((result.data ?? []).map((p) => [p.id, p]));
  }
  const rows = getDb().select().from(products).where(inArray(products.id, unique)).all();
  return new Map(rows.map((p) => [p.id, p as Product]));
}

function toLabelPrintProduct(product: Product): LabelPrintProduct {
  const price = product.salePrice ?? product.retailPrice;
  return {
    name: product.name,
    sku: product.sku,
    barcode: normalizeBarcodeForPrint(product.barcode ?? ''),
    price,
    // Retail is the was-price and sale price is what the customer pays, so a sale
    // template can strike one through. Absent unless the product is really marked down;
    // templates without a was-price field ignore it.
    originalPrice: product.retailPrice > price ? product.retailPrice : undefined,
  };
}

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

    const labelProducts: LabelPrintProduct[] = [];
    const notFound: string[] = [];
    const productsById = await loadProductsForLabels(input.items.map((i) => i.productId));

    for (const item of input.items) {
      const product = productsById.get(item.productId);
      if (!product) {
        notFound.push(item.productId);
        continue;
      }

      const copies = Math.max(1, item.copies);
      const labelProduct = toLabelPrintProduct(product);
      for (let i = 0; i < copies; i++) {
        labelProducts.push({ ...labelProduct });
      }
    }

    console.log('[label:print-batch] items received:', input.items.length,
      '| labels:', labelProducts.length,
      '| not found:', notFound.length);

    if (!labelProducts.length) {
      return {
        success: false,
        error: notFound.length
          ? `Products not found (${notFound.length} missing). Refresh the product list and try again.`
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
