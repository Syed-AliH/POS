import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_LABEL_ROLL_CONFIG,
  LABEL_SIZE_PRESETS,
  MAMABABI_38_1x25_4_2UP_ROLL,
  calcPrintableWidth,
  normalizeLabelLayout,
  normalizeLabelRollConfig,
  SAMPLE_LABEL_PRODUCT,
  SAMPLE_LABEL_PRODUCT_2,
  type LabelRollConfig,
} from '@mama-babi/printer';
import { Button, PageHeader } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { LabelRollPreview } from '@renderer/components/designer/LabelRollPreview';
import {
  normalizeLabelTemplate,
  pickLabelTemplateId,
  resolveLabelLayoutForPreview,
} from '@renderer/lib/labelTemplateUtils';
import { useLabelDefaultsStore } from '@renderer/stores/labelDefaultsStore';
import { useLabelTemplatesStore } from '@renderer/stores/labelTemplatesStore';
import type { LabelTemplateSummary } from '@shared/types';

const api = getApi();

type Section = 'basic' | 'roll' | 'printer' | 'calibration';

function numInput(value: number, onChange: (v: number) => void, step = 0.5) {
  return (
    <input
      type="number"
      step={step}
      className="form-input w-full"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  );
}

export function LabelTemplateConfigPage() {
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [draft, setDraft] = useState<LabelTemplateSummary | null>(null);
  const [section, setSection] = useState<Section>('basic');
  const [currency, setCurrency] = useState('PKR');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feeding, setFeeding] = useState(false);
  const [storeName, setStoreName] = useState('Store');
  const setLastTemplateId = useLabelDefaultsStore((s) => s.setLastTemplateId);
  const upsertTemplateInStore = useLabelTemplatesStore((s) => s.upsertTemplate);

  const load = useCallback(async () => {
    const [tplRes, settingsRes] = await Promise.all([
      api.labels.templates(),
      api.settings.getAll(),
    ]);
    if (tplRes.success && tplRes.data?.length) {
      const settingsStoreName = settingsRes.data?.store_name;
      if (settingsStoreName) setStoreName(settingsStoreName);
      const normalized = tplRes.data.map((t) => normalizeLabelTemplate(t, settingsStoreName));
      setTemplates(normalized);
      setDraft((current) => {
        if (current && normalized.some((t) => t.id === current.id)) {
          return normalized.find((t) => t.id === current.id)!;
        }
        const id = pickLabelTemplateId(normalized);
        return normalized.find((t) => t.id === id) ?? normalized[0];
      });
    }
    if (settingsRes.success && settingsRes.data?.currency) {
      setCurrency(settingsRes.data.currency);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rollConfig = useMemo(
    () => normalizeLabelRollConfig(draft?.rollConfig),
    [draft?.rollConfig],
  );

  const printableWidth = draft
    ? calcPrintableWidth(rollConfig, draft.widthMm)
    : 0;

  const updateRoll = (patch: Partial<LabelRollConfig>) => {
    setDraft((prev) =>
      prev ? { ...prev, rollConfig: { ...normalizeLabelRollConfig(prev.rollConfig), ...patch } } : prev,
    );
  };

  const updateDraft = (patch: Partial<LabelTemplateSummary>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const result = await api.templates.labelUpdate(draft.id, {
      name: draft.name,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      rollConfig: draft.rollConfig,
    });
    setMessage(result.success ? 'Template saved' : result.error ?? 'Save failed');
    if (result.success && result.data) {
      const normalized = normalizeLabelTemplate(result.data, storeName);
      upsertTemplateInStore(normalized);
      setLastTemplateId(draft.id);
      await load();
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    const result = await api.templates.labelCreate({
      name: 'New Label Template',
      widthMm: 38,
      heightMm: 28,
      rollConfig: { ...DEFAULT_LABEL_ROLL_CONFIG },
    });
    if (result.success && result.data) {
      setDraft(result.data);
      await load();
      setMessage('Template created');
    }
  };

  const handleDelete = async () => {
    if (!draft || !confirm(`Delete "${draft.name}"?`)) return;
    const result = await api.templates.labelDelete(draft.id);
    if (result.success) {
      setMessage('Template deleted');
      setDraft(null);
      await load();
    }
  };

  const handleSetDefault = async () => {
    if (!draft) return;
    const result = await api.templates.labelSetDefault(draft.id);
    if (result.success) {
      setMessage('Default template updated');
      await load();
    }
  };

  const handleTestPrint = async () => {
    if (!draft) return;
    setPrinting(true);
    try {
      await handleSave();
      if (!draft) return;
      const result = await api.print.testLabel({ templateId: draft.id });
      setMessage(result.success ? 'Test label sent to printer' : result.error ?? 'Print failed');
    } finally {
      setPrinting(false);
    }
  };

  const handleFeed = async () => {
    if (!draft) return;
    setFeeding(true);
    const result = await api.labels.feed({
      rollConfig: draft.rollConfig,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
    });
    setMessage(result.success ? 'Label fed' : result.error ?? 'Feed failed');
    setFeeding(false);
  };

  const handleCalibrate = async () => {
    if (!draft) return;
    setFeeding(true);
    const result = await api.labels.calibrate({
      rollConfig: draft.rollConfig,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
    });
    setMessage(result.success ? 'Calibration sent to printer' : result.error ?? 'Calibration failed');
    setFeeding(false);
  };

  if (!draft) {
    return (
      <div className="page-shell">
        <PageHeader title="Label Template & Printer Config" />
        <p className="text-slate-500">No templates found.</p>
        <Button onClick={handleCreate}>Create template</Button>
      </div>
    );
  }

  const layout = draft ? resolveLabelLayoutForPreview(draft, storeName) : null;

  return (
    <div className="page-shell h-full overflow-y-auto">
      <PageHeader
        title="Label Template & Printer Config"
        description="Configure roll layout, gaps, margins, and alignment for multi-column thermal labels."
        actions={
          <div className="flex gap-2">
            <Link to="/label-designer">
              <Button variant="outline" size="sm">Label Designer</Button>
            </Link>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      />

      {message && (
        <div className="mb-4 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg text-sm">{message}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-3 space-y-4">
          <div className="panel p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Templates</h3>
              <Button variant="ghost" size="sm" onClick={handleCreate}>+ New</Button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDraft(structuredClone(t));
                    setLastTemplateId(t.id);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                    draft.id === t.id ? 'bg-primary-100 dark:bg-primary-900/40 font-medium' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {t.name}
                  {t.isDefault && <span className="ml-1 text-xs text-primary-600">★</span>}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={handleSetDefault}>
                Set default
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDelete}>Delete</Button>
            </div>
          </div>

          <nav className="panel p-2 dark:border-slate-700 dark:bg-slate-900 space-y-0.5">
            {([
              ['basic', 'Basic settings'],
              ['roll', 'Roll layout'],
              ['printer', 'Paper & scale'],
              ['calibration', 'Calibration'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  section === id ? 'bg-primary-100 dark:bg-primary-900/40 font-medium' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="col-span-5 panel p-5 dark:border-slate-700 dark:bg-slate-900 space-y-4">
          {section === 'basic' && (
            <>
              <h3 className="font-semibold">Basic settings</h3>
              <label className="block text-sm">
                Template name
                <input
                  className="form-input w-full mt-1"
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  Label width (mm)
                  {numInput(draft.widthMm, (v) => updateDraft({ widthMm: v }))}
                </label>
                <label className="block text-sm">
                  Label height (mm)
                  {numInput(draft.heightMm, (v) => updateDraft({ heightMm: v }))}
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  Columns (labels per row)
                  {numInput(rollConfig.columns, (v) => updateRoll({ columns: Math.max(1, Math.round(v)) }), 1)}
                </label>
                <label className="block text-sm">
                  Rows (1 = roll)
                  {numInput(rollConfig.rows, (v) => updateRoll({ rows: Math.max(1, Math.round(v)) }), 1)}
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {LABEL_SIZE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-50"
                    onClick={() => updateDraft({ widthMm: p.widthMm, heightMm: p.heightMm })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {section === 'roll' && (
            <>
              <h3 className="font-semibold">Roll layout</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100"
                  onClick={() =>
                    updateDraft({
                      widthMm: 38.1,
                      heightMm: 25.4,
                      rollConfig: { ...MAMABABI_38_1x25_4_2UP_ROLL },
                    })
                  }
                >
                  Apply Gainscha MamaBabi 2UP (38.1×25.4, gap 1.8 mm)
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Windows printer stock settings are ignored — the POS sends raw TSPL. Match your physical roll here.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  Horizontal gap (mm)
                  {numInput(rollConfig.horizontalGapMm, (v) => updateRoll({ horizontalGapMm: Math.max(0, v) }))}
                </label>
                <label className="block text-sm">
                  Vertical gap (mm)
                  {numInput(rollConfig.verticalGapMm, (v) => updateRoll({ verticalGapMm: Math.max(0, v) }))}
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">Left margin (mm){numInput(rollConfig.marginLeftMm, (v) => updateRoll({ marginLeftMm: v }))}</label>
                <label className="block text-sm">Right margin (mm){numInput(rollConfig.marginRightMm, (v) => updateRoll({ marginRightMm: v }))}</label>
                <label className="block text-sm">Top margin (mm){numInput(rollConfig.marginTopMm, (v) => updateRoll({ marginTopMm: v }))}</label>
                <label className="block text-sm">Bottom margin (mm){numInput(rollConfig.marginBottomMm, (v) => updateRoll({ marginBottomMm: v }))}</label>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded text-sm font-mono">
                Roll width = {rollConfig.marginLeftMm} + ({rollConfig.columns} × {draft.widthMm}) + ({Math.max(0, rollConfig.columns - 1)} × {rollConfig.horizontalGapMm}) + {rollConfig.marginRightMm}
                <br />
                <strong>= {printableWidth.toFixed(1)} mm</strong>
                <span className="text-slate-500"> · TSPL SIZE uses roll width; each label drawn at its slot position</span>
              </div>
            </>
          )}

          {section === 'printer' && (
            <>
              <h3 className="font-semibold">Paper type & scaling</h3>
              <label className="block text-sm">
                Paper type
                <select
                  className="form-input w-full mt-1"
                  value={rollConfig.paperType}
                  onChange={(e) => updateRoll({ paperType: e.target.value as LabelRollConfig['paperType'] })}
                >
                  <option value="gap">Gap labels</option>
                  <option value="black_mark">Black mark labels</option>
                  <option value="continuous">Continuous roll</option>
                </select>
              </label>
              <label className="block text-sm">
                DPI
                <select
                  className="form-input w-full mt-1"
                  value={rollConfig.dpi}
                  onChange={(e) => updateRoll({ dpi: Number(e.target.value) as 203 | 300 })}
                >
                  <option value={203}>203 DPI</option>
                  <option value={300}>300 DPI</option>
                </select>
              </label>
              <label className="block text-sm">
                Orientation
                <select
                  className="form-input w-full mt-1"
                  value={rollConfig.orientation}
                  onChange={(e) => updateRoll({ orientation: e.target.value as LabelRollConfig['orientation'] })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rollConfig.rotate180}
                  onChange={(e) => updateRoll({ rotate180: e.target.checked })}
                />
                Rotate 180°
              </label>
              <label className="block text-sm">
                Scaling
                <select
                  className="form-input w-full mt-1"
                  value={rollConfig.scaleMode}
                  onChange={(e) => updateRoll({ scaleMode: e.target.value as LabelRollConfig['scaleMode'] })}
                >
                  <option value="100">100%</option>
                  <option value="fit_width">Fit to width</option>
                  <option value="custom">Custom scale</option>
                </select>
              </label>
              {rollConfig.scaleMode === 'custom' && (
                <label className="block text-sm">
                  Custom scale (%)
                  {numInput(rollConfig.customScalePercent, (v) => updateRoll({ customScalePercent: v }), 1)}
                </label>
              )}
            </>
          )}

          {section === 'calibration' && (
            <>
              <h3 className="font-semibold">Label position calibration</h3>
              <p className="text-sm text-slate-500">
                Fine-tune alignment without changing template dimensions. Positive X/Y moves right/down.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  Horizontal offset X (mm)
                  {numInput(rollConfig.offsetXMm, (v) => updateRoll({ offsetXMm: v }))}
                </label>
                <label className="block text-sm">
                  Vertical offset Y (mm)
                  {numInput(rollConfig.offsetYMm, (v) => updateRoll({ offsetYMm: v }))}
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={handleFeed} disabled={feeding}>
                  Feed label
                </Button>
                <Button variant="outline" onClick={handleCalibrate} disabled={feeding}>
                  Calibrate printer
                </Button>
                <Button onClick={handleTestPrint} disabled={printing}>
                  {printing ? 'Printing…' : 'Print test label'}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="col-span-4 panel p-5 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-semibold mb-3">Live roll preview</h3>
          <div className="flex justify-center overflow-x-auto">
            <LabelRollPreview
              widthMm={draft.widthMm}
              heightMm={draft.heightMm}
              rollConfig={rollConfig}
              layout={layout!}
              products={[
                SAMPLE_LABEL_PRODUCT,
                SAMPLE_LABEL_PRODUCT_2,
                { ...SAMPLE_LABEL_PRODUCT, name: 'Stacking Blocks 12pc', sku: 'SKU-TO-0003' },
                { ...SAMPLE_LABEL_PRODUCT_2, name: 'Shape Sorter', sku: 'SKU-TO-0004' },
              ]}
              previewRows={2}
            />
          </div>
          <p className="text-xs text-slate-500 mt-4 text-center">
            Preview updates live when width, height, gaps, margins, or columns change.
            <br />
            Configure label printer in <Link to="/settings" className="text-primary-600 hover:underline">Settings → Printers</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
