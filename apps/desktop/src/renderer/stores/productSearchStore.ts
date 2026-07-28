import { create } from 'zustand';
import type { SearchProduct } from '@shared/types';
import { getApi } from '@renderer/lib/api';

/**
 * The catalogue the till searches against, held in the renderer so typing costs no
 * network at all. Loaded once (main caches it too), refreshed on demand, and kept
 * roughly current by applying the stock change of each sale.
 *
 * Stock here is advisory — the authoritative check happens when the sale is saved.
 */
interface ProductSearchState {
  products: SearchProduct[];
  byId: Map<string, SearchProduct>;
  byBarcode: Map<string, SearchProduct>;
  bySku: Map<string, SearchProduct>;
  /** Lowercased names, index-aligned with `products`, so search avoids re-lowercasing. */
  namesLower: string[];
  loaded: boolean;
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
  applySold: (items: Array<{ productId: string; quantity: number }>) => void;
  stockOf: (productId: string, fallback?: number) => number;
}

function index(products: SearchProduct[]) {
  const byId = new Map<string, SearchProduct>();
  const byBarcode = new Map<string, SearchProduct>();
  const bySku = new Map<string, SearchProduct>();
  const namesLower: string[] = new Array(products.length);
  for (let i = 0; i < products.length; i += 1) {
    const p = products[i]!;
    byId.set(p.id, p);
    if (p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p);
    bySku.set(p.sku.trim().toLowerCase(), p);
    namesLower[i] = p.name.toLowerCase();
  }
  return { byId, byBarcode, bySku, namesLower };
}

export const useProductSearchStore = create<ProductSearchState>((set, get) => ({
  products: [],
  byId: new Map(),
  byBarcode: new Map(),
  bySku: new Map(),
  namesLower: [],
  loaded: false,
  loading: false,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const result = await getApi().products.searchPayload(force);
      if (result.success && result.data) {
        const products = result.data.products;
        set({ products, ...index(products), loaded: true });
      }
    } finally {
      set({ loading: false });
    }
  },

  applySold: (items) => {
    const { byId } = get();
    let changed = false;
    for (const { productId, quantity } of items) {
      const product = byId.get(productId);
      if (product) {
        product.stockQty -= quantity;
        changed = true;
      }
    }
    // Mutating in place keeps the Maps valid; bump the array identity so views update.
    if (changed) set((s) => ({ products: [...s.products] }));
  },

  stockOf: (productId, fallback = 0) => get().byId.get(productId)?.stockQty ?? fallback,
}));

/** Case-insensitive substring match over name, sku and barcode. */
export function searchCachedProducts(term: string, limit = 30): SearchProduct[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const { products, namesLower } = useProductSearchStore.getState();
  const out: SearchProduct[] = [];
  for (let i = 0; i < products.length && out.length < limit; i += 1) {
    const p = products[i]!;
    if (
      namesLower[i]!.includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    ) {
      out.push(p);
    }
  }
  return out;
}

export function findCachedByBarcode(code: string): SearchProduct | undefined {
  const key = code.trim().toLowerCase();
  const { byBarcode, bySku } = useProductSearchStore.getState();
  return byBarcode.get(key) ?? bySku.get(key);
}
