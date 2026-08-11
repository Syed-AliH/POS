import { useCallback, useRef, useState } from 'react';
import {
  LABEL_CANVAS_PREVIEW_SCALE,
  LABEL_FIELD_META,
  clampLabelPositionPercent,
  labelBarcodeLayoutStyle,
  labelPreviewMaxWidthPx,
  labelTextPreviewStyle,
  scaleLabelStyleToPreview,
  mmToPx,
  normalizeBarcodeForPrint,
  resolveBarcodePrintMetrics,
  resolveLabelFieldText,
  truncateLabelElementText,
  type LabelElement,
  type LabelFieldType,
  type LabelLayout,
  type LabelProduct,
} from '@mama-babi/printer';
import { cn } from '@mama-babi/ui';
import { BarcodeGraphic } from './BarcodeGraphic';
import { LabelCustomFontStyle } from './LabelCustomFontStyle';

export function LabelCanvasPreview({
  layout,
  product,
  widthMm,
  heightMm,
  currency = 'PKR',
  scale = LABEL_CANVAS_PREVIEW_SCALE,
  selectedId,
  onSelect,
  onMove,
  interactive = false,
  className,
  showSizeLabel = true,
}: {
  layout: LabelLayout;
  product: LabelProduct;
  widthMm: number;
  heightMm: number;
  currency?: string;
  scale?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  interactive?: boolean;
  className?: string;
  showSizeLabel?: boolean;
}) {
  const canvasW = mmToPx(widthMm, scale);
  const canvasH = mmToPx(heightMm, scale);
  const elements = layout.elements ?? [];
  const showGraphic = layout.showBarcodeGraphic ?? layout.showBarcode ?? false;
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, el: LabelElement) => {
    if (!interactive || !onMove) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: el.id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y };
    setDragging(el.id);
    onSelect?.(el.id);
  }, [interactive, onMove, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !onMove) return;
    const dx = ((e.clientX - dragRef.current.startX) / canvasW) * 100;
    const dy = ((e.clientY - dragRef.current.startY) / canvasH) * 100;
    onMove(
      dragRef.current.id,
      clampLabelPositionPercent(dragRef.current.origX + dx),
      clampLabelPositionPercent(dragRef.current.origY + dy),
    );
  }, [canvasW, canvasH, onMove]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);

  const previewScale = scale / 8;

  return (
    <div className={cn('inline-block', className)}>
      <LabelCustomFontStyle elements={elements} />
      <div
        className="relative overflow-hidden rounded border-2 border-slate-300 bg-white shadow-md"
        style={{ width: canvasW, height: canvasH }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {elements.filter((e) => e.visible).map((el) => {
          const isBarcodeGraphic = el.type === 'barcode' && showGraphic;
          const rawText = resolveLabelFieldText(el.type, product, layout, currency, el);
          const selected = selectedId === el.id;
          const text =
            isBarcodeGraphic || el.type === 'barcode'
              ? rawText
              : truncateLabelElementText(rawText, el, widthMm);

          if (isBarcodeGraphic) {
            const barcode = normalizeBarcodeForPrint(product.barcode);
            const metrics = resolveBarcodePrintMetrics(el, widthMm, heightMm, barcode);
            const printStyle = labelBarcodeLayoutStyle(
              el,
              widthMm,
              metrics.normalizedValue,
              metrics.height,
              metrics.barWidth,
            );
            const scaledStyle = scaleLabelStyleToPreview(printStyle, scale);
            const maxWidthPx = labelPreviewMaxWidthPx(el, widthMm, scale);
            const barcodeHeight = Math.round(metrics.height * previewScale);
            const svgWidthPx = Math.round(metrics.svgWidthPx * previewScale);

            return (
              <div
                key={el.id}
                role={interactive ? 'button' : undefined}
                onPointerDown={(e) => handlePointerDown(e, el)}
                onClick={() => onSelect?.(el.id)}
                className={cn(
                  interactive && 'cursor-grab active:cursor-grabbing',
                  selected && interactive && 'ring-2 ring-primary-400 rounded-sm',
                  dragging === el.id && 'opacity-80',
                )}
                style={{
                  ...scaledStyle,
                  width: svgWidthPx,
                  maxWidth: maxWidthPx,
                  maxHeight: `${Math.round((heightMm * scale) - (el.y / 100) * heightMm * scale - 2)}px`,
                } as React.CSSProperties}
              >
                <BarcodeGraphic
                  value={barcode}
                  height={barcodeHeight}
                  displayValue={false}
                  barWidth={metrics.barWidth}
                  margin={0}
                  maxWidthPx={maxWidthPx}
                />
              </div>
            );
          }

          if (el.type === 'barcode') {
            return null;
          }

          const previewStyle = labelTextPreviewStyle(el, widthMm, scale);

          return (
            <div
              key={el.id}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onPointerDown={(e) => handlePointerDown(e, el)}
              onClick={() => onSelect?.(el.id)}
              className={cn(
                interactive && 'cursor-grab active:cursor-grabbing',
                selected && interactive && 'ring-2 ring-primary-400 rounded-sm',
                dragging === el.id && 'opacity-80',
              )}
              style={previewStyle as React.CSSProperties}
            >
              {text}
            </div>
          );
        })}

        {interactive && (
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10%_10%]" />
        )}
      </div>
      {showSizeLabel && (
        <p className="mt-1 text-center text-[10px] text-slate-400">{widthMm} × {heightMm} mm</p>
      )}
    </div>
  );
}

export function LabelBatchPreview({
  layout,
  products,
  widthMm,
  heightMm,
  currency = 'PKR',
}: {
  layout: LabelLayout;
  products: LabelProduct[];
  widthMm: number;
  heightMm: number;
  currency?: string;
}) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {products.map((product, i) => (
        <LabelCanvasPreview
          key={i}
          layout={layout}
          product={product}
          widthMm={widthMm}
          heightMm={heightMm}
          currency={currency}
          scale={LABEL_CANVAS_PREVIEW_SCALE}
        />
      ))}
    </div>
  );
}

export { LABEL_FIELD_META, type LabelFieldType };
