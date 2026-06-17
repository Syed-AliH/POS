import {
  DEFAULT_LABEL_ROLL_CONFIG,
  normalizeLabelRollConfig,
  resolveLabelLayoutForPrint,
  normalizeBarcodeForPrint,
  type LabelLayout,
  type LabelProduct,
} from '@mama-babi/printer';
import { useLabelDefaultsStore } from '@renderer/stores/labelDefaultsStore';
import type { LabelTemplateSummary, Product } from '@shared/types';

/** Pick saved template: last used → default → first. */
export function pickLabelTemplateId(
  templates: LabelTemplateSummary[],
  preferredId?: string | null,
): string {
  const preferred = preferredId ?? useLabelDefaultsStore.getState().lastTemplateId;
  if (preferred && templates.some((t) => t.id === preferred)) return preferred;
  return templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '';
}

/** Normalize template layout + roll config from DB (same rules as print batch). */
export function normalizeLabelTemplate(
  template: LabelTemplateSummary,
  storeName?: string,
): LabelTemplateSummary {
  const rawLayout = template.layout ?? {};
  const elements = Array.isArray(rawLayout.elements) ? rawLayout.elements : undefined;
  const layout = resolveLabelLayoutForPrint(
    elements ? { ...rawLayout, elements } : rawLayout,
    storeName,
  );
  return {
    ...template,
    layout,
    rollConfig: normalizeLabelRollConfig(template.rollConfig ?? DEFAULT_LABEL_ROLL_CONFIG),
  };
}

/** Layout for preview/print — matches `handleLabelPrintBatch` store name resolution. */
export function resolveLabelLayoutForPreview(
  template: LabelTemplateSummary,
  storeNameFromSettings?: string,
): LabelLayout {
  return resolveLabelLayoutForPrint(template.layout, storeNameFromSettings);
}

export function productToLabelProduct(
  product: Pick<Product, 'name' | 'sku' | 'barcode' | 'salePrice' | 'retailPrice'>,
): LabelProduct {
  return {
    name: product.name,
    sku: product.sku,
    barcode: normalizeBarcodeForPrint(product.barcode),
    price: product.salePrice ?? product.retailPrice,
  };
}

/** Expand GRN line items into label row order (one entry per printed label). */
export function expandGrnLabelProducts(
  items: Array<{
    productId: string;
    productName: string;
    productSku: string;
    qty: number;
    unitRetail: number;
  }>,
  products: Product[],
): LabelProduct[] {
  const result: LabelProduct[] = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    const labelProduct: LabelProduct = {
      name: item.productName || product?.name || 'Product',
      sku: item.productSku || product?.sku || '',
      barcode: normalizeBarcodeForPrint(product?.barcode ?? ''),
      price: item.unitRetail ?? product?.salePrice ?? product?.retailPrice ?? 0,
    };
    const copies = Math.max(1, item.qty);
    for (let i = 0; i < copies; i++) result.push({ ...labelProduct });
  }
  return result;
}

/** Expand product selection into label row order (one entry per printed label). */
export function expandLabelPrintProducts(
  products: Product[],
  items: Array<{ productId: string; copies: number }>,
): LabelProduct[] {
  const result: LabelProduct[] = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    const labelProduct = productToLabelProduct(product);
    const copies = Math.max(1, item.copies);
    for (let i = 0; i < copies; i++) result.push({ ...labelProduct });
  }
  return result;
}
