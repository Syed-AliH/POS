import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { SortableTh } from '@renderer/components/SortableTh';
import { sortByKey, useTableSort } from '@renderer/lib/useTableSort';
import { LabelPrintPreviewModal } from '@renderer/components/designer/LabelRollPreview';
import { Modal } from '@renderer/components/Modal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import {
  expandGrnLabelProducts,
  normalizeLabelTemplate,
  pickLabelTemplateId,
  resolveLabelLayoutForPreview,
} from '@renderer/lib/labelTemplateUtils';
import { parseMarkupInput, resolveMarkupToPrice } from '@renderer/lib/markup';
import {
  downloadExcelTemplate,
  GRN_IMPORT_HEADERS,
  parseExcelFile,
} from '@renderer/lib/excelImport';
import { getActiveRoute, registerPageShortcuts } from '@renderer/lib/shortcuts';
import { toast } from '@renderer/stores/toastStore';
import { useLabelDefaultsStore } from '@renderer/stores/labelDefaultsStore';
import { formatDateOnly, formatDateTime } from '@shared/datetime';
import type { GrnPaymentType, GrnSummary, LabelTemplateSummary, Product, Vendor } from '@shared/types';

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
type LineSortKey = 'sku' | 'product' | 'qty' | 'cost' | 'retail' | 'margin' | 'total';
type RecordSortKey = 'grn' | 'vendor' | 'payment' | 'created' | 'received' | 'total' | 'status';

function lineMarginPct(unitCost: number, unitRetail: number): number {
  if (unitRetail <= 0) return 0;
  return ((unitRetail - unitCost) / unitRetail) * 100;
}

function lineRetailPrice(line: GrnDraftLine): number {
  return parseMarkupInput(line.retailInput, line.unitCost) ?? line.unitRetail;
}

type LineTotals = {
  qtyTotal: number;
  costTotal: number;
  retailTotal: number;
  margin: number;
};

function summarizeDraftLines(lines: GrnDraftLine[]): LineTotals {
  let qtyTotal = 0;
  let costTotal = 0;
  let retailTotal = 0;
  for (const line of lines) {
    qtyTotal += line.qty;
    costTotal += line.qty * line.unitCost;
    retailTotal += line.qty * lineRetailPrice(line);
  }
  return {
    qtyTotal,
    costTotal,
    retailTotal,
    margin: lineMarginPct(qtyTotal > 0 ? costTotal / qtyTotal : 0, qtyTotal > 0 ? retailTotal / qtyTotal : 0),
  };
}

function summarizeGrnItems(items: GrnSummary['items']): LineTotals {
  let qtyTotal = 0;
  let costTotal = 0;
  let retailTotal = 0;
  for (const item of items) {
    qtyTotal += item.qty;
    costTotal += item.lineTotal;
    retailTotal += item.qty * item.unitRetail;
  }
  return {
    qtyTotal,
    costTotal,
    retailTotal,
    margin: lineMarginPct(qtyTotal > 0 ? costTotal / qtyTotal : 0, qtyTotal > 0 ? retailTotal / qtyTotal : 0),
  };
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

function sortDraftLines<T extends {
  productName: string;
  productSku: string;
  retail: number;
  margin: number;
  total: number;
  line: GrnDraftLine;
}>(
  rows: T[],
  lineSortKey: LineSortKey | null,
  lineSortDir: 'asc' | 'desc',
) {
  if (!lineSortKey) return rows;
  rows.sort((a, b) => {
    let cmp = 0;
    if (lineSortKey === 'sku') cmp = a.productSku.localeCompare(b.productSku);
    else if (lineSortKey === 'product') cmp = a.productName.localeCompare(b.productName);
    else if (lineSortKey === 'qty') cmp = a.line.qty - b.line.qty;
    else if (lineSortKey === 'cost') cmp = a.line.unitCost - b.line.unitCost;
    else if (lineSortKey === 'retail') cmp = a.retail - b.retail;
    else if (lineSortKey === 'margin') cmp = a.margin - b.margin;
    else if (lineSortKey === 'total') cmp = a.total - b.total;
    return lineSortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function sortRecordItems<T extends {
  productName: string;
  productSku: string;
  qty: number;
  unitCost: number;
  unitRetail: number;
  lineTotal: number;
}>(
  items: T[],
  lineSortKey: LineSortKey | null,
  lineSortDir: 'asc' | 'desc',
) {
  if (!lineSortKey) return items;
  const rows = items.map((item) => ({
    item,
    productName: item.productName,
    productSku: item.productSku,
    retail: item.unitRetail,
    margin: lineMarginPct(item.unitCost, item.unitRetail),
    total: item.lineTotal,
    line: {
      productId: '',
      productName: item.productName,
      productSku: item.productSku,
      qty: item.qty,
      unitCost: item.unitCost,
      unitRetail: item.unitRetail,
      retailInput: String(item.unitRetail),
    } satisfies GrnDraftLine,
  }));
  return sortDraftLines(rows, lineSortKey, lineSortDir).map((r) => r.item);
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
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateSummary[]>([]);
  const [labelPrinting, setLabelPrinting] = useState(false);
  const [storeName, setStoreName] = useState('Store');
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [lineSortKey, setLineSortKey] = useState<LineSortKey | null>(null);
  const [lineSortDir, setLineSortDir] = useState<'asc' | 'desc'>('asc');
  const [editLineSortKey, setEditLineSortKey] = useState<LineSortKey | null>(null);
  const [editLineSortDir, setEditLineSortDir] = useState<'asc' | 'desc'>('asc');
  const [grnImportOpen, setGrnImportOpen] = useState(false);
  const [grnImporting, setGrnImporting] = useState(false);
  const [grnImportErrors, setGrnImportErrors] = useState<string[]>([]);
  const grnImportFileRef = useRef<HTMLInputElement>(null);
  const recordDetailRef = useRef<HTMLDivElement>(null);
  const setLastTemplateId = useLabelDefaultsStore((s) => s.setLastTemplateId);
  const { onSort: onRecordSort, icon: recordSortIcon, sortKey: recordSortKey, sortDir: recordSortDir } = useTableSort<RecordSortKey>('created', 'desc');

  const sortedRecords = useMemo(
    () => sortByKey(records, recordSortKey, recordSortDir, {
      grn: (g) => g.grnNumber,
      vendor: (g) => g.vendorName,
      payment: (g) => g.paymentType ?? 'cash',
      created: (g) => g.createdAt,
      received: (g) => g.receivedDate,
      total: (g) => g.linesTotal,
      status: (g) => g.status,
    }),
    [records, recordSortKey, recordSortDir],
  );

  const linesTotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.unitCost, 0), [lines]);
  const lineTotals = useMemo(() => summarizeDraftLines(lines), [lines]);

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
  const editLineTotals = useMemo(() => summarizeDraftLines(editLines), [editLines]);
  const recordLineTotals = useMemo(
    () => (editingRecord ? summarizeGrnItems(editingRecord.items) : null),
    [editingRecord],
  );

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

  const sortedViewItems = useMemo(() => {
    if (!editingRecord) return [];
    const editable = editingRecord.status === 'draft' || editingRecord.status === 'finalized';
    if (editable) return [];
    return sortRecordItems(editingRecord.items, editLineSortKey, editLineSortDir);
  }, [editingRecord, editLineSortKey, editLineSortDir]);

  const toggleLineSort = (key: LineSortKey) => {
    if (lineSortKey === key) setLineSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setLineSortKey(key);
      setLineSortDir('asc');
    }
  };

  const lineSortIcon = (key: LineSortKey) =>
    lineSortKey === key ? (lineSortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const toggleEditLineSort = (key: LineSortKey) => {
    if (editLineSortKey === key) setEditLineSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setEditLineSortKey(key);
      setEditLineSortDir('asc');
    }
  };

  const editLineSortIcon = (key: LineSortKey) =>
    editLineSortKey === key ? (editLineSortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const applyVendorPaymentPreference = (id: string, setter: (value: GrnPaymentType) => void) => {
    const vendor = vendors.find((v) => v.id === id);
    setter(vendor?.preferredPaymentType ?? 'cash');
  };

  const loadBase = async () => {
    const [v, p, t, s] = await Promise.all([
      api.vendors.list(),
      api.products.list({ status: 'active', limit: 500 }),
      api.labels.templates(),
      api.settings.getAll(),
    ]);
    if (v.success) {
      setVendors(v.data ?? []);
      if (v.data?.[0] && !vendorId) setVendorId(v.data[0].id);
    }
    if (p.success) setProducts(p.data ?? []);
    const settingsStoreName = s.success ? s.data?.store_name : undefined;
    if (settingsStoreName) setStoreName(settingsStoreName);
    if (t.success && t.data?.length) {
      const list = t.data.map((tpl) => normalizeLabelTemplate(tpl, settingsStoreName));
      setLabelTemplates(list);
      setLabelTemplateId((current) =>
        current && list.some((x) => x.id === current) ? current : pickLabelTemplateId(list),
      );
    }
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

  /**
   * The F1 search modal builds its rows from the till's catalogue payload, which
   * carries no cost price. Resolve the real product row before pricing a GRN line,
   * so an existing product arrives with the cost it was last received at.
   */
  const resolveProductForLine = useCallback(async (product: Product): Promise<Product> => {
    const known = products.find((p) => p.id === product.id);
    if (known) return known;
    const result = await api.products.get(product.id);
    return result.success && result.data ? result.data : product;
  }, [products]);

  const addLine = async (product: Product) => {
    if (lines.some((l) => l.productId === product.id)) {
      toast.warning(`${product.name} is already on this GRN`);
      return;
    }
    const full = await resolveProductForLine(product);
    setLines((prev) => {
      if (prev.some((l) => l.productId === full.id)) return prev;
      return [
        ...prev,
        {
          productId: full.id,
          productName: full.name,
          productSku: full.sku,
          qty: 1,
          unitCost: full.costPrice,
          unitRetail: full.retailPrice,
          retailInput: String(full.retailPrice),
        },
      ];
    });
    setProductSearch('');
    toast.success(`Added: ${full.name}`);
  };

  const handleGrnImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGrnImporting(true);
    setGrnImportErrors([]);
    try {
      const rawRows = await parseExcelFile(file);
      const errors: string[] = [];
      const importedLines: GrnDraftLine[] = [];
      const seenProductIds = new Set(lines.map((l) => l.productId));

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i];
        const rowNum = i + 2;
        const get = (...keys: string[]) => {
          for (const k of keys) {
            const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
            if (v !== undefined && String(v).trim() !== '') return String(v).trim();
          }
          return '';
        };

        const sku = get('SKU', 'sku', 'product_sku');
        const nameRaw = get('Product Name', 'product_name', 'name', 'product');
        const qty = parseInt(get('Qty', 'qty', 'quantity') || '1', 10) || 1;
        const costPrice = parseFloat(get('Cost Price', 'cost_price', 'cost') || '0') || 0;
        const retailPrice = parseFloat(get('Retail Price', 'retail_price', 'retail') || '0') || 0;

        if (!sku && !nameRaw) { errors.push(`Row ${rowNum}: SKU or Product Name is required`); continue; }

        const matched = products.find((p) =>
          (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
          (nameRaw && p.name.toLowerCase() === nameRaw.toLowerCase()),
        );

        if (!matched) {
          errors.push(`Row ${rowNum}: Product "${sku || nameRaw}" not found — add it to inventory first`);
          continue;
        }

        if (seenProductIds.has(matched.id)) continue;
        seenProductIds.add(matched.id);
        importedLines.push({
          productId: matched.id,
          productName: matched.name,
          productSku: matched.sku,
          qty,
          unitCost: costPrice || matched.costPrice,
          unitRetail: retailPrice || matched.retailPrice,
          retailInput: String(retailPrice || matched.retailPrice),
        });
      }

      const added = importedLines.length;
      if (added > 0) {
        setLines((prev) => [...prev, ...importedLines]);
        setLineSortKey(null);
      }

      setGrnImportErrors(errors);
      if (added > 0) toast.success(`Added ${added} product line(s) from Excel`);
      else toast.error('No matching products found');
      if (!errors.length) setGrnImportOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setGrnImporting(false);
      if (grnImportFileRef.current) grnImportFileRef.current.value = '';
    }
  }, [products, lines]);

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
    setLineSortKey(null);
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
    setEditLineSortKey(null);
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

  const addEditLine = async (product: Product) => {
    if (editLines.some((l) => l.productId === product.id)) {
      toast.warning(`${product.name} is already on this GRN`);
      return;
    }
    const full = await resolveProductForLine(product);
    setEditLines((prev) => {
      if (prev.some((l) => l.productId === full.id)) return prev;
      return [
        ...prev,
        {
          productId: full.id,
          productName: full.name,
          productSku: full.sku,
          qty: 1,
          unitCost: full.costPrice,
          unitRetail: full.retailPrice,
          retailInput: String(full.retailPrice),
        },
      ];
    });
    setEditProductSearch('');
    toast.success(`Added: ${full.name}`);
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

  const grnForLabels = (base: GrnSummary): GrnSummary => {
    if (editingRecord?.id === base.id && canEditRecord && editLines.length > 0) {
      const existingByProduct = new Map(base.items.map((i) => [i.productId, i]));
      return {
        ...base,
        items: editLines.map((l, idx) => {
          const existing = existingByProduct.get(l.productId);
          return {
            id: existing?.id ?? `draft-${idx}`,
            productId: l.productId,
            productName: l.productName,
            productSku: l.productSku,
            qty: l.qty,
            unitCost: l.unitCost,
            unitRetail: l.unitRetail,
            lineTotal: l.qty * l.unitCost,
          };
        }),
      };
    }
    return base;
  };

  const openPrintLabelsForGrn = (grn: GrnSummary) => {
    const labelGrn = grnForLabels(grn);
    if (!labelGrn.items.length) {
      toast.warning('No items on this GRN to print');
      return;
    }
    setSelectedGrn(labelGrn);
    setPrintLabelsOpen(true);
  };

  const handlePrintLabels = async () => {
    if (!selectedGrn || !labelTemplateId) return;
    setLabelPrinting(true);
    setLastTemplateId(labelTemplateId);
    const result = await api.labels.printBatch({
      templateId: labelTemplateId,
      items: selectedGrn.items.map((i) => ({ productId: i.productId, copies: i.qty })),
    });
    setLabelPrinting(false);
    if (result.success) toast.success(`Printed ${result.data?.labelCount ?? 0} labels`);
    else toast.error(result.error ?? 'Print failed');
    setPrintLabelsOpen(false);
  };

  const activeLabelTemplate = labelTemplates.find((t) => t.id === labelTemplateId);
  const grnLabelCount = selectedGrn?.items.reduce((sum, i) => sum + i.qty, 0) ?? 0;
  const grnPreviewLayout = activeLabelTemplate
    ? resolveLabelLayoutForPreview(activeLabelTemplate, storeName)
    : null;
  const grnPreviewProducts = selectedGrn
    ? expandGrnLabelProducts(selectedGrn.items, products)
    : [];

  const filteredProducts = products.filter((p) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()),
  ).slice(0, 8);

  return (
    <div className="page-shell">
      <h2 className="text-2xl font-bold mb-2">Goods Received (GRN)</h2>
      <p className="text-slate-500 mb-4">Receive stock from vendors and update product cost and retail prices</p>

      <div className="flex gap-2 mb-6">
        <Button variant={tab === 'create' ? 'primary' : 'ghost'} onClick={() => setTab('create')}>New GRN</Button>
        <Button variant={tab === 'records' ? 'primary' : 'ghost'} onClick={() => setTab('records')}>GRN Records</Button>
      </div>

      {tab === 'create' && (
        <div className="flex flex-col gap-6">
          <div className="panel p-4">
            <h3 className="font-semibold mb-4">Header</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="section-label mb-1 block">Supplier</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="form-select h-10">
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="section-label mb-1 block">Payment type</label>
                <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as GrnPaymentType)} className="form-select h-10">
                  <option value="cash">Cash</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div>
                <label className="section-label mb-1 block">Supplier invoice #</label>
                <input placeholder="Optional" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="form-input h-10" />
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="section-label mb-1 block">Notes</label>
                <input placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="form-input h-10" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <p className="text-xs text-slate-500 max-w-xl">
                Save Draft keeps the GRN editable. Finalize updates inventory and product prices immediately.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
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
              </div>
            </div>
          </div>

          <div className="panel flex flex-col p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">Add Products</h3>
              <div className="flex items-center gap-2">
                {lines.length > 0 && (
                  <span className="text-sm text-slate-500">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    downloadExcelTemplate('grn-template.xlsx', GRN_IMPORT_HEADERS, [
                      { SKU: 'SKU-FD-0001', 'Product Name': 'Feeder Bottle 250ml', Qty: 10, 'Cost Price': 120, 'Retail Price': 150 },
                      { SKU: 'SKU-GRO-0001', 'Product Name': 'Basmati Rice 1kg', Qty: 5, 'Cost Price': 280, 'Retail Price': 320 },
                    ])
                  }
                >
                  ⬇ Template
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setGrnImportOpen(true); setGrnImportErrors([]); }}>
                  ⬆ Import Excel
                </Button>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
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
                className="form-input h-10 flex-1"
              />
              <Button variant="secondary" size="sm" onClick={() => setShowProductSearch(true)}>F1 Search</Button>
            </div>
            {productSearch && (
              <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border">
                {filteredProducts.map((p) => (
                  <button key={p.id} type="button" onClick={() => addLine(p)} className="w-full border-b px-3 py-2 text-left text-sm row-hover last:border-b-0">
                    {p.name} <span className="text-slate-400">({p.sku})</span>
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="w-12 p-2 text-center">SR</th>
                    <th className="min-w-[120px] p-2 text-left">
                      <button type="button" onClick={() => toggleLineSort('sku')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        SKU{lineSortIcon('sku')}
                      </button>
                    </th>
                    <th className="min-w-[180px] p-2 pl-1 text-left">
                      <button type="button" onClick={() => toggleLineSort('product')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Product{lineSortIcon('product')}
                      </button>
                    </th>
                    <th className="w-20 p-2">
                      <button type="button" onClick={() => toggleLineSort('qty')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Qty{lineSortIcon('qty')}
                      </button>
                    </th>
                    <th className="w-28 p-2">
                      <button type="button" onClick={() => toggleLineSort('cost')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Cost{lineSortIcon('cost')}
                      </button>
                    </th>
                    <th className="w-32 p-2">
                      <button type="button" onClick={() => toggleLineSort('retail')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Retail{lineSortIcon('retail')}
                      </button>
                    </th>
                    <th className="w-24 p-2">
                      <button type="button" onClick={() => toggleLineSort('margin')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Margin %{lineSortIcon('margin')}
                      </button>
                    </th>
                    <th className="w-28 p-2 text-right">
                      <button type="button" onClick={() => toggleLineSort('total')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                        Total{lineSortIcon('total')}
                      </button>
                    </th>
                    <th className="w-10 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-slate-400">
                        Search or press F1 to add products to this GRN
                      </td>
                    </tr>
                  ) : sortedLines.map(({ idx, line, productName, productSku, retail, margin }, srIndex) => {
                    const previewRetail = retail;
                    return (
                      <tr key={line.productId} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 text-center text-slate-500">{srIndex + 1}</td>
                        <td className="p-2 font-mono text-xs text-slate-600 dark:text-slate-400">{productSku || '—'}</td>
                        <td className="p-2 pl-1">
                          <div className="font-medium">{productName}</div>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            value={line.qty}
                            onChange={(e) => updateLine(idx, { qty: parseInt(e.target.value, 10) || 1 })}
                            className="w-full min-w-[4rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={line.unitCost}
                            onChange={(e) => updateLine(idx, { unitCost: parseFloat(e.target.value) || 0 })}
                            className="w-full min-w-[5rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                          />
                        </td>
                        <td className="p-2">
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
                            className="w-full min-w-[6rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                            title="Retail price per unit — use 10% for markup on cost"
                          />
                          {line.retailInput.includes('%') && (
                            <p className="text-xs text-slate-400">→ {previewRetail.toFixed(2)}</p>
                          )}
                        </td>
                        <td className="p-2 text-center text-slate-600 dark:text-slate-400">{margin.toFixed(1)}%</td>
                        <td className="p-2 text-right font-medium">{(line.qty * line.unitCost).toFixed(2)}</td>
                        <td className="p-2 text-center">
                          <button type="button" className="text-red-500 text-xs hover:text-red-700" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800/80">
                      <td colSpan={3} className="p-2 pl-3">Total</td>
                      <td className="p-2 text-center">{lineTotals.qtyTotal}</td>
                      <td className="p-2 text-center" title="Total cost">
                        {lineTotals.costTotal.toFixed(2)}
                      </td>
                      <td className="p-2 text-center" title="Total retail value">
                        {lineTotals.retailTotal.toFixed(2)}
                      </td>
                      <td className="p-2 text-center text-slate-600 dark:text-slate-400">{lineTotals.margin.toFixed(1)}%</td>
                      <td className="p-2 text-right">{lineTotals.costTotal.toFixed(2)}</td>
                      <td className="p-2" />
                    </tr>
                  </tfoot>
                )}
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
          <table className="data-table-wrap w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <SortableTh label="GRN #" columnKey="grn" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <SortableTh label="Vendor" columnKey="vendor" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <SortableTh label="Payment" columnKey="payment" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <SortableTh label="Created" columnKey="created" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <SortableTh label="Received" columnKey="received" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <SortableTh label="Total" columnKey="total" onSort={onRecordSort} icon={recordSortIcon} className="p-3" align="right" />
                <SortableTh label="Status" columnKey="status" onSort={onRecordSort} icon={recordSortIcon} className="p-3" />
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((g) => (
                <tr
                  key={g.id}
                  className={`border-t cursor-pointer hover:bg-primary-50 ${editingRecord?.id === g.id ? 'bg-primary-50' : ''}`}
                  onClick={() => selectRecord(g)}
                >
                  <td className="p-3 font-mono text-primary-700">{g.grnNumber}</td>
                  <td className="p-3">{g.vendorName}</td>
                  <td className="p-3 capitalize text-xs">{g.paymentType ?? 'cash'}</td>
                  <td className="p-3 text-xs text-slate-600 whitespace-nowrap">{formatDateTime(g.createdAt)}</td>
                  <td className="p-3 text-xs">{formatDateOnly(g.receivedDate)}</td>
                  <td className="p-3 text-right">PKR {g.linesTotal.toFixed(2)}</td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{g.status}</span></td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end">
                      {(g.status === 'draft' || g.status === 'finalized') && (
                        <span className="text-xs text-primary-600 self-center">View / Edit</span>
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
            <div ref={recordDetailRef} className="mt-6 panel p-4 space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-semibold text-lg">{editingRecord.grnNumber}</h3>
                  <p className="text-sm text-slate-500">
                    {editingRecord.vendorName} · {editingRecord.paymentType ?? 'cash'} · Received {formatDateOnly(editingRecord.receivedDate)} · {editingRecord.status}
                    {canEditRecord && <span className="text-primary-600"> · editable</span>}
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
                <div className="flex gap-2 shrink-0">
                  {(editingRecord.status === 'draft' || editingRecord.status === 'finalized') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openPrintLabelsForGrn(editingRecord)}
                      disabled={!(canEditRecord ? editLines.length : editingRecord.items.length)}
                    >
                      Print Labels
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditingRecord(null)}>Close</Button>
                </div>
              </div>

              {canEditRecord ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="section-label mb-1 block">Supplier</label>
                      <select
                        value={editVendorId}
                        onChange={(e) => {
                          setEditVendorId(e.target.value);
                          applyVendorPaymentPreference(e.target.value, setEditPaymentType);
                        }}
                        className="form-select h-10 text-sm"
                      >
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="section-label mb-1 block">Payment type</label>
                      <select value={editPaymentType} onChange={(e) => setEditPaymentType(e.target.value as GrnPaymentType)} className="form-select h-10 text-sm">
                        <option value="cash">Cash</option>
                        <option value="credit">Credit</option>
                      </select>
                    </div>
                    <div>
                      <label className="section-label mb-1 block">Supplier invoice #</label>
                      <input placeholder="Optional" value={editInvoiceNumber} onChange={(e) => setEditInvoiceNumber(e.target.value)} className="form-input h-10 text-sm" />
                    </div>
                    <div>
                      <label className="section-label mb-1 block">Notes</label>
                      <input placeholder="Optional notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="form-input h-10 text-sm" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <div className="flex flex-1 gap-2 min-w-[240px]">
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
                        className="form-input h-10 flex-1 text-sm"
                      />
                      <Button variant="secondary" size="sm" onClick={() => setShowRecordProductSearch(true)}>F1 Search</Button>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                      Lines total: PKR {editLinesTotal.toFixed(2)}
                    </div>
                  </div>
                  {editProductSearch && (
                    <div className="max-h-32 overflow-y-auto rounded-lg border">
                      {products.filter((p) =>
                        p.name.toLowerCase().includes(editProductSearch.toLowerCase()) ||
                        p.sku.toLowerCase().includes(editProductSearch.toLowerCase()),
                      ).slice(0, 8).map((p) => (
                        <button key={p.id} type="button" onClick={() => addEditLine(p)} className="w-full border-b px-3 py-2 text-left text-sm row-hover last:border-b-0">
                          {p.name} <span className="text-slate-400">({p.sku})</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {editingRecord.status === 'finalized' && (
                    <p className="text-xs text-slate-500">Saving updates stock levels and product cost/retail prices.</p>
                  )}
                </>
              ) : editingRecord.notes ? (
                <p className="text-sm text-slate-600">{editingRecord.notes}</p>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="w-12 p-2 text-center">SR</th>
                      <th className="min-w-[120px] p-2 text-left">
                        <button type="button" onClick={() => toggleEditLineSort('sku')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          SKU{editLineSortIcon('sku')}
                        </button>
                      </th>
                      <th className="min-w-[180px] p-2 pl-1 text-left">
                        <button type="button" onClick={() => toggleEditLineSort('product')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Product{editLineSortIcon('product')}
                        </button>
                      </th>
                      <th className="w-20 p-2">
                        <button type="button" onClick={() => toggleEditLineSort('qty')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Qty{editLineSortIcon('qty')}
                        </button>
                      </th>
                      <th className="w-28 p-2">
                        <button type="button" onClick={() => toggleEditLineSort('cost')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Cost{editLineSortIcon('cost')}
                        </button>
                      </th>
                      <th className="w-32 p-2">
                        <button type="button" onClick={() => toggleEditLineSort('retail')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Retail{editLineSortIcon('retail')}
                        </button>
                      </th>
                      <th className="w-24 p-2">
                        <button type="button" onClick={() => toggleEditLineSort('margin')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Margin %{editLineSortIcon('margin')}
                        </button>
                      </th>
                      <th className="w-28 p-2 text-right">
                        <button type="button" onClick={() => toggleEditLineSort('total')} className="font-medium hover:text-primary-700 dark:hover:text-primary-400">
                          Total{editLineSortIcon('total')}
                        </button>
                      </th>
                      {canEditRecord && <th className="w-10 p-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {canEditRecord ? (
                      sortedEditLines.map(({ idx, line, productName, productSku, retail, margin }, srIndex) => (
                        <tr key={line.productId} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="p-2 text-center text-slate-500">{srIndex + 1}</td>
                          <td className="p-2 font-mono text-xs text-slate-600 dark:text-slate-400">{productSku || '—'}</td>
                          <td className="p-2 pl-1">
                            <div className="font-medium">{productName}</div>
                          </td>
                          <td className="p-2">
                            <input type="number" min={1} value={line.qty} onChange={(e) => updateEditLine(idx, { qty: parseInt(e.target.value, 10) || 1 })} className="w-full min-w-[4rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
                          </td>
                          <td className="p-2">
                            <input type="number" min={0} step={0.01} value={line.unitCost} onChange={(e) => updateEditLine(idx, { unitCost: parseFloat(e.target.value) || 0 })} className="w-full min-w-[5rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
                          </td>
                          <td className="p-2">
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
                              className="w-full min-w-[6rem] rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                            />
                            {line.retailInput.includes('%') && <p className="text-xs text-slate-400">→ {retail.toFixed(2)}</p>}
                          </td>
                          <td className="p-2 text-center text-slate-600 dark:text-slate-400">{margin.toFixed(1)}%</td>
                          <td className="p-2 text-right font-medium">{(line.qty * line.unitCost).toFixed(2)}</td>
                          <td className="p-2 text-center">
                            <button type="button" className="text-red-500 text-xs hover:text-red-700" onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}>×</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      sortedViewItems.map((item, srIndex) => {
                        const margin = lineMarginPct(item.unitCost, item.unitRetail);
                        return (
                          <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="p-2 text-center text-slate-500">{srIndex + 1}</td>
                            <td className="p-2 font-mono text-xs text-slate-600 dark:text-slate-400">{item.productSku}</td>
                            <td className="p-2 pl-1">{item.productName}</td>
                            <td className="p-2 text-center">{item.qty}</td>
                            <td className="p-2 text-center">{item.unitCost.toFixed(2)}</td>
                            <td className="p-2 text-center">{item.unitRetail.toFixed(2)}</td>
                            <td className="p-2 text-center">{margin.toFixed(1)}%</td>
                            <td className="p-2 text-right">{item.lineTotal.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {(canEditRecord ? editLines.length > 0 : (editingRecord?.items.length ?? 0) > 0) && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800/80">
                        <td colSpan={3} className="p-1.5">Total</td>
                        <td className="p-1.5 text-center">{(canEditRecord ? editLineTotals : recordLineTotals)!.qtyTotal}</td>
                        <td className="p-1.5 text-center">{(canEditRecord ? editLineTotals : recordLineTotals)!.costTotal.toFixed(2)}</td>
                        <td className="p-1.5 text-center">{(canEditRecord ? editLineTotals : recordLineTotals)!.retailTotal.toFixed(2)}</td>
                        <td className="p-1.5 text-center text-slate-600 dark:text-slate-400">{(canEditRecord ? editLineTotals : recordLineTotals)!.margin.toFixed(1)}%</td>
                        <td className="p-1.5 text-right">{(canEditRecord ? editLineTotals : recordLineTotals)!.costTotal.toFixed(2)}</td>
                        {canEditRecord && <td className="p-1.5" />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {canEditRecord && (
                <div className="flex flex-wrap gap-2">
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
              {!canEditRecord && editingRecord.items.length > 0 && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => openPrintLabelsForGrn(editingRecord)}>
                    Print Labels
                  </Button>
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

      <Modal
        open={printLabelsOpen && !activeLabelTemplate}
        title="Print Labels?"
        onClose={() => setPrintLabelsOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrintLabelsOpen(false)}>Skip</Button>
          </>
        }
      >
        <p>No label template found. Create one in Label Designer first.</p>
      </Modal>

      {activeLabelTemplate && grnPreviewLayout && selectedGrn && (
        <LabelPrintPreviewModal
          open={printLabelsOpen}
          onClose={() => setPrintLabelsOpen(false)}
          onConfirm={handlePrintLabels}
          templateName={activeLabelTemplate.name}
          widthMm={activeLabelTemplate.widthMm}
          heightMm={activeLabelTemplate.heightMm}
          rollConfig={activeLabelTemplate.rollConfig}
          layout={grnPreviewLayout}
          labelCount={grnLabelCount}
          printing={labelPrinting}
          products={grnPreviewProducts}
          description={`GRN ${selectedGrn.grnNumber} · ${grnLabelCount} label${grnLabelCount !== 1 ? 's' : ''} for received items`}
          templateSelector={
            labelTemplates.length > 1 ? (
              <div>
                <h4 className="text-sm font-semibold mb-2">Template</h4>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {labelTemplates.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="grn-label-template"
                        checked={labelTemplateId === t.id}
                        onChange={() => {
                          setLabelTemplateId(t.id);
                          setLastTemplateId(t.id);
                        }}
                      />
                      <span>{t.name}</span>
                      <span className="text-slate-400">
                        ({t.widthMm}×{t.heightMm}mm · {t.rollConfig?.columns ?? 1}-up)
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : undefined
          }
        />
      )}

      {/* GRN Excel Import Modal */}
      <Modal open={grnImportOpen} onClose={() => setGrnImportOpen(false)} title="Import GRN Lines from Excel">
        <div className="space-y-4 w-full max-w-lg">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Use the <strong>⬇ Template</strong> button in the Add Products section to get the template.
            Fill in SKUs (e.g. <code className="bg-slate-100 px-1 rounded text-xs dark:bg-slate-800">SKU-FD-0001</code>)
            or product names to match existing inventory. Set the supplier and payment type first.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">Upload filled Excel file (.xlsx)</label>
            <input
              ref={grnImportFileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleGrnImportFile}
              disabled={grnImporting}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 dark:text-slate-300"
            />
            {grnImporting && <p className="mt-2 text-sm text-slate-500">Importing…</p>}
          </div>

          {grnImportErrors.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
              <p className="text-sm font-semibold mb-1 text-amber-800 dark:text-amber-200">
                Some rows could not be matched:
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {grnImportErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="ghost" onClick={() => setGrnImportOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
