import {
  calcPrintableHeight,
  calcPrintableWidth,
  buildPreviewSlots,
  normalizeLabelRollConfig,
  normalizeBarcodeForPrint,
  SAMPLE_LABEL_PRODUCT,
  type LabelLayout,
  type LabelProduct,
  type LabelRollConfig,
} from '@mama-babi/printer';
import type { ReactNode } from 'react';
import { LabelCanvasPreview } from './LabelCanvasPreview';

/** Roll overview uses a smaller px/mm so the full roll fits on screen; proportions match print scale. */
const ROLL_OVERVIEW_PX_PER_MM = 4;

type LabelRollPreviewProps = {
  widthMm: number;
  heightMm: number;
  rollConfig: Partial<LabelRollConfig> | LabelRollConfig;
  layout?: LabelLayout;
  products?: LabelProduct[];
  previewRows?: number;
  highlightSlots?: number[];
  showDimensions?: boolean;
  className?: string;
};

export function LabelRollPreview({
  widthMm,
  heightMm,
  rollConfig: rawConfig,
  layout,
  products,
  previewRows = 2,
  highlightSlots = [],
  showDimensions = true,
  className = '',
}: LabelRollPreviewProps) {
  const config = normalizeLabelRollConfig(rawConfig);
  const columns = Math.max(1, config.columns);
  const rows = Math.max(1, previewRows);
  const printableW = calcPrintableWidth(config, widthMm);
  const printableH = calcPrintableHeight(config, heightMm, rows);
  const slots = buildPreviewSlots(config, widthMm, heightMm, rows);
  const canvasW = Math.round(printableW * ROLL_OVERVIEW_PX_PER_MM);
  const canvasH = Math.round(printableH * ROLL_OVERVIEW_PX_PER_MM);
  const labelW = Math.round(widthMm * ROLL_OVERVIEW_PX_PER_MM);
  const labelH = Math.round(heightMm * ROLL_OVERVIEW_PX_PER_MM);

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div
        className="relative bg-white border-2 border-slate-300 dark:border-slate-600 shadow-inner overflow-hidden"
        style={{ width: canvasW, height: canvasH }}
      >
        {slots.map((slot) => {
          const left = Math.round(slot.xMm * ROLL_OVERVIEW_PX_PER_MM);
          const top = Math.round(slot.yMm * ROLL_OVERVIEW_PX_PER_MM);
          const highlighted = highlightSlots.includes(slot.index);
          const product =
            products?.[slot.index] ??
            (layout
              ? {
                  name: `Label ${slot.index + 1}`,
                  sku: 'SKU',
                  barcode: '8901234567890',
                  price: 0,
                }
              : null);

          return (
            <div
              key={slot.index}
              className={`absolute border ${
                highlighted
                  ? 'border-primary-500 ring-2 ring-primary-300 z-10'
                  : 'border-dashed border-slate-400 dark:border-slate-500'
              } bg-white overflow-hidden`}
              style={{ left, top, width: labelW, height: labelH }}
            >
              {layout && product ? (
                <LabelCanvasPreview
                  layout={layout}
                  product={product}
                  widthMm={widthMm}
                  heightMm={heightMm}
                  scale={ROLL_OVERVIEW_PX_PER_MM}
                  showSizeLabel={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-slate-400 font-medium">
                  {slot.index + 1}
                </div>
              )}
            </div>
          );
        })}

        {config.horizontalGapMm > 0 && columns > 1 && (
          <div
            className="absolute bg-amber-100/80 dark:bg-amber-900/30 pointer-events-none"
            style={{
              left: Math.round((config.marginLeftMm + widthMm) * ROLL_OVERVIEW_PX_PER_MM),
              top: Math.round(config.marginTopMm * ROLL_OVERVIEW_PX_PER_MM),
              width: Math.round(config.horizontalGapMm * ROLL_OVERVIEW_PX_PER_MM),
              height: canvasH - Math.round((config.marginTopMm + config.marginBottomMm) * ROLL_OVERVIEW_PX_PER_MM),
            }}
            title={`Gap ${config.horizontalGapMm} mm`}
          />
        )}
      </div>

      {showDimensions && (
        <div className="mt-2 text-center text-xs text-slate-500 space-y-0.5">
          <p>
            Roll: {printableW.toFixed(1)} mm total · label {widthMm}×{heightMm} mm · gap {config.horizontalGapMm} mm
          </p>
          <p>
            {columns} column{columns !== 1 ? 's' : ''} · gap {config.horizontalGapMm} mm · offset X {config.offsetXMm} / Y {config.offsetYMm} mm
          </p>
        </div>
      )}
    </div>
  );
}

export function LabelPrintPreviewModal({
  open,
  onClose,
  onConfirm,
  templateName,
  widthMm,
  heightMm,
  rollConfig,
  layout,
  labelCount,
  printing,
  products: previewProducts,
  templateSelector,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  templateName: string;
  widthMm: number;
  heightMm: number;
  rollConfig: LabelRollConfig;
  layout: LabelLayout;
  labelCount: number;
  printing?: boolean;
  /** Actual products to preview; falls back to placeholders when omitted. */
  products?: LabelProduct[];
  /** Optional template picker or extra controls shown above the roll preview. */
  templateSelector?: ReactNode;
  /** Optional subtitle below the title (defaults to template summary). */
  description?: string;
}) {
  if (!open) return null;

  const config = normalizeLabelRollConfig(rollConfig);
  const columns = Math.max(1, config.columns);
  const previewRows = Math.max(2, Math.ceil(Math.min(labelCount, columns * 2) / columns));
  const slotCount = Math.min(labelCount, columns * previewRows);
  const slots = Array.from({ length: slotCount }, (_, i) => i);
  const defaultPreviewProduct: LabelProduct = {
    ...SAMPLE_LABEL_PRODUCT,
    barcode: normalizeBarcodeForPrint(SAMPLE_LABEL_PRODUCT.barcode),
  };
  const rollProducts =
    previewProducts?.length
      ? previewProducts.slice(0, slotCount)
      : slots.map(() => ({ ...defaultPreviewProduct }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <h3 className="text-lg font-bold mb-1">Print Preview</h3>
        <p className="text-sm text-slate-500 mb-4">
          {description ?? (
            <>
              {templateName} · {labelCount} label{labelCount !== 1 ? 's' : ''} · {widthMm}×{heightMm} mm · {columns}-up
            </>
          )}
        </p>

        {templateSelector && <div className="mb-4">{templateSelector}</div>}

        <div className="flex justify-center mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
          <LabelRollPreview
            widthMm={widthMm}
            heightMm={heightMm}
            rollConfig={rollConfig}
            layout={layout}
            previewRows={previewRows}
            highlightSlots={slots}
            products={rollProducts}
          />
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Labels are placed at calculated X/Y positions. Scale locked to 100% — no browser fit-to-page.
          Adjust horizontal gap, columns, or offset in Label Template Config if alignment is off.
        </p>

        <div className="flex gap-3 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={printing}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={printing}>
            {printing ? 'Printing…' : `Print ${labelCount} Label${labelCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
