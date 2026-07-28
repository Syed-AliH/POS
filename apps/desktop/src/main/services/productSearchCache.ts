import { and, eq } from 'drizzle-orm';
import { products } from '@mama-babi/db-schema';
import type { ApiResult, SearchProduct, SearchPayload } from '@shared/types';
import { getDb } from '../db';
import { isCloudMode } from '../cloud/config';
import { apiFetch } from '../cloud/client';

/**
 * The catalogue the till searches against, held in memory in the main process.
 *
 * Search used to be one request per keystroke — ~120ms each against a remote database.
 * The slim catalogue is fetched once, searched locally in the renderer, and kept
 * current by applying the stock deltas of each sale rather than refetching.
 */
const TTL_MS = 5 * 60_000;

let cache: { at: number; payload: SearchPayload } | null = null;
let inflight: Promise<ApiResult<SearchPayload>> | null = null;

function loadLocal(): SearchPayload {
  const db = getDb();
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      retailPrice: products.retailPrice,
      salePrice: products.salePrice,
      taxRate: products.taxRate,
      stockQty: products.stockQty,
      categoryId: products.categoryId,
    })
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
    .all();
  return { version: String(Date.now()), count: rows.length, products: rows as SearchProduct[] };
}

export async function getProductSearchPayload(force = false): Promise<ApiResult<SearchPayload>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return { success: true, data: cache.payload };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      if (isCloudMode()) {
        const result = await apiFetch<SearchPayload>('GET', '/api/v1/products/search-payload');
        if (result.success && result.data) cache = { at: Date.now(), payload: result.data };
        return result;
      }
      const payload = loadLocal();
      cache = { at: Date.now(), payload };
      return { success: true as const, data: payload };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : 'Product load failed' };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Drops the cache so the next read refetches — call after any catalogue write. */
export function invalidateProductSearchCache(): void {
  cache = null;
}

/**
 * Applies stock movements in place after a sale/return/GRN, so the till sees correct
 * numbers without re-downloading the catalogue. Cached stock is advisory only — the
 * authoritative check still happens server-side when the sale is written.
 */
export function applyStockDeltas(deltas: Array<{ productId: string; delta: number }>): void {
  if (!cache) return;
  const byId = new Map(cache.payload.products.map((p) => [p.id, p]));
  for (const { productId, delta } of deltas) {
    const product = byId.get(productId);
    if (product) product.stockQty += delta;
  }
}
