import { eq } from 'drizzle-orm';
import { products } from '@mama-babi/db-schema';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { ApiResult, LabelTemplateSummary, Product } from '@shared/types';
import { invokeCloud } from '../cloud/client';
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

async function loadProductForLabel(productId: string): Promise<Product | null> {
  if (isCloudMode()) {
    const result = await invokeCloud(IPC_CHANNELS.PRODUCT_GET, [productId]) as ApiResult<Product>;
    return result.success && result.data ? result.data : null;
  }
  const row = getDb().select().from(products).where(eq(products.id, productId)).get();
  return row ?? null;
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
    const productCache = new Map<string, Product | null>();

    for (const item of input.items) {
      let product = productCache.get(item.productId);
      if (product === undefined) {
        product = await loadProductForLabel(item.productId);
        productCache.set(item.productId, product);
      }
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
      '| products found:', labelProducts.length,
      '| not found:', notFound.length,
      '| products:', labelProducts.map((p) => ({ sku: p.sku, barcode: p.barcode })));

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
