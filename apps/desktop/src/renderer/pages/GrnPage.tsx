import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { Modal } from '@renderer/components/Modal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import { parseMarkupInput, resolveMarkupToPrice } from '@renderer/lib/markup';
import { getActiveRoute, registerPageShortcuts } from '@renderer/lib/shortcuts';
import { toast } from '@renderer/stores/toastStore';
import { formatDateOnly, formatDateTime } from '@shared/datetime';
import type { GrnPaymentType, GrnSummary, Product, Vendor } from '@shared/types';

type GrnDraftLine = {
  productId: string;
  productName: string;
  productSku: string;
  qty: number;
  unitCost: number;
  unitRetail: number;
  retailInput: string;
};

const api = getApi();
const GRN_ROUTE = '/grn';

type Tab = 'create' | 'records';
type LineSortKey = 'product' | 'qty' | 'cost' | 'retail' | 'margin' | 'total';

function lineMarginPct(unitCost: number, unitRetail: number): number {
  if (unitRetail <= 0) return 0;
  return ((unitRetail - unitCost) / unitRetail) * 100;
}

function lineRetailPrice(line: GrnDraftLine): number {
  return parseMarkupInput(line.retailInput, line.unitCost) ?? line.unitRetail;
}

function grnItemsToDraftLines(items: GrnSummary['items']): GrnDraftLine[] {
  return items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    productSku: item.productSku,
    qty: item.qty,
    unitCost: item.unitCost,
    unitRetail: item.unitRetail,
    retailInput: String(item.unitRetail),
  }));
}

function sortDraftLines(
  rows: Array<{
    idx: number;
    line: GrnDraftLine;
    productName: string;
    retail: number;
    margin: number;
    total: number;
  }>,
  lineSortKey: LineSortKey,
  lineSortDir: 'asc' | 'desc',
) {
  rows.sort((a, b) => {
    let cmp = 0;
    if (lineSortKey === 'product') cmp = a.productName.localeCompare(b.productName);
    else if (lineSortKey === 'qty') cmp = a.line.qty - b.line.qty;
    else if (lineSortKey === 'cost') cmp = a.line.unitCost - b.line.unitCost;
    else if (lineSortKey === 'retail') cmp = a.retail - b.retail;
    else if (lineSortKey === 'margin') cmp = a.margin - b.margin;
    else if (lineSortKey === 'total') cmp = a.total - b.total;
    return lineSortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

export function GrnPage() {
  const [tab, setTab] = useState<Tab>('create');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [records, setRecords] = useState<GrnSummary[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [paymentType, setPaymentType] = useState<GrnPaymentType>('cash');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<GrnDraftLine[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterGrn, setFilterGrn] = useState('');
  const [selectedGrn, setSelectedGrn] = useState<GrnSummary | null>(null);
  const [editingRecord, setEditingRecord] = useState<GrnSummary | null>(null);
  const [editVendorId, setEditVendorId] = useState('');
  const [editPaymentType, setEditPaymentType] = useState<GrnPaymentType>('cash');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editLines, setEditLines] = useState<GrnDraftLine[]>([]);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [showRecordProductSearch, setShowRecordProductSearch] = useState(false);
  const [updatingRecord, setUpdatingRecord] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [printLabelsOpen, setPrintLabelsOpen] = useState(false);
  const [labelTemplateId, setLabelTemplateId] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [lineSortKey, setLineSortKey] = useState<LineSortKey>('product');
  const [lineSortDir, setLineSortDir] = useState<'asc' | 'desc'>('asc');
  const [editLineSortKey, setEditLineSortKey] = useState<LineSortKey>('product');
  const [editLineSortDir, setEditLineSortDir] = useState<'asc' | 'desc'>('asc');
  const recordDetailRef = useRef<HTMLDivElement>(null);

  const linesTotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.unitCost, 0), [lines]);

  const sortedLines = useMemo(() => {
    const rows = lines.map((line, idx) => {
      const product = products.find((x) => x.id === line.productId);
      const retail = lineRetailPrice(line);
      return {
        idx,
        line,
        productName: line.productName || product?.name || 'Unknown product',
        productSku: line.productSku || product?.sku || '',
        retail,
        margin: lineMarginPct(line.unitCost, retail),
        total: line.qty * line.unitCost,
      };
    });
    return sortDraftLines(rows, lineSortKey, lineSortDir);
  }, [lines, products, lineSortKey, lineSortDir]);

  const editLinesTotal = useMemo(() => editLines.reduce((s, l) => s + l.qty * l.unitCost, 0), [editLines]);

  const sortedEditLines = useMemo(() => {
    const rows = editLines.map((line, idx) => {
      const product = products.find((x) => x.id === line.productId);
      const fromRecord = editingRecord?.items.find((i) => i.productId === line.productId);
      const retail = lineRetailPrice(line);
      return {
        idx,
        line,
        productName: line.productName || product?.name || fromRecord?.productName || 'Unknown product',
        productSku: line.productSku || product?.sku || fromRecord?.productSku || '',
        retail,
        margin: lineMarginPct(line.unitCost, retail),
        total: line.qty * line.unitCost,
      };
    });
    return sortDraftLines(rows, editLineSortKey, editLineSortDir);
  }, [editLines, products, editingRecord, editLineSortKey, editLineSortDir]);

  const toggleLineSort = (key: LineSortKey) => {
    if (lineSortKey === key) setLineSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setLineSortKey(key);
      setLineSortDir('asc');
    }
  };

  const lineSortIcon = (key: LineSortKey) =>
    lineSortKey === key ? (lineSortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const applyVendorPaymentPreference = (id: string, setter: (value: GrnPaymentType) => void) => {
    const vendor = vendors.find((v) => v.id === id);
    setter(vendor?.preferredPaymentType ?? 'cash');
  };

  const loadBase = async () => {
    const [v, p, t] = await Promise.all([
      api.vendors.list(),
      api.products.list({ status: 'active', limit: 500 }),
      api.labels.templates(),
    ]);
    if (v.success) {
      setVendors(v.data ?? []);
      if (v.data?.[0] && !vendorId) setVendorId(v.data[0].id);
    }
    if (p.success) setProducts(p.data ?? []);
    if (t.success && t.data?.[0]) setLabelTemplateId(t.data[0].id);
  };

  const loadRecords = async () => {
    const result = await api.grn.list({
      vendorId: filterVendor || undefined,
      startDate: filterStart || undefined,
      endDate: filterEnd || undefined,
      grnNumber: filterGrn || undefined,
      limit: 50,
    });
    if (result.success) setRecords(result.data ?? []);
  };

  useEffect(() => { loadBase(); }, []);

  useEffect(() => {
    if (vendorId) applyVendorPaymentPreference(vendorId, setPaymentType);
  }, [vendorId, vendors]);
  useEffect(() => { if (tab === 'records') loadRecords(); }, [tab, filterVendor, filterStart, filterEnd, filterGrn]);

  const canEditRecord = editingRecord?.status === 'draft' || editingRecord?.status === 'finalized';

  useEffect(() => {
    const handlers: Record<string, () => void> = {};
    if (tab === 'create') {
      handlers.F1 = () => setShowProductSearch(true);
    } else if (tab === 'records' && canEditRecord) {
      handlers.F1 = () => setShowRecordProductSearch(true);
    }
    return registerPageShortcuts(GRN_ROUTE, handlers);
  }, [tab, canEditRecord]);

  useEffect(() => {
    const openProductSearch = () => {
      if (getActiveRoute() !== GRN_ROUTE) return;
      if (tab === 'create') setShowProductSearch(true);
      else if (canEditRecord) setShowRecordProductSearch(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return;
      if (getActiveRoute() !== GRN_ROUTE) return;
      e.preventDefault();
      e.stopPropagation();
      openProductSearch();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tab, canEditRecord]);

  const addLine = (product: Product) => {
    setLines((prev) => {
      if (prev.some((l) => l.productId === product.id)) {
        toast.warning(`${product.name} is already on this GRN`);
        return prev;
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          qty: 1,
          unitCost: product.costPrice,
          unitRetail: product.retailPrice,
          retailInput: String(product.retailPrice),
        },
      ];
    });
    setProductSearch('');
    toast.success(`Added: ${product.name}`);
  };

  const updateLine = (idx: number, patch: Partial<GrnDraftLine>) => {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx], ...patch };
      if (patch.unitCost != null && line.retailInput.includes('%')) {
        const resolved = parseMarkupInput(line.retailInput, line.unitCost);
        if (resolved != null) {
          line.unitRetail = resolved;
          line.retailInput = String(resolved);
        }
      }
      next[idx] = line;
      return next;
    });
  };

  const handleRetailBlur = (idx: number) => {
    setLines((prev) => {
      const line = prev[idx];
      if (!line) return prev;
      if (!line.retailInput.includes('%')) {
        const parsed = parseFloat(line.retailInput);
        if (isNaN(parsed)) return prev;
        const next = [...prev];
        next[idx] = { ...line, unitRetail: parsed, retailInput: String(parsed) };
        return next;
      }
      const resolved = resolveMarkupToPrice(line.retailInput, line.unitCost);
      const unitRetail = parseFloat(resolved) || line.unitRetail;
      const next = [...prev];
      next[idx] = { ...line, retailInput: resolved, unitRetail };
      return next;
    });
  };

  const mapLinesToItems = (rows: GrnDraftLine[]) => rows.map((l) => ({
    productId: l.productId,
    qty: l.qty,
    unitCost: l.unitCost,
    unitRetail: lineRetailPrice(l),
  }));

  const resetCreateForm = () => {
    setLines([]);
    setInvoiceNumber('');
    setNotes('');
    if (vendorId) applyVendorPaymentPreference(vendorId, setPaymentType);
  };

  const refreshProducts = () => {
    api.products.list({ status: 'active', limit: 500 }).then((r) => {
      if (r.success) setProducts(r.data ?? []);
    });
  };

  const persistEditingDraft = async (id: string): Promise<GrnSummary | null> => {
    if (editingRecord?.id !== id || editingRecord.status !== 'draft') return editingRecord;
    if (!editVendorId) {
      toast.error('Vendor required');
      return null;
    }
    if (!editLines.length) {
      toast.error('Add at least one product');
      return null;
    }
    const result = await api.grn.update(id, {
      vendorId: editVendorId,
      paymentType: editPaymentType,
      invoiceNumber: editInvoiceNumber || undefined,
      notes: editNotes || undefined,
      items: mapLinesToItems(editLines),
    });
    if (!result.success || !result.data) {
      toast.error(result.error ?? 'Failed to save GRN before finalize');
      return null;
    }
    loadRecordIntoEditor(result.data);
    return result.data;
  };

  const handleSaveDraft = async () => {
    if (!vendorId) { toast.error('Vendor required'); return; }
    if (!lines.length) { toast.error('Add at least one product'); return; }
    setSavingDraft(true);
    const result = await api.grn.create({
      vendorId,
      paymentType,
      invoiceNumber: invoiceNumber || undefined,
      notes: notes || undefined,
      items: mapLinesToItems(lines),
    });
    setSavingDraft(false);
    if (result.success) {
      toast.success(`GRN draft saved: ${result.data?.grnNumber}`);
      resetCreateForm();
      setTab('records');
      loadRecords();
    } else toast.error(result.error ?? 'Save failed');
  };

  const handleFinalizeNew = async () => {
    if (!vendorId) { toast.error('Vendor required'); return; }
    if (!lines.length) { toast.error('Add at least one product'); return; }
    setFinalizing(true);
    const createResult = await api.grn.create({
      vendorId,
      paymentType,
      invoiceNumber: invoiceNumber || undefined,
      notes: notes || undefined,
      items: mapLinesToItems(lines),
    });
    if (!createResult.success || !createResult.data) {
      setFinalizing(false);
      toast.error(createResult.error ?? 'Create failed');
      return;
    }
    const finalizeResult = await api.grn.finalize(createResult.data.id);
    setFinalizing(false);
    if (finalizeResult.success && finalizeResult.data) {
      toast.success(`GRN finalized: ${finalizeResult.data.grnNumber}`);
      resetCreateForm();
      setSelectedGrn(finalizeResult.data);
      setPrintLabelsOpen(true);
      setTab('records');
      loadRecords();
      refreshProducts();
    } else {
      toast.error(finalizeResult.error ?? 'Finalize failed');
      setTab('records');
      loadRecords();
      if (createResult.data) selectRecord(createResult.data);
    }
  };

  const loadRecordIntoEditor = (grn: GrnSummary) => {
    setEditingRecord(grn);
    setEditVendorId(grn.vendorId);
    setEditPaymentType(grn.paymentType ?? 'cash');
    setEditInvoiceNumber(grn.invoiceNumber ?? '');
    setEditNotes(grn.notes ?? '');
    setEditLines(grnItemsToDraftLines(grn.items));
    setEditProductSearch('');
  };

  const selectRecord = async (g: GrnSummary) => {
    loadRecordIntoEditor(g);
    requestAnimationFrame(() => {
      recordDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const result = await api.grn.get(g.id);
    if (result.success && result.data) {
      loadRecordIntoEditor(result.data);
    } else if (!result.success) {
      toast.error(result.error ?? 'Failed to refresh GRN');
    }
  };

  const updateEditLine = (idx: number, patch: Partial<GrnDraftLine>) => {
    setEditLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx], ...patch };
      if (patch.unitCost != null && line.retailInput.includes('%')) {
        const resolved = parseMarkupInput(line.retailInput, line.unitCost);
        if (resolved != null) {
          line.unitRetail = resolved;
          line.retailInput = String(resolved);
        }
      }
      next[idx] = line;
      return next;
    });
  };

  const handleEditRetailBlur = (idx: number) => {
    setEditLines((prev) => {
      const line = prev[idx];
      if (!line) return prev;
      if (!line.retailInput.includes('%')) {
        const parsed = parseFloat(line.retailInput);
        if (isNaN(parsed)) return prev;
        const next = [...prev];
        next[idx] = { ...line, unitRetail: parsed, retailInput: String(parsed) };
        return next;
      }
      const resolved = resolveMarkupToPrice(line.retailInput, line.unitCost);
      const unitRetail = parseFloat(resolved) || line.unitRetail;
      const next = [...prev];
      next[idx] = { ...line, retailInput: resolved, unitRetail };
      return next;
    });
  };

  const addEditLine = (product: Product) => {
    setEditLines((prev) => {
      if (prev.some((l) => l.productId === product.id)) {
        toast.warning(`${product.name} is already on this GRN`);
        return prev;
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          qty: 1,
          unitCost: product.costPrice,
          unitRetail: product.retailPrice,
          retailInput: String(product.retailPrice),
        },
      ];
    });
    setEditProductSearch('');
    toast.success(`Added: ${product.name}`);
  };

  const handleUpdateRecord = async () => {
    if (!editingRecord || !canEditRecord) return;
    if (!editVendorId) { toast.error('Vendor required'); return; }
    if (!editLines.length) { toast.error('Add at least one product'); return; }
    setUpdatingRecord(true);
    const result = await api.grn.update(editingRecord.id, {
      vendorId: editVendorId,
      paymentType: editPaymentType,
      invoiceNumber: editInvoiceNumber || undefined,
      notes: editNotes || undefined,
      items: mapLinesToItems(editLines),
    });
    setUpdatingRecord(false);
    if (result.success && result.data) {
      toast.success(`GRN updated: ${result.data.grnNumber}`);
      loadRecordIntoEditor(result.data);
      loadRecords();
      refreshProducts();
    } else toast.error(result.error ?? 'Update failed');
  };

  const handleFinalize = async (id: string) => {
    setFinalizing(true);
    if (editingRecord?.id === id && editingRecord.status === 'draft') {
      const saved = await persistEditingDraft(id);
      if (!saved) {
        setFinalizing(false);
        return;
      }
    }
    const result = await api.grn.finalize(id);
    setFinalizing(false);
    if (result.success) {
      toast.success(`GRN finalized: ${result.data?.grnNumber}`);
      setSelectedGrn(result.data ?? null);
      setPrintLabelsOpen(true);
      if (result.data && editingRecord?.id === id) loadRecordIntoEditor(result.data);
      loadRecords();
      refreshProducts();
    } else toast.error(result.error ?? 'Finalize failed');
  };

  const handleVoidRecord = async (id: string) => {
    if (!confirm('Void this finalized GRN? Stock will be reversed and credit balance adjusted.')) return;
    const result = await api.grn.void(id);
    if (result.success) {
      toast.success('GRN voided');
      setEditingRecord(null);
      loadRecords();
      refreshProducts();
      loadBase();
    } else toast.error(result.error ?? 'Void failed');
  };

  const handlePrintLabels = async () => {
    if (!selectedGrn || !labelTemplateId) return;
    const result = await api.labels.printBatch({
      templateId: labelTemplateId,
      items: selectedGrn.items.map((i) => ({ productId: i.productId, copies: i.qty })),
    });
    if (result.success) toast.success(`Printed ${result.data?.labelCount ?? 0} labels`);
    else toast.error(result.error ?? 'Print failed');
    setPrintLabelsOpen(false);
  };

  const filteredProducts = products.filter((p) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()),
  ).slice(0, 8);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Goods Received (GRN)</h2>
      <p className="text-slate-500 mb-4">Receive stock from vendors and update product cost and retail prices</p>

      <div className="flex gap-2 mb-6">
        <Button variant={tab === 'create' ? 'primary' : 'ghost'} onClick={() => setTab('create')}>New GRN</Button>
        <Button variant={tab === 'records' ? 'primary' : 'ghost'} onClick={() => setTab('records')}>GRN Records</Button>
      </div>

      {tab === 'create' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold">Header</h3>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">Payment Type</label>
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as GrnPaymentType)} className="w-full px-3 py-2 border rounded-lg mt-1">
                <option value="cash">Cash</option>
                <option value="credit">Credit</option>
              </select>
              <p className="text-xs text-slate-400 mt-1">Defaults from supplier&apos;s last preference — change if needed</p>
            </div>
            <input placeholder="Supplier invoice #" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg h-16" />

            <div className="p-3 rounded-lg text-sm font-medium bg-slate-50 text-slate-700">
              Lines total: PKR {linesTotal.toFixed(2)}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleSaveDraft} disabled={!lines.length || savingDraft || finalizing}>
                {savingDraft ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button onClick={handleFinalizeNew} disabled={!lines.length || savingDraft || finalizing}>
                {finalizing ? 'Finalizing…' : 'Finalize GRN'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">Save Draft keeps the GRN editable. Finalize GRN updates inventory and product prices immediately.</p>
          </div>

          <div className="bg-white rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold">Add Products</h3>
            <div className="flex gap-2">
              <input
                placeholder="Search product… (F1)"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'F1') {
                    e.preventDefault();
                    setShowProductSearch(true);
                  }
                }}
                className="flex-1 px-3 py-2 border rounded-lg"
              />
              <Button variant="secondary" size="sm" onClick={() => setShowProductSearch(true)}>F1 Search</Button>
            </div>
            {productSearch && (
              <div className="border rounded-lg max-h-32 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <button key={p.id} type="button" onClick={() => addLine(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b">
                    {p.name} <span className="text-slate-400">({p.sku})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left p-1">
                      <button type="button" onClick={() => toggleLineSort('product')} className="hover:text-pink-700 font-medium">
                        Product{lineSortIcon('product')}
                      </button>
                    </th>
                    <th className="p-1">
                      <button type="button" onClick={() => toggleLineSort('qty')} className="hover:text-pink-700 font-medium">
                        Qty{lineSortIcon('qty')}
                      </button>
                    </th>
                    <th className="p-1">
                      <button type="button" onClick={() => toggleLineSort('cost')} className="hover:text-pink-700 font-medium">
                        Cost{lineSortIcon('cost')}
                      </button>
                    </th>
                    <th className="p-1">
                      <button type="button" onClick={() => toggleLineSort('retail')} className="hover:text-pink-700 font-medium">
                        Retail{lineSortIcon('retail')}
                      </button>
                    </th>
                    <th className="p-1">
                      <button type="button" onClick={() => toggleLineSort('margin')} className="hover:text-pink-700 font-medium">
                        Margin %{lineSortIcon('margin')}
                      </button>
                    </th>
                    <th className="p-1 text-right">
                      <button type="button" onClick={() => toggleLineSort('total')} className="hover:text-pink-700 font-medium">
                        Total{lineSortIcon('total')}
                      </button>
                    </th>
                    <th className="p-1 w-6" />
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.map(({ idx, line, productName, productSku, retail, margin }) => {
                    const previewRetail = retail;
                    return (
                      <tr key={line.productId} className="border-t">
                        <td className="p-1">
                          <div className="font-medium">{productName}</div>
                          <div className="text-xs text-slate-400">{productSku || line.productId}</div>
                        </td>
                        <td className="p-1">
                          <input
                            type="number"
                            min={1}
                            value={line.qty}
                            onChange={(e) => updateLine(idx, { qty: parseInt(e.target.value, 10) || 1 })}
                            className="w-14 px-1 border rounded"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={line.unitCost}
                            onChange={(e) => updateLine(idx, { unitCost: parseFloat(e.target.value) || 0 })}
                            className="w-20 px-1 border rounded"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={line.retailInput}
                            onChange={(e) => {
                              const retailInput = e.target.value;
                              const fromMarkup = parseMarkupInput(retailInput, line.unitCost);
                              const fromNumber = parseFloat(retailInput);
                              const unitRetail = fromMarkup ?? (!Number.isNaN(fromNumber) ? fromNumber : line.unitRetail);
                              updateLine(idx, { retailInput, unitRetail });
                            }}
                            onBlur={() => handleRetailBlur(idx)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleRetailBlur(idx);
                              }
                            }}
                            placeholder="PKR or 10%"
                            className="w-24 px-1 border rounded"
                            title="Retail price per unit — use 10% for markup on cost"
                          />
                          {line.retailInput.includes('%') && (
                            <p className="text-xs text-slate-400">→ {previewRetail.toFixed(2)}</p>
                          )}
                        </td>
                        <td className="p-1 text-slate-600">{margin.toFixed(1)}%</td>
                        <td className="p-1 text-right">{(line.qty * line.unitCost).toFixed(2)}</td>
                        <td className="p-1">
                          <button type="button" className="text-red-500 text-xs" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'records' && (
        <div>
          <p className="text-sm text-slate-500 mb-3">Click any GRN to view and edit — draft and finalized records can be updated.</p>
          <div className="flex gap-2 mb-4 flex-wrap">
            <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="GRN #" value={filterGrn} onChange={(e) => setFilterGrn(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <table className="w-full bg-white rounded-xl border text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="p-3">GRN #</th><th className="p-3">Vendor</th><th className="p-3">Payment</th><th className="p-3">Created</th><th className="p-3">Received</th><th className="p-3 text-right">Total</th><th className="p-3">Status</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((g) => (
                <tr
                  key={g.id}
                  className={`border-t cursor-pointer hover:bg-pink-50 ${editingRecord?.id === g.id ? 'bg-pink-50' : ''}`}
                  onClick={() => selectRecord(g)}
                >
                  <td className="p-3 font-mono text-pink-700">{g.grnNumber}</td>
                  <td className="p-3">{g.vendorName}</td>
                  <td className="p-3 capitalize text-xs">{g.paymentType ?? 'cash'}</td>
                  <td className="p-3 text-xs text-slate-600 whitespace-nowrap">{formatDateTime(g.createdAt)}</td>
                  <td className="p-3 text-xs">{formatDateOnly(g.receivedDate)}</td>
                  <td className="p-3 text-right">PKR {g.linesTotal.toFixed(2)}</td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{g.status}</span></td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end">
                      {(g.status === 'draft' || g.status === 'finalized') && (
                        <span className="text-xs text-pink-600 self-center">View / Edit</span>
                      )}
                      {g.status === 'draft' && (
                        <Button
                          size="sm"
                          disabled={finalizing}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleFinalize(g.id);
                          }}
                        >
                          {finalizing ? '…' : 'Finalize'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editingRecord && (
            <div ref={recordDetailRef} className="mt-6 bg-white rounded-xl border p-4 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-semibold text-lg">{editingRecord.grnNumber}</h3>
                  <p className="text-sm text-slate-500">
                    {editingRecord.vendorName} · {editingRecord.paymentType ?? 'cash'} · Received {formatDateOnly(editingRecord.receivedDate)} · {editingRecord.status}
                    {canEditRecord && <span className="text-pink-600"> · editable</span>}
                    {editingRecord.invoiceNumber ? ` · Invoice ${editingRecord.invoiceNumber}` : ''}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Created {formatDateTime(editingRecord.createdAt)}
                    {editingRecord.status === 'finalized' ? (
                      <> · Finalized {formatDateTime(editingRecord.updatedAt)}</>
                    ) : editingRecord.updatedAt !== editingRecord.createdAt ? (
                      <> · Updated {formatDateTime(editingRecord.updatedAt)}</>
                    ) : null}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingRecord(null)}>Close</Button>
              </div>

              {canEditRecord ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <select
                      value={editVendorId}
                      onChange={(e) => {
                        setEditVendorId(e.target.value);
                        applyVendorPaymentPreference(e.target.value, setEditPaymentType);
                      }}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <select value={editPaymentType} onChange={(e) => setEditPaymentType(e.target.value as GrnPaymentType)} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="cash">Cash</option>
                      <option value="credit">Credit</option>
                    </select>
                    <input placeholder="Supplier invoice #" value={editInvoiceNumber} onChange={(e) => setEditInvoiceNumber(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input placeholder="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Search product to add… (F1)"
                      value={editProductSearch}
                      onChange={(e) => setEditProductSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'F1') {
                          e.preventDefault();
                          setShowRecordProductSearch(true);
                        }
                      }}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                    <Button variant="secondary" size="sm" onClick={() => setShowRecordProductSearch(true)}>F1 Search</Button>
                  </div>
                  {editProductSearch && (
                    <div className="border rounded-lg max-h-32 overflow-y-auto">
                      {products.filter((p) =>
                        p.name.toLowerCase().includes(editProductSearch.toLowerCase()) ||
                        p.sku.toLowerCase().includes(editProductSearch.toLowerCase()),
                      ).slice(0, 8).map((p) => (
                        <button key={p.id} type="button" onClick={() => addEditLine(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b">
                          {p.name} <span className="text-slate-400">({p.sku})</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="p-3 rounded-lg text-sm font-medium bg-slate-50 text-slate-700">
                    Lines total: PKR {editLinesTotal.toFixed(2)}
                  </div>
                  {editingRecord.status === 'finalized' && (
                    <p className="text-xs text-slate-500">Saving updates stock levels and product cost/retail prices.</p>
                  )}
                </>
              ) : editingRecord.notes ? (
                <p className="text-sm text-slate-600">{editingRecord.notes}</p>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left p-1">Product</th>
                      <th className="p-1">Qty</th>
                      <th className="p-1">Cost</th>
                      <th className="p-1">Retail</th>
                      <th className="p-1">Margin %</th>
                      <th className="p-1 text-right">Total</th>
                      {canEditRecord && <th className="p-1 w-6" />}
                    </tr>
                  </thead>
                  <tbody>
                    {canEditRecord ? (
                      sortedEditLines.map(({ idx, line, productName, productSku, retail, margin }) => (
                        <tr key={line.productId} className="border-t">
                          <td className="p-1">
                            <div className="font-medium">{productName}</div>
                            <div className="text-xs text-slate-400">{productSku || line.productId}</div>
                          </td>
                          <td className="p-1">
                            <input type="number" min={1} value={line.qty} onChange={(e) => updateEditLine(idx, { qty: parseInt(e.target.value, 10) || 1 })} className="w-14 px-1 border rounded" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} step={0.01} value={line.unitCost} onChange={(e) => updateEditLine(idx, { unitCost: parseFloat(e.target.value) || 0 })} className="w-20 px-1 border rounded" />
                          </td>
                          <td className="p-1">
                            <input
                              type="text"
                              value={line.retailInput}
                              onChange={(e) => {
                                const retailInput = e.target.value;
                                const fromMarkup = parseMarkupInput(retailInput, line.unitCost);
                                const fromNumber = parseFloat(retailInput);
                                const unitRetail = fromMarkup ?? (!Number.isNaN(fromNumber) ? fromNumber : line.unitRetail);
                                updateEditLine(idx, { retailInput, unitRetail });
                              }}
                              onBlur={() => handleEditRetailBlur(idx)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditRetailBlur(idx); } }}
                              className="w-24 px-1 border rounded"
                            />
                            {line.retailInput.includes('%') && <p className="text-xs text-slate-400">→ {retail.toFixed(2)}</p>}
                          </td>
                          <td className="p-1 text-slate-600">{margin.toFixed(1)}%</td>
                          <td className="p-1 text-right">{(line.qty * line.unitCost).toFixed(2)}</td>
                          <td className="p-1">
                            <button type="button" className="text-red-500 text-xs" onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}>×</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      editingRecord.items.map((item) => {
                        const margin = lineMarginPct(item.unitCost, item.unitRetail);
                        return (
                          <tr key={item.id} className="border-t">
                            <td className="p-1">{item.productName} <span className="text-slate-400 text-xs">({item.productSku})</span></td>
                            <td className="p-1 text-center">{item.qty}</td>
                            <td className="p-1 text-center">{item.unitCost.toFixed(2)}</td>
                            <td className="p-1 text-center">{item.unitRetail.toFixed(2)}</td>
                            <td className="p-1 text-center">{margin.toFixed(1)}%</td>
                            <td className="p-1 text-right">{item.lineTotal.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {canEditRecord && (
                <div className="flex gap-2">
                  <Button onClick={handleUpdateRecord} disabled={updatingRecord || !editLines.length}>
                    {updatingRecord ? 'Updating…' : 'Update GRN'}
                  </Button>
                  {editingRecord.status === 'draft' && (
                    <Button
                      variant="secondary"
                      onClick={() => void handleFinalize(editingRecord.id)}
                      disabled={!editLines.length || finalizing || updatingRecord}
                    >
                      {finalizing ? 'Finalizing…' : 'Finalize GRN'}
                    </Button>
                  )}
                  {editingRecord.status === 'finalized' && (
                    <Button variant="danger" onClick={() => void handleVoidRecord(editingRecord.id)}>
                      Void GRN
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ProductSearchModal
        open={showProductSearch}
        onClose={() => setShowProductSearch(false)}
        onSelect={addLine}
      />

      <ProductSearchModal
        open={showRecordProductSearch}
        onClose={() => setShowRecordProductSearch(false)}
        onSelect={addEditLine}
      />

      <Modal open={printLabelsOpen} title="Print Labels?" onClose={() => setPrintLabelsOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setPrintLabelsOpen(false)}>Skip</Button><Button onClick={handlePrintLabels}>Print Labels</Button></>}
      >
        <p>GRN finalized. Print barcode labels for received items?</p>
      </Modal>
    </div>
  );
}
