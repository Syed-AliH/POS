import { useEffect, useRef, useState } from 'react';
import { labelCanvasSizePx } from '@mama-babi/printer';
import { LabelCanvasPreview } from './LabelCanvasPreview';
import type { LabelLayout, LabelProduct } from '@mama-babi/printer';

type LabelDesignerCanvasProps = {
  layout: LabelLayout;
  product: LabelProduct;
  widthMm: number;
  heightMm: number;
  currency?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  className?: string;
};

/** Interactive label canvas — exact label dimensions at 203 DPI, CSS zoom to fit container. */
export function LabelDesignerCanvas({
  layout,
  product,
  widthMm,
  heightMm,
  currency,
  selectedId,
  onSelect,
  onMove,
  className,
}: LabelDesignerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(1);

  const { width: previewW, height: previewH } = labelCanvasSizePx(widthMm, heightMm);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fit = () => {
      const padding = 48;
      const header = 44;
      const availW = container.clientWidth - padding;
      const availH = container.clientHeight - padding - header;
      if (availW <= 0 || availH <= 0 || previewW <= 0 || previewH <= 0) return;

      const next = Math.min(availW / previewW, availH / previewH, 2.5);
      setFitZoom(Math.max(0.35, Math.round(next * 100) / 100));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [previewW, previewH]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'flex h-full w-full min-h-0 flex-col items-center justify-center overflow-hidden'}
    >
      <div className="mb-2 shrink-0 text-center">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
          Label area: {widthMm} × {heightMm} mm
        </p>
        <p className="text-[10px] text-slate-400">
          {previewW} × {previewH} px · 203 DPI preview
        </p>
      </div>

      <div className="flex flex-1 min-h-0 w-full items-center justify-center">
        <div
          style={{
            width: previewW,
            height: previewH,
            transform: `scale(${fitZoom})`,
            transformOrigin: 'center center',
          }}
        >
          <LabelCanvasPreview
            layout={layout}
            product={product}
            widthMm={widthMm}
            heightMm={heightMm}
            currency={currency}
            scale={8}
            interactive
            selectedId={selectedId}
            onSelect={onSelect}
            onMove={onMove}
            showSizeLabel={false}
          />
        </div>
      </div>
    </div>
  );
}
