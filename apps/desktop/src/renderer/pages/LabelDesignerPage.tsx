import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eye,
  EyeOff,
  Plus,
  Printer,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  defaultLabelElements,
  LABEL_SIZE_PRESETS,
  normalizeLabelLayout,
  SAMPLE_LABEL_PRODUCT,
  type LabelElement,
  type LabelFieldType,
} from '@mama-babi/printer';
import { Button, PageHeader, cn } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import {
  LabelBatchPreview,
  LabelCanvasPreview,
  LABEL_FIELD_META,
} from '@renderer/components/designer/LabelCanvasPreview';
import { useDebouncedTemplateSave } from '@renderer/hooks/useDebouncedTemplateSave';
import type { LabelTemplateSummary } from '@shared/types';

const api = getApi();

const BATCH_SAMPLES = [
  SAMPLE_LABEL_PRODUCT,
  { name: 'Cotton Onesie Set', sku: 'BB-ONS-012', barcode: '8901234567891', price: 890 },
  { name: 'Baby Wipes 80pk', sku: 'BB-WIP-080', barcode: '8901234567892', price: 450 },
];

export function LabelDesignerPage() {
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [draft, setDraft] = useState<LabelTemplateSummary | null>(null);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('PKR');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [tplRes, settingsRes] = await Promise.all([
      api.labels.templates(),
      api.settings.getAll(),
    ]);
    if (tplRes.success && tplRes.data?.length) {
      const normalizedList = tplRes.data.map(normalizeDraft);
      setTemplates(normalizedList);
      const def = normalizedList.find((t) => t.isDefault) ?? normalizedList[0];
      setDraft(structuredClone(def));
    }
    if (settingsRes.success && settingsRes.data?.currency) {
      setCurrency(settingsRes.data.currency);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function normalizeDraft(t: LabelTemplateSummary): LabelTemplateSummary {
    const layout = normalizeLabelLayout(t.layout, t.layout.storeName);
    if (!layout.elements?.length) layout.elements = defaultLabelElements();
    return { ...t, layout };
  }

  const dirty = useMemo(() => {
    const orig = templates.find((t) => t.id === draft?.id);
    return orig && draft ? JSON.stringify(orig) !== JSON.stringify(draft) : false;
  }, [templates, draft]);

  const selectedEl = draft?.layout.elements?.find((e) => e.id === selectedElId);

  const updateLayout = (patch: Partial<LabelTemplateSummary['layout']>) => {
    setDraft((prev) => prev ? { ...prev, layout: { ...prev.layout, ...patch } } : prev);
  };

  const updateElement = (id: string, patch: Partial<LabelElement>) => {
    setDraft((prev) => {
      if (!prev?.layout.elements) return prev;
      return {
        ...prev,
        layout: {
          ...prev.layout,
          elements: prev.layout.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        },
      };
    });
  };

  const addElement = (type: LabelFieldType) => {
    const el: LabelElement = {
      id: uuid(),
      type,
      visible: true,
      x: 10,
      y: 50,
      fontSize: 9,
      align: 'left',
      fontWeight: type === 'price' || type === 'storeName' ? 'bold' : 'normal',
      customText: type === 'customText' ? 'Your text here' : undefined,
    };
    updateLayout({ elements: [...(draft?.layout.elements ?? []), el] });
    setSelectedElId(el.id);
  };

  const removeElement = (id: string) => {
    updateLayout({ elements: draft?.layout.elements?.filter((e) => e.id !== id) });
    if (selectedElId === id) setSelectedElId(null);
  };

  const applySize = (widthMm: number, heightMm: number) => {
    setDraft((prev) => prev ? { ...prev, widthMm, heightMm } : prev);
  };

  const handleSave = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    const res = await api.templates.labelUpdate(draft.id, {
      name: draft.name,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      layout: draft.layout,
    });
    if (res.success && res.data) {
      const normalized = normalizeDraft(res.data);
      setTemplates((prev) => prev.map((t) => (t.id === normalized.id ? normalized : t)));
      setDraft(normalized);
      setMessage(options?.silent ? 'Saved to database.' : 'Label template saved to database.');
      setSaving(false);
      return true;
    }
    setMessage(res.error ?? 'Save failed');
    setSaving(false);
    return false;
  }, [draft]);

  useDebouncedTemplateSave(dirty, handleSave);

  const handleTestPrint = async () => {
    if (!draft) return;
    setPrinting(true);
    const res = await api.print.testLabel({
      layout: draft.layout,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
    });
    setMessage(
      res.success
        ? res.data?.printed
          ? 'Test label sent to printer.'
          : 'Print preview opened (configure label printer in Settings).'
        : res.error ?? 'Print failed',
    );
    setPrinting(false);
  };

  const selectTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setDraft(normalizeDraft(tpl));
    setSelectedElId(null);
  };

  if (!draft) {
    return (
      <div className="page-shell">
        <PageHeader title="Label Designer" subtitle="Loading template…" />
      </div>
    );
  }

  return (
    <div className="page-shell flex flex-col h-full min-h-0">
      <PageHeader
        title="Label Designer"
        subtitle="Drag elements on the label canvas — preview matches the printed sticker."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleTestPrint} disabled={printing}>
              <Printer className="h-4 w-4 mr-1.5" />
              {printing ? 'Printing…' : 'Print Test Label'}
            </Button>
            <Button size="sm" onClick={() => handleSave()} disabled={saving || !dirty}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save to Database'}
            </Button>
          </div>
        }
      />

      {message && (
        <div className="mb-4 rounded-lg bg-primary-50 px-4 py-2 text-sm text-primary-800">{message}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              draft.id === t.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200',
            )}
          >
            {t.name}
          </button>
        ))}
        <Link to="/labels" className="text-xs text-primary-600 hover:underline ml-2">Batch print →</Link>
        <Link to="/settings" className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600">
          <Settings2 className="h-3.5 w-3.5" /> Printer settings
        </Link>
      </div>

      <div className="flex flex-1 min-h-0 gap-5 overflow-hidden">
        <div className="w-64 shrink-0 overflow-y-auto space-y-4">
          <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Label Size</h3>
            <div className="grid grid-cols-1 gap-2">
              {LABEL_SIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applySize(p.widthMm, p.heightMm)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm text-left',
                    draft.widthMm === p.widthMm && draft.heightMm === p.heightMm
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Add Element</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(LABEL_FIELD_META) as LabelFieldType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addElement(type)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
                >
                  <Plus className="h-3 w-3" /> {LABEL_FIELD_META[type].label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Elements</h3>
            <div className="space-y-1">
              {draft.layout.elements?.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => setSelectedElId(el.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                    selectedElId === el.id ? 'bg-primary-50' : 'hover:bg-slate-50',
                  )}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); updateElement(el.id, { visible: !el.visible }); }}
                    className="text-slate-400"
                  >
                    {el.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </span>
                  <span className={cn('flex-1 truncate', !el.visible && 'line-through text-slate-400')}>
                    {LABEL_FIELD_META[el.type].label}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); removeElement(el.id); }}
                    className="text-slate-300 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-3 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.layout.showBarcodeGraphic ?? draft.layout.showBarcode ?? true}
                onChange={(e) => updateLayout({ showBarcodeGraphic: e.target.checked, showBarcode: e.target.checked })}
              />
              Show barcode graphic
            </label>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto flex items-center justify-center bg-slate-100/80 rounded-xl border py-10">
            <LabelCanvasPreview
              layout={draft.layout}
              product={SAMPLE_LABEL_PRODUCT}
              widthMm={draft.widthMm}
              heightMm={draft.heightMm}
              currency={currency}
              scale={5}
              interactive
              selectedId={selectedElId}
              onSelect={setSelectedElId}
              onMove={(id, x, y) => updateElement(id, { x, y })}
            />
          </div>

          {selectedEl && (
            <div className="mt-4 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-sm font-semibold mb-3">{LABEL_FIELD_META[selectedEl.type].label} Properties</h3>
              <div className="flex flex-wrap gap-4 items-end">
                {selectedEl.type === 'customText' && (
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs text-slate-500">Text</label>
                    <input
                      className="form-input w-full mt-1"
                      value={selectedEl.customText ?? ''}
                      onChange={(e) => updateElement(selectedEl.id, { customText: e.target.value })}
                    />
                  </div>
                )}
                {selectedEl.type === 'storeName' && (
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs text-slate-500">Store name override</label>
                    <input
                      className="form-input w-full mt-1"
                      value={draft.layout.storeName ?? ''}
                      onChange={(e) => updateLayout({ storeName: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-500">Font size</label>
                  <input
                    type="range"
                    min={6}
                    max={16}
                    value={selectedEl.fontSize}
                    onChange={(e) => updateElement(selectedEl.id, { fontSize: Number(e.target.value) })}
                    className="block w-32 mt-1"
                  />
                </div>
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() => updateElement(selectedEl.id, { align })}
                      className={cn(
                        'rounded border p-1.5',
                        selectedEl.align === align ? 'border-primary-500 bg-primary-50' : 'border-slate-200',
                      )}
                    >
                      {align === 'left' && <AlignLeft className="h-4 w-4" />}
                      {align === 'center' && <AlignCenter className="h-4 w-4" />}
                      {align === 'right' && <AlignRight className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateElement(selectedEl.id, { fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                  className={cn(
                    'rounded border p-1.5',
                    selectedEl.fontWeight === 'bold' ? 'border-primary-500 bg-primary-50' : 'border-slate-200',
                  )}
                >
                  <Bold className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-semibold mb-3">Batch Preview</h3>
            <p className="text-xs text-slate-500 mb-3">How multiple product labels will look with this template.</p>
            <LabelBatchPreview
              layout={draft.layout}
              products={BATCH_SAMPLES}
              widthMm={draft.widthMm}
              heightMm={draft.heightMm}
              currency={currency}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
