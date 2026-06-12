import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { LabelCanvasPreview } from '@renderer/components/designer/LabelCanvasPreview';
import { normalizeLabelLayout } from '@mama-babi/printer';
import type { LabelTemplateSummary, Product } from '@shared/types';

const api = getApi();

export function LabelsPage() {
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [printing, setPrinting] = useState(false);
  const [currency, setCurrency] = useState('PKR');

  const load = async () => {
    const [t, p, s] = await Promise.all([
      api.labels.templates(),
      api.products.list(),
      api.settings.getAll(),
    ]);
    if (t.success) {
      setTemplates(t.data ?? []);
      const defaultTpl = t.data?.find((x) => x.isDefault) ?? t.data?.[0];
      if (defaultTpl) setSelectedTemplateId(defaultTpl.id);
    }
    if (p.success) setProducts(p.data ?? []);
    if (s.success && s.data?.currency) setCurrency(s.data.currency);
  };

  useEffect(() => { load(); }, []);

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

  const handlePrint = async () => {
    if (!selectedTemplateId || !selectedCount) return;
    setPrinting(true);
    const result = await api.labels.printBatch({
      templateId: selectedTemplateId,
      items: Object.entries(selected).map(([productId, copies]) => ({ productId, copies })),
    });
    if (result.success) {
      const mode = result.data?.printed ? 'sent to printer' : 'opened preview (no printer configured)';
      setMessage(`Printed ${result.data?.labelCount} labels — ${mode}`);
    } else {
      setMessage(result.error ?? 'Print failed');
    }
    setPrinting(false);
  };

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId);
  const previewProduct = products.find((p) => selected[p.id]);

  return (
    <div className="page-shell h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Label Batch Print</h2>
          <p className="text-sm text-slate-500 mt-1">Select products and print barcode labels using saved templates.</p>
        </div>
        <Link to="/label-designer">
          <Button variant="outline" size="sm">Edit templates in Label Designer</Button>
        </Link>
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
            <h3 className="font-semibold mb-3">Template</h3>
            <div className="space-y-2">
              {templates.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="template"
                    checked={selectedTemplateId === t.id}
                    onChange={() => setSelectedTemplateId(t.id)}
                  />
                  <span>{t.name}</span>
                  <span className="text-slate-400">({t.widthMm}×{t.heightMm}mm)</span>
                </label>
              ))}
            </div>
          </div>

          {activeTemplate && previewProduct && (
            <div className="panel p-4 flex flex-col items-center dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-semibold mb-3 text-sm self-start">Preview</h3>
              <LabelCanvasPreview
                layout={normalizeLabelLayout(activeTemplate.layout, activeTemplate.layout.storeName)}
                product={{
                  name: previewProduct.name,
                  sku: previewProduct.sku,
                  barcode: previewProduct.barcode,
                  price: previewProduct.salePrice ?? previewProduct.retailPrice,
                }}
                widthMm={activeTemplate.widthMm}
                heightMm={activeTemplate.heightMm}
                currency={currency}
                scale={4}
              />
            </div>
          )}

          <Button
            className="w-full"
            onClick={handlePrint}
            disabled={printing || !selectedCount || !selectedTemplateId}
          >
            {printing ? 'Printing...' : `Print ${totalLabels} Label${totalLabels !== 1 ? 's' : ''}`}
          </Button>
          <p className="text-xs text-slate-400 text-center">
            Configure label printer in Settings. Without one, a print preview opens.
          </p>
        </div>
      </div>
    </div>
  );
}
