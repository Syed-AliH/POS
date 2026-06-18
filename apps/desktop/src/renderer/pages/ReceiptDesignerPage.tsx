import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  ImagePlus,
  Printer,
  Save,
  Settings2,
  Smartphone,
  Type,
} from 'lucide-react';
import {
  DEFAULT_RECEIPT_SECTIONS,
  DEFAULT_RECEIPT_LABELS,
  DEFAULT_RECEIPT_STYLE,
  fontFormatFromFilename,
  fontNameFromFilename,
  RECEIPT_SECTION_LABELS,
  RECEIPT_STORE_FONTS,
  resolveReceiptSampleSale,
  resolveStoreNameFontFamily,
  SAMPLE_RECEIPT_SALE,
  type ReceiptSale,
  type ReceiptStoreFontKey,
  type ReceiptTemplateLabels,
  type ReceiptTemplateSections,
} from '@mama-babi/printer';
import { Button, PageHeader, cn } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { ThermalReceiptPreview, templateToConfig } from '@renderer/components/designer/ThermalReceiptPreview';
import { ReceiptCustomFontStyle } from '@renderer/components/designer/ReceiptCustomFontStyle';
import { useDebouncedTemplateSave } from '@renderer/hooks/useDebouncedTemplateSave';
import type { ReceiptTemplate } from '@shared/types';

const api = getApi();

type EditFocus =
  | keyof ReceiptTemplateSections
  | 'headerText'
  | 'thankYou'
  | 'returnPolicy'
  | 'taxInfo'
  | 'qrCode'
  | 'bodyStyle'
  | 'dividers'
  | 'customHeaderLine'
  | 'customFooterLine'
  | null;

type ContentBlock = {
  key: EditFocus;
  label: string;
  sectionKey?: keyof ReceiptTemplateSections;
};

const CONTENT_SECTIONS: ContentBlock[] = [
  { key: 'showLogo', label: 'Logo', sectionKey: 'showLogo' },
  { key: 'showStoreName', label: 'Store Name', sectionKey: 'showStoreName' },
  { key: 'showAddress', label: 'Address', sectionKey: 'showAddress' },
  { key: 'showPhone', label: 'Contact (Phone / Email)', sectionKey: 'showPhone' },
  { key: 'headerText', label: 'Header Text', sectionKey: 'showHeaderText' },
  { key: 'customHeaderLine', label: 'Custom Header Line' },
  { key: 'showSaleNumber', label: 'Receipt Number', sectionKey: 'showSaleNumber' },
  { key: 'showDate', label: 'Date & Time', sectionKey: 'showDate' },
  { key: 'showCashier', label: 'Cashier', sectionKey: 'showCashier' },
  { key: 'showItems', label: 'Line Items', sectionKey: 'showItems' },
  { key: 'showSubtotal', label: 'Subtotal / Totals', sectionKey: 'showSubtotal' },
  { key: 'showPayment', label: 'Payment Details', sectionKey: 'showPayment' },
  { key: 'thankYou', label: 'Thank You Message', sectionKey: 'showThankYou' },
  { key: 'returnPolicy', label: 'Return Policy', sectionKey: 'showReturnPolicy' },
  { key: 'taxInfo', label: 'Tax Information', sectionKey: 'showTaxInfo' },
  { key: 'customFooterLine', label: 'Custom Footer Line' },
  { key: 'qrCode', label: 'QR Code', sectionKey: 'showQrCode' },
  { key: 'dividers', label: 'Divider Lines' },
  { key: 'bodyStyle', label: 'Typography & Sizes' },
];

export function ReceiptDesignerPage() {
  const [templates, setTemplates] = useState<ReceiptTemplate[]>([]);
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState<ReceiptTemplate | null>(null);
  const [focus, setFocus] = useState<EditFocus>(null);
  const [currency, setCurrency] = useState('PKR');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [tplRes, settingsRes] = await Promise.all([
      api.templates.receiptList(),
      api.settings.getAll(),
    ]);
    if (tplRes.success && tplRes.data?.length) {
      setTemplates(tplRes.data);
      const def = tplRes.data.find((t) => t.isDefault) ?? tplRes.data[0];
      setActiveId(def.id);
      setDraft(structuredClone(def));
    }
    if (settingsRes.success && settingsRes.data?.currency) {
      setCurrency(settingsRes.data.currency);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    const orig = templates.find((t) => t.id === activeId);
    return orig && draft ? JSON.stringify(orig) !== JSON.stringify(draft) : false;
  }, [templates, activeId, draft]);

  const updateDraft = (patch: Partial<ReceiptTemplate>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateLabel = (key: keyof ReceiptTemplateLabels, value: string) => {
    if (!draft) return;
    updateDraft({
      header: {
        ...draft.header,
        labels: { ...draft.header.labels, [key]: value },
      },
    });
  };

  const labels = { ...DEFAULT_RECEIPT_LABELS, ...draft?.header.labels };
  const bodyStyle = { ...DEFAULT_RECEIPT_STYLE, ...draft?.header.style };
  const sections = { ...DEFAULT_RECEIPT_SECTIONS, ...draft?.sections };

  const updateStyle = (patch: Partial<typeof bodyStyle>) => {
    if (!draft) return;
    updateDraft({
      header: {
        ...draft.header,
        style: { ...draft.header.style, ...patch },
      },
    });
  };

  const labelField = (id: keyof ReceiptTemplateLabels, label: string) => (
    <div key={id}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        className="form-input w-full"
        value={labels[id]}
        onChange={(e) => updateLabel(id, e.target.value)}
      />
    </div>
  );

  const sampleNote = (
    <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2">
      Preview and test print use this text. Real checkout sales replace it automatically.
    </p>
  );

  const sampleSale = draft
    ? resolveReceiptSampleSale(templateToConfig(draft), SAMPLE_RECEIPT_SALE)
    : SAMPLE_RECEIPT_SALE;

  const updateSample = (patch: Partial<ReceiptSale>) => {
    if (!draft) return;
    updateDraft({
      header: {
        ...draft.header,
        sampleSale: { ...draft.header.sampleSale, ...patch },
      },
    });
  };

  const updateSampleItem = (index: number, patch: Partial<ReceiptSale['items'][number]>) => {
    const items = [...sampleSale.items];
    const current = items[index];
    if (!current) return;
    const next = { ...current, ...patch };
    if (patch.quantity != null || patch.unitPrice != null) {
      next.lineTotal = (patch.quantity ?? next.quantity) * (patch.unitPrice ?? next.unitPrice);
    }
    items[index] = next;
    updateSample({ items });
  };

  const addSampleItem = () => {
    updateSample({
      items: [
        ...sampleSale.items,
        { productName: 'New product', quantity: 1, unitPrice: 0, lineTotal: 0 },
      ],
    });
  };

  const removeSampleItem = (index: number) => {
    updateSample({ items: sampleSale.items.filter((_, i) => i !== index) });
  };

  const handleBodyCustomFontUpload = (file: File | undefined) => {
    if (!file) return;
    const allowed = /\.(ttf|otf|woff2?)$/i;
    if (!allowed.test(file.name)) {
      setMessage('Use a .ttf, .otf, .woff, or .woff2 font file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Font file must be under 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateStyle({
        customFontName: fontNameFromFilename(file.name),
        customFontDataUrl: reader.result as string,
        customFontFormat: fontFormatFromFilename(file.name),
      });
      setMessage(`Body font "${fontNameFromFilename(file.name)}" loaded.`);
    };
    reader.readAsDataURL(file);
  };

  const toggleSection = (key: keyof ReceiptTemplateSections) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, sections: { ...prev.sections, [key]: !prev.sections[key] } };
    });
  };

  const handleLogoUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateDraft({ header: { ...draft!.header, logoDataUrl: reader.result as string } });
    };
    reader.readAsDataURL(file);
  };

  const handleCustomFontUpload = (file: File | undefined) => {
    if (!file) return;
    const allowed = /\.(ttf|otf|woff2?)$/i;
    if (!allowed.test(file.name)) {
      setMessage('Use a .ttf, .otf, .woff, or .woff2 font file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Font file must be under 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateDraft({
        header: {
          ...draft!.header,
          storeNameFontFamily: 'custom',
          storeNameCustomFontName: fontNameFromFilename(file.name),
          storeNameCustomFontDataUrl: reader.result as string,
          storeNameCustomFontFormat: fontFormatFromFilename(file.name),
        },
      });
      setMessage(`Font "${fontNameFromFilename(file.name)}" loaded.`);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    const res = await api.templates.receiptUpdate(draft.id, {
      name: draft.name,
      widthMm: draft.widthMm,
      sections: draft.sections,
      header: draft.header,
      footer: draft.footer,
    });
    if (res.success && res.data) {
      setTemplates((prev) => prev.map((t) => (t.id === res.data!.id ? res.data! : t)));
      setDraft(structuredClone(res.data));
      setMessage(options?.silent ? 'Saved to database.' : 'Receipt template saved to database.');
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
    const res = await api.print.testReceipt(templateToConfig(draft));
    setMessage(
      res.success
        ? res.data?.printed
          ? 'Test receipt sent to printer.'
          : 'Print preview opened — pick a receipt printer in Settings → Printers for silent printing.'
        : res.error ?? 'Print failed',
    );
    setPrinting(false);
  };

  const selectTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setActiveId(id);
    setDraft(structuredClone(tpl));
    setFocus(null);
  };

  if (!draft) {
    return (
      <div className="page-shell">
        <PageHeader title="Receipt Designer" subtitle="Loading template…" />
      </div>
    );
  }

  const panelContent = () => {
    switch (focus) {
      case 'showLogo':
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Upload your shop logo. Toggle visibility in the list to show or hide on receipts.</p>
            <label className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 cursor-pointer hover:border-primary-300 hover:bg-primary-50/30">
              <ImagePlus className="h-8 w-8 text-slate-400" />
              <span className="text-sm text-slate-600">Upload logo image</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
            </label>
            {draft.header.logoDataUrl && (
              <>
                <img src={draft.header.logoDataUrl} alt="Logo preview" className="mx-auto max-h-16 object-contain" />
                <Button size="sm" variant="ghost" onClick={() => updateDraft({ header: { ...draft.header, logoDataUrl: undefined } })}>
                  Remove logo
                </Button>
              </>
            )}
          </div>
        );
      case 'showStoreName':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Shop Name</label>
              <input
                className="form-input w-full"
                placeholder="Your shop name"
                value={draft.header.storeName ?? ''}
                onChange={(e) => updateDraft({ header: { ...draft.header, storeName: e.target.value } })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Font</label>
              <select
                className="form-input w-full"
                value={draft.header.storeNameFontFamily ?? 'sans'}
                onChange={(e) => updateDraft({
                  header: { ...draft.header, storeNameFontFamily: e.target.value as ReceiptStoreFontKey },
                })}
              >
                {Object.entries(RECEIPT_STORE_FONTS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            {draft.header.storeNameFontFamily === 'custom' && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 hover:border-primary-300 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-primary-600">
                  <Type className="h-7 w-7 text-slate-400" />
                  <span className="text-sm text-slate-600 text-center">Upload font (.ttf, .otf, .woff, .woff2)</span>
                  <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                    className="hidden"
                    onChange={(e) => handleCustomFontUpload(e.target.files?.[0])}
                  />
                </label>
                {draft.header.storeNameCustomFontDataUrl ? (
                  <>
                    <ReceiptCustomFontStyle header={draft.header} />
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Font display name</label>
                      <input
                        className="form-input w-full text-sm"
                        value={draft.header.storeNameCustomFontName ?? ''}
                        onChange={(e) => updateDraft({
                          header: { ...draft.header, storeNameCustomFontName: e.target.value },
                        })}
                      />
                    </div>
                    <p
                      className="text-center text-lg py-1"
                      style={{ fontFamily: resolveStoreNameFontFamily(draft.header) }}
                    >
                      {draft.header.storeName || 'Preview Aa Bb 123'}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateDraft({
                        header: {
                          ...draft.header,
                          storeNameCustomFontName: undefined,
                          storeNameCustomFontDataUrl: undefined,
                          storeNameCustomFontFormat: undefined,
                        },
                      })}
                    >
                      Remove custom font
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Upload a font file to preview your shop name with it. Save the template to keep it.</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                Size — {draft.header.storeNameFontSize ?? 14}px
              </label>
              <input
                type="range"
                min={10}
                max={28}
                value={draft.header.storeNameFontSize ?? 14}
                onChange={(e) => updateDraft({ header: { ...draft.header, storeNameFontSize: Number(e.target.value) } })}
                className="w-full"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.header.storeNameFontWeight !== 'normal'}
                  onChange={(e) => updateDraft({
                    header: { ...draft.header, storeNameFontWeight: e.target.checked ? 'bold' : 'normal' },
                  })}
                />
                Bold
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.header.storeNameUppercase !== false}
                  onChange={(e) => updateDraft({
                    header: { ...draft.header, storeNameUppercase: e.target.checked },
                  })}
                />
                Uppercase
              </label>
            </div>
          </div>
        );
      case 'showAddress':
        return (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Address</label>
            <textarea
              className="form-input w-full min-h-[80px]"
              value={draft.header.address ?? ''}
              onChange={(e) => updateDraft({ header: { ...draft.header, address: e.target.value } })}
            />
          </div>
        );
      case 'showPhone':
        return (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Phone</label>
            <input
              className="form-input w-full"
              value={draft.header.phone ?? ''}
              onChange={(e) => updateDraft({ header: { ...draft.header, phone: e.target.value } })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.sections.showEmail} onChange={() => toggleSection('showEmail')} />
              Show email on receipt
            </label>
            {draft.sections.showEmail && (
              <input
                className="form-input w-full"
                placeholder="Email"
                value={draft.header.email ?? ''}
                onChange={(e) => updateDraft({ header: { ...draft.header, email: e.target.value } })}
              />
            )}
          </div>
        );
      case 'headerText':
        return (
          <textarea
            className="form-input w-full min-h-[80px]"
            placeholder="Promotional header text…"
            value={draft.header.headerText ?? ''}
            onChange={(e) => updateDraft({ header: { ...draft.header, headerText: e.target.value } })}
          />
        );
      case 'thankYou':
        return (
          <textarea
            className="form-input w-full min-h-[80px]"
            value={draft.footer.thankYouMessage ?? draft.footer.message ?? ''}
            onChange={(e) => updateDraft({ footer: { ...draft.footer, thankYouMessage: e.target.value, message: e.target.value } })}
          />
        );
      case 'returnPolicy':
        return (
          <textarea
            className="form-input w-full min-h-[80px]"
            value={draft.footer.returnPolicy ?? ''}
            onChange={(e) => updateDraft({ footer: { ...draft.footer, returnPolicy: e.target.value } })}
          />
        );
      case 'taxInfo':
        return (
          <textarea
            className="form-input w-full min-h-[80px]"
            placeholder="NTN / tax registration details…"
            value={draft.footer.taxInfo ?? ''}
            onChange={(e) => updateDraft({ footer: { ...draft.footer, taxInfo: e.target.value } })}
          />
        );
      case 'qrCode':
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">QR encodes this text (defaults to receipt number when printing).</p>
            <input
              className="form-input w-full"
              placeholder="https://yourstore.com or receipt ID"
              value={draft.footer.qrCodeContent ?? ''}
              onChange={(e) => updateDraft({ footer: { ...draft.footer, qrCodeContent: e.target.value } })}
            />
          </div>
        );
      case 'customHeaderLine':
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Extra centered line below the header (e.g. branch name, slogan).</p>
            <textarea
              className="form-input w-full min-h-[80px]"
              placeholder="Optional header line…"
              value={draft.header.customLine ?? ''}
              onChange={(e) => updateDraft({ header: { ...draft.header, customLine: e.target.value } })}
            />
          </div>
        );
      case 'customFooterLine':
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Extra centered line above the bottom divider (e.g. website, social handle).</p>
            <textarea
              className="form-input w-full min-h-[80px]"
              placeholder="Optional footer line…"
              value={draft.footer.customLine ?? ''}
              onChange={(e) => updateDraft({ footer: { ...draft.footer, customLine: e.target.value } })}
            />
          </div>
        );
      case 'showSaleNumber':
        return (
          <div className="space-y-3">
            {sampleNote}
            {labelField('receiptNumber', 'Label')}
            <div>
              <label className="block text-sm font-medium mb-1">Sample receipt number</label>
              <input
                className="form-input w-full"
                value={sampleSale.saleNumber}
                onChange={(e) => updateSample({ saleNumber: e.target.value })}
              />
            </div>
          </div>
        );
      case 'showDate':
        return (
          <div className="space-y-3">
            {sampleNote}
            {labelField('date', 'Label')}
            <div>
              <label className="block text-sm font-medium mb-1">Sample date &amp; time</label>
              <input
                className="form-input w-full"
                value={sampleSale.createdAt.slice(0, 16)}
                onChange={(e) => updateSample({ createdAt: new Date(e.target.value).toISOString() })}
                type="datetime-local"
              />
            </div>
          </div>
        );
      case 'showCashier':
        return (
          <div className="space-y-3">
            {sampleNote}
            {labelField('cashier', 'Label')}
            <div>
              <label className="block text-sm font-medium mb-1">Sample cashier name</label>
              <input
                className="form-input w-full"
                value={sampleSale.cashierName}
                onChange={(e) => updateSample({ cashierName: e.target.value })}
              />
            </div>
          </div>
        );
      case 'showItems':
        return (
          <div className="space-y-3">
            {sampleNote}
            {sampleSale.items.map((item, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <input
                  className="form-input w-full text-sm"
                  placeholder="Product name"
                  value={item.productName}
                  onChange={(e) => updateSampleItem(i, { productName: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-500">Qty</label>
                    <input
                      type="number"
                      min={1}
                      className="form-input w-full text-sm"
                      value={item.quantity}
                      onChange={(e) => updateSampleItem(i, { quantity: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Unit price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="form-input w-full text-sm"
                      value={item.unitPrice}
                      onChange={(e) => updateSampleItem(i, { unitPrice: Number(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeSampleItem(i)}>Remove line</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addSampleItem}>Add line item</Button>
          </div>
        );
      case 'showSubtotal':
        return (
          <div className="space-y-4">
            {sampleNote}
            {labelField('subtotal', 'Subtotal label')}
            {labelField('discount', 'Discount label')}
            {labelField('tax', 'Tax label')}
            {labelField('total', 'Total label')}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <div>
                <label className="text-xs text-slate-500">Sample subtotal</label>
                <input type="number" className="form-input w-full text-sm" value={sampleSale.subtotal}
                  onChange={(e) => updateSample({ subtotal: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Sample discount</label>
                <input type="number" className="form-input w-full text-sm" value={sampleSale.discountAmount}
                  onChange={(e) => updateSample({ discountAmount: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Sample tax</label>
                <input type="number" className="form-input w-full text-sm" value={sampleSale.taxAmount}
                  onChange={(e) => updateSample({ taxAmount: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Sample total</label>
                <input type="number" className="form-input w-full text-sm" value={sampleSale.totalAmount}
                  onChange={(e) => updateSample({ totalAmount: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sections.showSubtotal} onChange={() => toggleSection('showSubtotal')} />
                Show subtotal row
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sections.showDiscount} onChange={() => toggleSection('showDiscount')} />
                Show discount row
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sections.showTax} onChange={() => toggleSection('showTax')} />
                Show tax row
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sections.showTotal} onChange={() => toggleSection('showTotal')} />
                Show total row
              </label>
            </div>
          </div>
        );
      case 'showPayment':
        return (
          <div className="space-y-4">
            {sampleNote}
            {labelField('payment', 'Payment label')}
            {labelField('tendered', 'Tendered label')}
            {labelField('change', 'Change label')}
            <div>
              <label className="block text-sm font-medium mb-1">Sample payment method</label>
              <input
                className="form-input w-full"
                value={sampleSale.paymentMethod}
                onChange={(e) => updateSample({ paymentMethod: e.target.value })}
                placeholder="cash, card, wallet…"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500">Sample tendered</label>
                <input type="number" className="form-input w-full text-sm"
                  value={sampleSale.amountTendered ?? ''}
                  onChange={(e) => updateSample({ amountTendered: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Sample change</label>
                <input type="number" className="form-input w-full text-sm"
                  value={sampleSale.changeGiven ?? ''}
                  onChange={(e) => updateSample({ changeGiven: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>
          </div>
        );
      case 'dividers':
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Toggle each line on or off and change the characters used. Click a line on the preview to jump here.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Heavy line character</label>
                <input
                  className="form-input w-full text-center text-lg"
                  maxLength={3}
                  value={bodyStyle.dividerChar}
                  onChange={(e) => updateStyle({ dividerChar: e.target.value.slice(0, 1) || '═' })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Light line character</label>
                <input
                  className="form-input w-full text-center text-lg"
                  maxLength={3}
                  value={bodyStyle.dashChar}
                  onChange={(e) => updateStyle({ dashChar: e.target.value.slice(0, 1) || '─' })}
                />
              </div>
            </div>
            {([
              ['showHeaderDivider', 'After header (logo, store name, address)'] as const,
              ['showMetaDivider', 'After receipt # / date / cashier'] as const,
              ['showBeforeTotalsDivider', 'Before subtotal & totals'] as const,
              ['showBeforePaymentDivider', 'Before payment details'] as const,
              ['showFooterDivider', 'Around footer (thank you, policy, QR)'] as const,
            ]).map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={bodyStyle[key]}
                  onChange={(e) => updateStyle({ [key]: e.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        );
      case 'bodyStyle':
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Font families and sizes for each part of the receipt.</p>
            {([
              ['bodyFontFamily', 'Body text (payment, general)'] as const,
              ['itemFontFamily', 'Line item product names'] as const,
              ['metaFontFamily', 'Receipt #, date, cashier'] as const,
              ['footerFontFamily', 'Thank you, policy, fine print'] as const,
            ]).map(([key, label]) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">{label}</label>
                <select
                  className="form-input w-full"
                  value={bodyStyle[key]}
                  onChange={(e) => updateStyle({ [key]: e.target.value as ReceiptStoreFontKey })}
                >
                  {Object.entries(RECEIPT_STORE_FONTS).map(([k, { label: fontLabel }]) => (
                    <option key={k} value={k}>{fontLabel}</option>
                  ))}
                </select>
              </div>
            ))}
            {(bodyStyle.bodyFontFamily === 'custom' ||
              bodyStyle.itemFontFamily === 'custom' ||
              bodyStyle.metaFontFamily === 'custom' ||
              bodyStyle.footerFontFamily === 'custom') && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 hover:border-primary-300">
                  <Type className="h-7 w-7 text-slate-400" />
                  <span className="text-sm text-slate-600 text-center">Upload shared body font</span>
                  <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                    className="hidden"
                    onChange={(e) => handleBodyCustomFontUpload(e.target.files?.[0])}
                  />
                </label>
                {bodyStyle.customFontDataUrl && draft && (
                  <>
                    <ReceiptCustomFontStyle header={draft.header} />
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Font display name</label>
                      <input
                        className="form-input w-full text-sm"
                        value={bodyStyle.customFontName ?? ''}
                        onChange={(e) => updateStyle({ customFontName: e.target.value })}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStyle({
                        customFontName: undefined,
                        customFontDataUrl: undefined,
                        customFontFormat: undefined,
                      })}
                    >
                      Remove custom font
                    </Button>
                  </>
                )}
              </div>
            )}
            <div className="border-t border-slate-100 pt-3 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Font sizes (preview px)</p>
              {([
                ['bodyFontSize', 'Body text', 9, 14] as const,
                ['smallFontSize', 'Small text (item prices)', 8, 12] as const,
                ['totalFontSize', 'Total row', 10, 16] as const,
                ['footerFontSize', 'Fine print', 7, 11] as const,
              ]).map(([key, label, min, max]) => (
                <div key={key}>
                  <label className="block text-sm font-medium mb-1">{label} — {bodyStyle[key]}px</label>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={bodyStyle[key]}
                    onChange={(e) => updateStyle({ [key]: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      default:
        return (
          <p className="text-sm text-slate-500 py-4">
            Click a section on the receipt preview or choose a block from the list to edit its content.
          </p>
        );
    }
  };

  const panelTitle = () => {
    if (!focus) return 'Edit Content';
    const block = CONTENT_SECTIONS.find((c) => c.key === focus);
    if (block) return block.label;
    return RECEIPT_SECTION_LABELS[focus as keyof ReceiptTemplateSections] ?? 'Edit';
  };

  return (
    <div className="page-shell flex flex-col h-full min-h-0">
      <PageHeader
        title="Receipt Designer"
        subtitle="Design your thermal receipt with live preview — what you see is what prints."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleTestPrint} disabled={printing}>
              <Printer className="h-4 w-4 mr-1.5" />
              {printing ? 'Printing…' : 'Print Test Receipt'}
            </Button>
            <Button size="sm" onClick={() => handleSave()} disabled={saving || !dirty}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save to Database'}
            </Button>
          </div>
        }
      />

      {message && (
        <div className="mb-4 rounded-lg bg-primary-50 px-4 py-2 text-sm text-primary-800 dark:bg-primary-950 dark:text-primary-200">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              activeId === t.id
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-slate-200 hover:border-slate-300',
            )}
          >
            {t.name}
          </button>
        ))}
        <Link to="/settings" className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600">
          <Settings2 className="h-3.5 w-3.5" /> Printer settings
        </Link>
      </div>

      <div className="flex flex-1 min-h-0 gap-6 overflow-hidden">
        <div className="w-72 shrink-0 overflow-y-auto space-y-4 pr-1">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Paper Width</h3>
            <div className="flex gap-2">
              {([58, 80] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => updateDraft({ widthMm: w })}
                  className={cn(
                    'flex-1 rounded-lg border py-2 text-sm font-medium',
                    draft.widthMm === w ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200',
                  )}
                >
                  <Smartphone className="h-4 w-4 mx-auto mb-0.5" />
                  {w}mm
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Content Blocks</h3>
            <div className="space-y-1">
              {CONTENT_SECTIONS.map(({ key, label, sectionKey }) => {
                const visible = sectionKey ? sections[sectionKey] : true;
                return (
                  <button
                    key={String(key)}
                    type="button"
                    onClick={() => setFocus(key)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                      focus === key ? 'bg-primary-50 text-primary-800' : 'hover:bg-slate-50',
                    )}
                  >
                    {sectionKey ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
                        onKeyDown={(e) => e.key === 'Enter' && toggleSection(sectionKey)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </span>
                    ) : (
                      <span className="w-3.5" />
                    )}
                    <span className={cn(sectionKey && !visible && 'text-slate-400 line-through')}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="w-80 shrink-0 overflow-y-auto">
          <div className="rounded-xl border border-slate-200 bg-white p-4 sticky top-0 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-semibold text-sm mb-3">{panelTitle()}</h3>
            {panelContent()}
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto flex justify-center items-start bg-slate-100/80 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 py-8 px-4">
          <ThermalReceiptPreview
            template={draft}
            currency={currency}
            designMode
            activeSection={
              focus === 'headerText' ? 'headerText'
              : focus === 'thankYou' ? 'thankYou'
              : focus === 'returnPolicy' ? 'returnPolicy'
              : focus === 'taxInfo' ? 'taxInfo'
              : focus === 'qrCode' ? 'qrCode'
              : focus === 'bodyStyle' ? 'bodyStyle'
              : focus === 'dividers' ? 'dividers'
              : focus === 'customHeaderLine' ? 'customHeaderLine'
              : focus === 'customFooterLine' ? 'customFooterLine'
              : focus ?? undefined
            }
            onSectionClick={(s) => {
              if (s === 'showLogo') setFocus('showLogo');
              else if (s === 'showStoreName') setFocus('showStoreName');
              else if (s === 'showHeaderText') setFocus('headerText');
              else if (s === 'showThankYou') setFocus('thankYou');
              else if (s === 'showReturnPolicy') setFocus('returnPolicy');
              else if (s === 'showTaxInfo') setFocus('taxInfo');
              else if (s === 'showQrCode') setFocus('qrCode');
              else if (s === 'showAddress') setFocus('showAddress');
              else if (s === 'showPhone') setFocus('showPhone');
              else if (s === 'customHeaderLine') setFocus('customHeaderLine');
              else if (s === 'customFooterLine') setFocus('customFooterLine');
              else if (s === 'bodyStyle') setFocus('bodyStyle');
              else if (s === 'dividers') setFocus('dividers');
              else setFocus(s);
            }}
          />
        </div>
      </div>
    </div>
  );
}
