import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { filterProductsByAdvancedSearch } from '@shared/productSearch';
import { useProductSearchStore } from '@renderer/stores/productSearchStore';
import { Modal } from './Modal';
import type { Product, SearchProduct } from '@shared/types';

/** Cached search rows padded out to the Product shape the picker renders. */
function toProductLike(p: SearchProduct): Product {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    categoryId: p.categoryId,
    brandId: null,
    vendorId: null,
    costPrice: 0,
    retailPrice: p.retailPrice,
    salePrice: p.salePrice,
    taxRate: p.taxRate,
    stockQty: p.stockQty,
    reorderLevel: 0,
    status: 'active',
    imagePath: null,
    description: null,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
  /** When provided, shows available stock (on hand minus cart) instead of raw stockQty */
  getAvailableStock?: (productId: string, fallbackStock: number) => number;
}

export function ProductSearchModal({ open, onClose, onSelect, getAvailableStock }: Props) {
  const [sku, setSku] = useState('');
  const [master, setMaster] = useState('');
  const [refine, setRefine] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const loading = useProductSearchStore((s) => s.loading);
  const [sortKey, setSortKey] = useState<'name' | 'price'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const masterRef = useRef<HTMLInputElement>(null);

  const sortedResults = useMemo(() => {
    const rows = [...results];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else cmp = (a.salePrice ?? a.retailPrice) - (b.salePrice ?? b.retailPrice);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [results, sortKey, sortDir]);

  const toggleSort = (key: 'name' | 'price') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setSelectedIdx(0);
  };

  const sortIcon = (key: 'name' | 'price') => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const catalogue = useProductSearchStore((s) => s.products);
  const loadCatalogue = useProductSearchStore((s) => s.load);

  useEffect(() => {
    if (open) void loadCatalogue();
  }, [open, loadCatalogue]);

  // Filtered in memory against the cached catalogue — instant, no request per keystroke.
  const search = useCallback(() => {
    const filters = {
      sku: sku.trim() || undefined,
      master: master.trim() || undefined,
      refine: refine.trim() || undefined,
    };
    setResults(filterProductsByAdvancedSearch(catalogue, filters).map(toProductLike));
    setSelectedIdx(0);
  }, [sku, master, refine, catalogue]);

  useEffect(() => {
    if (open) {
      setSku('');
      setMaster('');
      setRefine('');
      setResults([]);
      setSelectedIdx(0);
      setSortKey('name');
      setSortDir('asc');
      setTimeout(() => masterRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search();
  }, [search, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, sortedResults.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && sortedResults[selectedIdx]) {
        e.preventDefault();
        onSelect(sortedResults[selectedIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sortedResults, selectedIdx, onSelect, onClose]);

  return (
    <Modal
      open={open}
      title="Product Search (F1)"
      onClose={onClose}
      panelClassName="w-[92vw] max-w-[960px] h-[85vh] max-h-[820px]"
      bodyClassName="flex flex-col min-h-0"
      footer={<Button variant="ghost" onClick={onClose}>Close (Esc)</Button>}
    >
      <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
        <div>
          <label className="text-xs font-medium text-slate-500">SKU / Barcode</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Exact or prefix" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Master search</label>
          <input ref={masterRef} value={master} onChange={(e) => setMaster(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Name starts with…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Refine</label>
          <input value={refine} onChange={(e) => setRefine(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Narrow by another word…" />
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-2 shrink-0">Master: name starts with · Refine: any word starts with (e.g. "Baby Suit Q4" → Master B, Refine S or Q) · ↑↓ Enter add · Esc close</p>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <button type="button" onClick={() => toggleSort('name')} className="text-left hover:text-primary-700">
            Product Name{sortIcon('name')}
          </button>
          <button type="button" onClick={() => toggleSort('price')} className="text-right hover:text-primary-700 min-w-[80px]">
            Price{sortIcon('price')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="h-full flex items-center justify-center text-slate-400">Searching…</div>}
          {!loading && sortedResults.length === 0 && <div className="h-full flex items-center justify-center text-slate-400">No products found</div>}
          {sortedResults.map((p, i) => {
            const available = getAvailableStock ? getAvailableStock(p.id, p.stockQty) : p.stockQty;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className={`flex w-full items-center justify-between border-b px-4 py-2 text-left last:border-b-0 dark:border-slate-800 ${i === selectedIdx ? 'bg-primary-50 dark:bg-primary-950' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                  <div className={`text-xs ${available < 0 ? 'text-red-600 font-medium' : available <= 0 ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                    {p.sku} · {available < 0 ? `Stock: ${available}` : available === 0 ? 'No stock on hand' : `Available: ${available}`}
                  </div>
                </div>
                <div className="font-semibold shrink-0 ml-4">PKR {(p.salePrice ?? p.retailPrice).toFixed(0)}</div>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
