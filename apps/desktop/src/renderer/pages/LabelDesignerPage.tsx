import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Type,
} from 'lucide-react';
import {
  defaultLabelElements,
  fontFormatFromFilename,
  fontNameFromFilename,
  LABEL_FONT_OPTIONS,
  LABEL_SIZE_PRESETS,
  clampLabelPositionPercent,
  labelElementLeftEdgeMm,
  labelLeftEdgeMmToAnchorPercent,
  labelMmToPercent,
  labelPercentToMm,
  LABEL_PRINT_PX_PER_MM,
  resolveBarcodeHeightPx,
  resolveBarcodePrintMetrics,
  isBarcodeBarWidthAuto,
  resolveLabelFontFamily,
  SAMPLE_LABEL_PRODUCT,
  SAMPLE_LABEL_PRODUCT_2,
  type LabelElement,
  type LabelFieldType,
} from '@mama-babi/printer';
import { Button, PageHeader, cn } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import {
  normalizeLabelTemplate,
  pickLabelTemplateId,
  resolveLabelLayoutForPreview,
} from '@renderer/lib/labelTemplateUtils';
import {
  LabelBatchPreview,
  LABEL_FIELD_META,
} from '@renderer/components/designer/LabelCanvasPreview';
import { LabelDesignerCanvas } from '@renderer/components/designer/LabelDesignerCanvas';
import { useLabelDefaultsStore } from '@renderer/stores/labelDefaultsStore';
import { useLabelTemplatesStore } from '@renderer/stores/labelTemplatesStore';
import type { LabelTemplateSummary } from '@shared/types';

const api = getApi();

const BATCH_SAMPLES = [SAMPLE_LABEL_PRODUCT, SAMPLE_LABEL_PRODUCT_2];

export function LabelDesignerPage() {
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [draft, setDraft] = useState<LabelTemplateSummary | null>(null);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('PKR');
  const [storeName, setStoreName] = useState('Store');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState('');
  const setLastTemplateId = useLabelDefaultsStore((s) => s.setLastTemplateId);
  const upsertTemplateInStore = useLabelTemplatesStore((s) => s.upsertTemplate);
  const setTemplatesInStore = useLabelTemplatesStore((s) => s.setTemplates);
  const templateRevision = useLabelTemplatesStore((s) => s.revision);
  const templatesInStore = useLabelTemplatesStore((s) => s.templates);
  const savingRef = useRef(false);
  const fontFileInputRef = useRef<HTMLInputElement>(null);
  const fontUploadTargetIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [tplRes, settingsRes] = await Promise.all([
      api.labels.templates(),
      api.settings.getAll(),
    ]);
    if (tplRes.success && tplRes.data?.length) {
      const settingsStoreName = settingsRes.data?.store_name;
      if (settingsStoreName) setStoreName(settingsStoreName);
      const normalizedList = tplRes.data.map((t) => normalizeLabelTemplate(t, settingsStoreName));
      setTemplates(normalizedList);
      setTemplatesInStore(normalizedList);
      const id = pickLabelTemplateId(normalizedList);
      const picked = normalizedList.find((t) => t.id === id) ?? normalizedList[0];
      setDraft(structuredClone(picked));
      setLastTemplateId(id);
    }
    if (settingsRes.success && settingsRes.data?.currency) {
      setCurrency(settingsRes.data.currency);
    }
  }, [setLastTemplateId, setTemplatesInStore]);

  useEffect(() => { load(); }, [load]);

  const previewLayout = draft ? resolveLabelLayoutForPreview(draft, storeName) : null;

  const dirty = useMemo(() => {
    const orig = templates.find((t) => t.id === draft?.id);
    return orig && draft ? JSON.stringify(orig) !== JSON.stringify(draft) : false;
  }, [templates, draft]);

  // Sync roll config (and full template when clean) after saves on Config / Labels pages.
  const prevRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevRevisionRef.current === null) {
      prevRevisionRef.current = templateRevision;
      return;
    }
    if (templateRevision === prevRevisionRef.current || !draft?.id) return;
    prevRevisionRef.current = templateRevision;

    const fresh = templatesInStore.find((t) => t.id === draft.id);
    if (!fresh) return;

    setTemplates((prev) => prev.map((t) => (t.id === fresh.id ? fresh : t)));
    setDraft((prev) => {
      if (!prev || prev.id !== fresh.id) return prev;
      const hasLocalLayoutEdits =
        JSON.stringify(prev.layout) !== JSON.stringify(fresh.layout) ||
        prev.widthMm !== fresh.widthMm ||
        prev.heightMm !== fresh.heightMm ||
        prev.name !== fresh.name;
      if (hasLocalLayoutEdits) {
        return { ...prev, rollConfig: fresh.rollConfig };
      }
      return structuredClone(fresh);
    });
  }, [templateRevision, templatesInStore, draft?.id]);

  const selectedEl = draft?.layout.elements?.find((e) => e.id === selectedElId);

  const selectedBarcodeHeightMm = useMemo(() => {
    if (!selectedEl || selectedEl.type !== 'barcode' || !draft) return 7;
    if (selectedEl.barcodeHeightMm != null && selectedEl.barcodeHeightMm > 0) {
      return selectedEl.barcodeHeightMm;
    }
    return (
      Math.round((resolveBarcodeHeightPx(selectedEl, draft.heightMm) / LABEL_PRINT_PX_PER_MM) * 10) / 10
    );
  }, [selectedEl, draft?.heightMm]);

  const selectedBarcodeMaxHeightMm = useMemo(() => {
    if (!selectedEl || !draft) return 15;
    return Math.max(3, Math.round((draft.heightMm * (1 - selectedEl.y / 100) - 0.5) * 10) / 10);
  }, [selectedEl, draft?.heightMm]);

  const selectedBarcodeMetrics = useMemo(() => {
    if (!selectedEl || selectedEl.type !== 'barcode' || !draft) return null;
    return resolveBarcodePrintMetrics(
      selectedEl,
      draft.widthMm,
      draft.heightMm,
      SAMPLE_LABEL_PRODUCT.barcode,
    );
  }, [selectedEl, draft?.widthMm, draft?.heightMm]);

  const selectedBarcodeBarWidthAuto = selectedEl?.type === 'barcode' && isBarcodeBarWidthAuto(selectedEl.barcodeBarWidth);

  const selectedBarcodeBarWidthSlider = useMemo(() => {
    if (!selectedBarcodeMetrics) return 2;
    if (selectedBarcodeBarWidthAuto) return selectedBarcodeMetrics.barWidth;
    return selectedEl?.barcodeBarWidth ?? selectedBarcodeMetrics.barWidth;
  }, [selectedBarcodeMetrics, selectedBarcodeBarWidthAuto, selectedEl?.barcodeBarWidth]);

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

  const openCustomFontPicker = (elementId: string) => {
    fontUploadTargetIdRef.current = elementId;
    fontFileInputRef.current?.click();
  };

  const handleCustomFontUpload = (file: File | undefined) => {
    const elementId = fontUploadTargetIdRef.current ?? selectedElId;
    if (!file || !elementId) return;
    if (!/\.ttf$/i.test(file.name)) {
      setMessage('Please choose a .ttf font file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Font file must be under 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const fontName = fontNameFromFilename(file.name);
      updateElement(elementId, {
        fontFamily: 'custom',
        customFontFamily: fontName,
        customFontDataUrl: reader.result as string,
        customFontFormat: fontFormatFromFilename(file.name),
      });
      setMessage(`Font "${fontName}" loaded. Save the template to keep it for printing.`);
    };
    reader.readAsDataURL(file);
    fontUploadTargetIdRef.current = null;
    if (fontFileInputRef.current) fontFileInputRef.current.value = '';
  };

  const clearCustomFont = (elementId: string) => {
    updateElement(elementId, {
      customFontFamily: undefined,
      customFontDataUrl: undefined,
      customFontFormat: undefined,
      fontFamily: 'segoe',
    });
  };

  const updateElementPosition = (id: string, patch: { x?: number; y?: number }) => {
    const next: Partial<LabelElement> = {};
    if (patch.x != null) next.x = clampLabelPositionPercent(patch.x);
    if (patch.y != null) next.y = clampLabelPositionPercent(patch.y);
    updateElement(id, next);
  };

  const previewBarcode = SAMPLE_LABEL_PRODUCT.barcode;

  const barcodeValueFor = (el: LabelElement) =>
    el.type === 'barcode' ? previewBarcode : undefined;

  const updateElementPositionMm = (
    id: string,
    axis: 'x' | 'y',
    mm: number,
    labelSizeMm: number,
  ) => {
    if (axis === 'y') {
      const percent = labelMmToPercent(Math.max(0, mm), labelSizeMm);
      updateElementPosition(id, { y: percent });
      return;
    }
    const el = draft?.layout.elements?.find((e) => e.id === id);
    if (!el) return;
    const x = labelLeftEdgeMmToAnchorPercent(
      Math.max(0, mm),
      el,
      labelSizeMm,
      barcodeValueFor(el),
      draft?.heightMm,
    );
    updateElementPosition(id, { x });
  };

  const updateElementAlign = (id: string, align: 'left' | 'center' | 'right') => {
    const el = draft?.layout.elements?.find((e) => e.id === id);
    if (!el || !draft) return;
    const leftMm = labelElementLeftEdgeMm(el, draft.widthMm, barcodeValueFor(el), draft.heightMm);
    const x = labelLeftEdgeMmToAnchorPercent(
      leftMm,
      { ...el, align },
      draft.widthMm,
      barcodeValueFor(el),
      draft.heightMm,
    );
    updateElement(id, { align, x });
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
      fontFamily: 'segoe',
      fontWeight: type === 'price' || type === 'storeName' ? 'bold' : 'normal',
      barcodeHeightMm:
        type === 'barcode'
          ? Math.min(10, Math.round(((draft?.heightMm ?? 25.4) * 0.28) * 10) / 10)
          : undefined,
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

  const handleSave = useCallback(async (options?: { silent?: boolean }): Promise<LabelTemplateSummary | null> => {
    if (!draft) return null;
    savingRef.current = true;
    setSaving(true);
    // Layout only — roll/printer settings are saved on Label Template Config page.
    const res = await api.templates.labelUpdate(draft.id, {
      name: draft.name,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      layout: structuredClone(draft.layout),
    });
    if (res.success && res.data) {
      const normalized = normalizeLabelTemplate(res.data, storeName);
      setTemplates((prev) => prev.map((t) => (t.id === normalized.id ? normalized : t)));
      setDraft(normalized);
      upsertTemplateInStore(normalized);
      setLastTemplateId(normalized.id);
      setMessage(options?.silent ? 'Saved to database.' : 'Label template saved to database.');
      setSaving(false);
      savingRef.current = false;
      return normalized;
    }
    setMessage(res.error ?? 'Save failed');
    setSaving(false);
    savingRef.current = false;
    return null;
  }, [draft, setLastTemplateId, storeName, upsertTemplateInStore]);

  const handleTestPrint = async () => {
    if (!draft) return;
    if (dirty) {
      setMessage('Save your design first, then print a test label.');
      return;
    }
    setPrinting(true);
    try {
      const res = await api.print.testLabel({ templateId: draft.id });
      setMessage(
        res.success
          ? `Test row sent (${res.data?.templateName ?? draft.name}) using the same template + roll config as Labels batch print.`
          : res.error ?? 'Print failed',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Print failed');
    } finally {
      setPrinting(false);
    }
  };

  const selectTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setDraft(structuredClone(tpl));
    setSelectedElId(null);
    setLastTemplateId(id);
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
        <Link to="/label-template-config" className="text-xs text-primary-600 hover:underline ml-2">Roll config →</Link>
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
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="section-label mb-1 block">Width (mm)</label>
                <input
                  type="number"
                  min={20}
                  max={100}
                  step={1}
                  value={draft.widthMm}
                  onChange={(e) => applySize(parseFloat(e.target.value) || draft.widthMm, draft.heightMm)}
                  className="form-input h-9 text-sm"
                />
              </div>
              <div>
                <label className="section-label mb-1 block">Height (mm)</label>
                <input
                  type="number"
                  min={15}
                  max={100}
                  step={1}
                  value={draft.heightMm}
                  onChange={(e) => applySize(draft.widthMm, parseFloat(e.target.value) || draft.heightMm)}
                  className="form-input h-9 text-sm"
                />
              </div>
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

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <div className="shrink-0 h-[min(38vh,300px)] min-h-[200px] rounded-xl border bg-slate-100/80">
            <LabelDesignerCanvas
              layout={previewLayout ?? draft.layout}
              product={SAMPLE_LABEL_PRODUCT}
              widthMm={draft.widthMm}
              heightMm={draft.heightMm}
              currency={currency}
              selectedId={selectedElId}
              onSelect={setSelectedElId}
              onMove={(id, x, y) => updateElementPosition(id, { x, y })}
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4 pb-2">
          {selectedEl && (
            <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-sm font-semibold mb-3">{LABEL_FIELD_META[selectedEl.type].label} Properties</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
                <div>
                  <label className="text-xs text-slate-500">X (mm, left edge)</label>
                  <input
                    type="number"
                    min={0}
                    max={draft.widthMm}
                    step={0.1}
                    value={labelElementLeftEdgeMm(
                      selectedEl,
                      draft.widthMm,
                      barcodeValueFor(selectedEl),
                      draft.heightMm,
                    )}
                    onChange={(e) =>
                      updateElementPositionMm(
                        selectedEl.id,
                        'x',
                        parseFloat(e.target.value) || 0,
                        draft.widthMm,
                      )
                    }
                    className="form-input w-full mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Y (mm from top)</label>
                  <input
                    type="number"
                    min={0}
                    max={draft.heightMm}
                    step={0.1}
                    value={labelPercentToMm(selectedEl.y, draft.heightMm)}
                    onChange={(e) =>
                      updateElementPositionMm(
                        selectedEl.id,
                        'y',
                        parseFloat(e.target.value) || 0,
                        draft.heightMm,
                      )
                    }
                    className="form-input w-full mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">X anchor (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedEl.x}
                    onChange={(e) =>
                      updateElementPosition(selectedEl.id, {
                        x: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="form-input w-full mt-1 h-9 text-sm"
                    title="Internal anchor point — use mm (left edge) for easier alignment"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Y (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={selectedEl.y}
                    onChange={(e) =>
                      updateElementPosition(selectedEl.id, {
                        y: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="form-input w-full mt-1 h-9 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 items-end w-full">
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
                {selectedEl.type === 'barcode' ? (
                  <>
                    <div>
                      <label className="text-xs text-slate-500">
                        Height ({selectedBarcodeHeightMm.toFixed(1)} mm)
                      </label>
                      <input
                        type="range"
                        min={3}
                        max={Math.max(3.5, selectedBarcodeMaxHeightMm)}
                        step={0.5}
                        value={selectedBarcodeHeightMm}
                        onChange={(e) =>
                          updateElement(selectedEl.id, { barcodeHeightMm: Number(e.target.value) })
                        }
                        className="block w-32 mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">
                        Bar width (
                        {selectedBarcodeBarWidthAuto
                          ? `auto ${selectedBarcodeBarWidthSlider.toFixed(1)}`
                          : selectedBarcodeBarWidthSlider.toFixed(1)}
                        )
                      </label>
                      <input
                        type="range"
                        min={selectedBarcodeMetrics?.minBarWidth ?? 0.5}
                        max={Math.max(
                          (selectedBarcodeMetrics?.minBarWidth ?? 0.5) + 0.1,
                          Math.round((selectedBarcodeMetrics?.maxBarWidth ?? 3) * 10) / 10,
                        )}
                        step={0.1}
                        value={selectedBarcodeBarWidthSlider}
                        onChange={(e) =>
                          updateElement(selectedEl.id, { barcodeBarWidth: Number(e.target.value) })
                        }
                        className="block w-32 mt-1"
                      />
                      {!selectedBarcodeBarWidthAuto && (
                        <button
                          type="button"
                          className="text-xs text-primary-600 hover:underline mt-1"
                          onClick={() =>
                            updateElement(selectedEl.id, { barcodeBarWidth: undefined })
                          }
                        >
                          Reset to auto width
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-xs text-slate-500">Font size</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={selectedEl.fontSize}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        updateElement(selectedEl.id, { fontSize: Math.max(1, next) });
                      }}
                      className="form-input w-full mt-1 h-9 text-sm"
                    />
                  </div>
                )}
                {selectedEl.type !== 'barcode' && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500">Font</label>
                      <select
                        className="form-input mt-1 h-9 text-sm min-w-[140px]"
                        value={selectedEl.fontFamily ?? 'segoe'}
                        onChange={(e) => {
                          const value = e.target.value as LabelElement['fontFamily'];
                          if (value === 'custom') {
                            updateElement(selectedEl.id, { fontFamily: 'custom' });
                            openCustomFontPicker(selectedEl.id);
                            return;
                          }
                          updateElement(selectedEl.id, {
                            fontFamily: value,
                            customFontFamily: undefined,
                            customFontDataUrl: undefined,
                            customFontFormat: undefined,
                          });
                        }}
                      >
                        {LABEL_FONT_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedEl.fontFamily === 'custom' && (
                      <div className="flex-1 min-w-[200px] space-y-2">
                        <input
                          ref={fontFileInputRef}
                          type="file"
                          accept=".ttf,font/ttf,application/x-font-ttf"
                          className="hidden"
                          onChange={(e) => handleCustomFontUpload(e.target.files?.[0])}
                        />
                        <label
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openCustomFontPicker(selectedEl.id);
                            }
                          }}
                          onClick={() => openCustomFontPicker(selectedEl.id)}
                          className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 hover:border-primary-300 hover:bg-primary-50/40 dark:border-slate-600 dark:bg-slate-900"
                        >
                          <Type className="h-5 w-5 text-slate-400" />
                          <span className="text-xs text-slate-600 text-center">
                            {selectedEl.customFontDataUrl
                              ? 'Choose another .ttf file'
                              : 'Choose .ttf font file'}
                          </span>
                        </label>
                        {selectedEl.customFontDataUrl && selectedEl.customFontFamily && (
                          <>
                            <p className="text-xs text-slate-600 truncate" title={selectedEl.customFontFamily}>
                              {selectedEl.customFontFamily}
                            </p>
                            <p
                              className="text-sm truncate border rounded px-2 py-1 bg-white dark:bg-slate-950"
                              style={{ fontFamily: resolveLabelFontFamily(selectedEl) }}
                            >
                              Preview Aa Bb 123
                            </p>
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => clearCustomFont(selectedEl.id)}
                            >
                              Remove font
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() => updateElementAlign(selectedEl.id, align)}
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

          <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-semibold mb-3">Batch Preview</h3>
            <p className="text-xs text-slate-500 mb-3">How multiple product labels will look with this template.</p>
            <LabelBatchPreview
              layout={previewLayout ?? draft.layout}
              products={BATCH_SAMPLES}
              widthMm={draft.widthMm}
              heightMm={draft.heightMm}
              currency={currency}
            />
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
