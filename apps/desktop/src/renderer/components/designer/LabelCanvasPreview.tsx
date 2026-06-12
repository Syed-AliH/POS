import { useCallback, useRef, useState } from 'react';
import {
  LABEL_FIELD_META,
  mmToPx,
  type LabelElement,
  type LabelFieldType,
  type LabelLayout,
  type LabelProduct,
} from '@mama-babi/printer';
import { cn } from '@mama-babi/ui';
import { BarcodeGraphic } from './BarcodeGraphic';

function resolveText(
  el: LabelElement,
  product: LabelProduct,
  layout: LabelLayout,
  currency: string,
): string {
  switch (el.type) {
    case 'name': return product.name;
    case 'price': return `${currency} ${product.price.toFixed(2)}`;
    case 'sku': return product.sku;
    case 'barcode': return product.barcode;
    case 'storeName': return layout.storeName ?? 'Store';
    case 'customText': return el.customText ?? 'Custom text';
    default: return '';
  }
}

export function LabelCanvasPreview({
  layout,
  product,
  widthMm,
  heightMm,
  currency = 'PKR',
  scale = 4,
  selectedId,
  onSelect,
  onMove,
  interactive = false,
  className,
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
      Math.min(95, Math.max(0, dragRef.current.origX + dx)),
      Math.min(95, Math.max(0, dragRef.current.origY + dy)),
    );
  }, [canvasW, canvasH, onMove]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);

  return (
    <div className={cn('inline-block', className)}>
      <div
        className="relative overflow-hidden rounded border-2 border-slate-300 bg-white shadow-md"
        style={{ width: canvasW, height: canvasH }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {elements.filter((e) => e.visible).map((el) => {
          const isBarcodeGraphic = el.type === 'barcode' && showGraphic;
          const text = resolveText(el, product, layout, currency);
          const selected = selectedId === el.id;
          const align = el.align ?? 'left';
          const transform =
            align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : undefined;

          return (
            <div
              key={el.id}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onPointerDown={(e) => handlePointerDown(e, el)}
              onClick={() => onSelect?.(el.id)}
              className={cn(
                'absolute max-w-[90%] leading-tight',
                interactive && 'cursor-grab active:cursor-grabbing',
                selected && interactive && 'ring-2 ring-primary-400 rounded-sm',
                dragging === el.id && 'opacity-80',
              )}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform,
                fontSize: el.fontSize * (scale / 3.5),
                fontWeight: el.fontWeight === 'bold' ? 700 : 400,
                textAlign: align,
              }}
            >
              {isBarcodeGraphic ? (
                <BarcodeGraphic
                  value={product.barcode}
                  height={Math.round(Math.max(32, el.fontSize * 3.2))}
                  displayValue={false}
                  maxWidth={canvasW * 0.88}
                  barWidth={widthMm <= 40 ? 1.1 : 1.35}
                />
              ) : el.type === 'barcode' ? (
                <span className="font-mono text-[0.85em]">{text}</span>
              ) : (
                <span className="block truncate">{text}</span>
              )}
            </div>
          );
        })}

        {interactive && (
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10%_10%]" />
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-slate-400">{widthMm} × {heightMm} mm</p>
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
          scale={3}
        />
      ))}
    </div>
  );
}

export { LABEL_FIELD_META, type LabelFieldType };
