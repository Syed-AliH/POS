import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { LABEL_CANVAS_PREVIEW_SCALE } from '@mama-babi/printer';
import { getApi } from '@renderer/lib/api';
import { LabelCanvasPreview } from '@renderer/components/designer/LabelCanvasPreview';
import { LabelPrintPreviewModal } from '@renderer/components/designer/LabelRollPreview';
import {
  expandLabelPrintProducts,
  normalizeLabelTemplate,
  pickLabelTemplateId,
  productToLabelProduct,
  resolveLabelLayoutForPreview,
} from '@renderer/lib/labelTemplateUtils';
import { useLabelDefaultsStore } from '@renderer/stores/labelDefaultsStore';
import { useLabelTemplatesStore } from '@renderer/stores/labelTemplatesStore';
import type { LabelTemplateSummary, Product } from '@shared/types';

const api = getApi();

export function LabelsPage() {
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<LabelTemplateSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [printing, setPrinting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currency, setCurrency] = useState('PKR');
  const [storeName, setStoreName] = useState('Store');
  const lastTemplateId = useLabelDefaultsStore((s) => s.lastTemplateId);
  const setLastTemplateId = useLabelDefaultsStore((s) => s.setLastTemplateId);
  const templateRevision = useLabelTemplatesStore((s) => s.revision);

  const applyTemplate = useCallback((template: LabelTemplateSummary | null) => {
    setActiveTemplate(template);
  }, []);

  const refreshTemplates = useCallback(async (): Promise<LabelTemplateSummary[]> => {
    const [t, s] = await Promise.all([api.labels.templates(), api.settings.getAll()]);
    const settingsStoreName = s.success ? s.data?.store_name : undefined;
    if (settingsStoreName) setStoreName(settingsStoreName);
    if (s.success && s.data?.currency) setCurrency(s.data.currency);

    const list = t.success
      ? (t.data ?? []).map((tpl) => normalizeLabelTemplate(tpl, settingsStoreName))
      : [];

    if (list.length) {
      setTemplates(list);
      const preferredId = pickLabelTemplateId(list, lastTemplateId);
      setSelectedTemplateId(preferredId);
      applyTemplate(list.find((x) => x.id === preferredId) ?? null);
    }
    return list;
  }, [lastTemplateId, applyTemplate]);

  /** Fetch one template fresh from DB (before print). Does not touch the shared store. */
  const fetchTemplateById = useCallback(async (id: string) => {
    if (!id) return null;
    const [res, s] = await Promise.all([api.labels.getTemplate(id), api.settings.getAll()]);
    const settingsStoreName = s.success ? s.data?.store_name : undefined;
    if (settingsStoreName) setStoreName(settingsStoreName);
    if (!res.success || !res.data) return null;
    return normalizeLabelTemplate(res.data, settingsStoreName);
  }, []);

  const load = useCallback(async () => {
    const p = await api.products.list();
    await refreshTemplates();
    if (p.success) setProducts(p.data ?? []);
  }, [refreshTemplates]);

  useEffect(() => { void load(); }, [load]);

  // Reload when Label Designer saves (revision bumps there only).
  const prevRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevRevisionRef.current === null) {
      prevRevisionRef.current = templateRevision;
      return;
    }
    if (templateRevision === prevRevisionRef.current) return;
    prevRevisionRef.current = templateRevision;
    void refreshTemplates();
  }, [templateRevision, refreshTemplates]);

  useEffect(() => {
    const onFocus = () => { void refreshTemplates(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTemplates]);

  const filtered = search
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()) ||
          p.barcode.includes(search),
      )
    : products;

  const toggleProduct = (id: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  };

  const setCopies = (id: string, copies: number) => {
    setSelected((prev) => ({ ...prev, [id]: Math.max(1, copies) }));
  };

  const selectedCount = Object.keys(selected).length;
  const totalLabels = Object.values(selected).reduce((sum, n) => sum + n, 0);

  const runPrint = async () => {
    if (!selectedTemplateId || !selectedCount) return;
    setPrinting(true);
    setLastTemplateId(selectedTemplateId);

    const template = await fetchTemplateById(selectedTemplateId);
    if (!template) {
      setMessage('Label template not found. Open Label Designer, save your design, then try again.');
      setPrinting(false);
      return;
    }
    applyTemplate(template);

    const result = await api.labels.printBatch({
      templateId: selectedTemplateId,
      items: Object.entries(selected).map(([productId, copies]) => ({ productId, copies })),
    });
    if (result.success) {
      setMessage(
        `Printed ${result.data?.labelCount} label${result.data?.labelCount !== 1 ? 's' : ''} using "${template.name}"`,
      );
      setPreviewOpen(false);
    } else {
      setMessage(result.error ?? 'Print failed');
    }
    setPrinting(false);
  };

  const handlePrintClick = async () => {
    if (!selectedTemplateId || !selectedCount) return;
    const fresh = await fetchTemplateById(selectedTemplateId);
    if (fresh) applyTemplate(fresh);
    setPreviewOpen(true);
  };

  const previewProduct = products.find((p) => selected[p.id]);
  const previewLayout = activeTemplate
    ? resolveLabelLayoutForPreview(activeTemplate, storeName)
    : null;
  const rollPreviewProducts = expandLabelPrintProducts(
    products,
    Object.entries(selected).map(([productId, copies]) => ({ productId, copies })),
  );

  return (
    <div className="page-shell h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Label Batch Print</h2>
          <p className="text-sm text-slate-500 mt-1">Select products and print barcode labels using saved templates.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/label-template-config">
            <Button variant="outline" size="sm">Roll & printer config</Button>
          </Link>
          <Link to="/label-designer">
            <Button variant="outline" size="sm">Label Designer</Button>
          </Link>
        </div>
      </div>

      {message && <div className="mb-4 p-3 bg-primary-50 rounded-lg text-sm">{message}</div>}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 panel p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex gap-4 mb-4">
            <input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input flex-1"
            />
            <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Clear</Button>
          </div>
          <div className="max-h-[32rem] overflow-y-auto space-y-1">
            {filtered.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 p-2 rounded-lg border ${selected[p.id] ? 'bg-primary-50 border-primary-200' : 'border-transparent hover:bg-slate-50'}`}
              >
                <input
                  type="checkbox"
                  checked={!!selected[p.id]}
                  onChange={() => toggleProduct(p.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.sku} · {p.barcode}</div>
                </div>
                <div className="text-sm font-semibold w-20 text-right">
                  {currency} {(p.salePrice ?? p.retailPrice).toFixed(0)}
                </div>
                {selected[p.id] && (
                  <input
                    type="number"
                    min={1}
                    value={selected[p.id]}
                    onChange={(e) => setCopies(p.id, parseInt(e.target.value, 10) || 1)}
                    className="w-16 px-2 py-1 border rounded text-sm"
                    title="Copies"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Template</h3>
              <Button variant="ghost" size="sm" onClick={() => void refreshTemplates()}>
                Refresh
              </Button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Preview loads the exact layout saved in Label Designer for the selected template.
            </p>
            <div className="space-y-2">
              {templates.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="template"
                    checked={selectedTemplateId === t.id}
                    onChange={() => {
                      setSelectedTemplateId(t.id);
                      setLastTemplateId(t.id);
                      void fetchTemplateById(t.id).then((tpl) => tpl && applyTemplate(tpl));
                    }}
                  />
                  <span>
                    {t.name}
                    {t.id === lastTemplateId && (
                      <span className="ml-1 text-xs text-primary-600">(last edited)</span>
                    )}
                    {t.isDefault && (
                      <span className="ml-1 text-xs text-slate-400">★</span>
                    )}
                  </span>
                  <span className="text-slate-400">
                    ({t.widthMm}×{t.heightMm}mm · {t.rollConfig?.columns ?? 1}-up)
                  </span>
                </label>
              ))}
            </div>
          </div>

          {activeTemplate && previewProduct && previewLayout && (
            <div className="panel p-4 flex flex-col items-center dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-semibold mb-3 text-sm self-start">Single label preview</h3>
              <LabelCanvasPreview
                layout={previewLayout}
                product={productToLabelProduct(previewProduct)}
                widthMm={activeTemplate.widthMm}
                heightMm={activeTemplate.heightMm}
                currency={currency}
                scale={LABEL_CANVAS_PREVIEW_SCALE}
              />
            </div>
          )}

          <Button
            className="w-full"
            onClick={handlePrintClick}
            disabled={printing || !selectedCount || !selectedTemplateId}
          >
            {printing ? 'Printing...' : `Print ${totalLabels} Label${totalLabels !== 1 ? 's' : ''}`}
          </Button>
          <p className="text-xs text-slate-400 text-center">
            Print preview shows roll placement before sending to the Gainscha printer.
          </p>
        </div>
      </div>

      {activeTemplate && previewLayout && (
        <LabelPrintPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          onConfirm={runPrint}
          templateName={activeTemplate.name}
          widthMm={activeTemplate.widthMm}
          heightMm={activeTemplate.heightMm}
          rollConfig={activeTemplate.rollConfig}
          layout={previewLayout}
          labelCount={totalLabels}
          printing={printing}
          products={rollPreviewProducts}
        />
      )}
    </div>
  );
}
