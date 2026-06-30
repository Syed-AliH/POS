import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { cn } from '@mama-babi/ui';

function detectBarcodeFormat(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 || digits.length === 12) return 'EAN13';
  if (digits.length === 8) return 'EAN8';
  if (digits.length === 11) return 'UPC';
  return 'CODE128';
}

function normalizeBarcodeValue(value: string, format: string): string {
  const trimmed = value.trim();
  if (format === 'EAN13' || format === 'EAN8' || format === 'UPC') {
    return trimmed.replace(/\D/g, '');
  }
  return trimmed;
}

export function BarcodeGraphic({
  value,
  height = 44,
  displayValue = true,
  className,
  barWidth = 1.35,
  margin = 0,
  maxWidthPx,
}: {
  value: string;
  height?: number;
  displayValue?: boolean;
  className?: string;
  barWidth?: number;
  margin?: number;
  /** When set, bar module width is reduced so the SVG fits the designer slot. */
  maxWidthPx?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [fittedBarWidth, setFittedBarWidth] = useState(barWidth);

  useEffect(() => {
    setFittedBarWidth(barWidth);
  }, [value, height, displayValue, barWidth, margin, maxWidthPx]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !value.trim()) return;

    const renderAt = (width: number): boolean => {
      svg.replaceChildren();
      const primary = detectBarcodeFormat(value);
      const candidates = primary === 'CODE128' ? ['CODE128', 'CODE39'] : [primary, 'CODE128'];
      for (const format of candidates) {
        try {
          JsBarcode(svg, normalizeBarcodeValue(value, format), {
            format,
            width,
            height,
            displayValue,
            margin,
            flat: true,
            fontSize: 11,
            font: 'ui-monospace, monospace',
            textMargin: 2,
            textAlign: 'center',
            background: '#ffffff',
            lineColor: '#000000',
          });
          svg.setAttribute('shape-rendering', 'crispEdges');
          return true;
        } catch {
          svg.replaceChildren();
        }
      }
      return false;
    };

    if (!renderAt(fittedBarWidth)) return;

    if (maxWidthPx == null) return;

    const bbox = svg.getBBox();
    if (bbox.width <= maxWidthPx) return;

    let lo = 0.5;
    let hi = fittedBarWidth;
    let best = fittedBarWidth;
    for (let i = 0; i < 24 && hi - lo > 0.04; i++) {
      const mid = Math.round(((lo + hi) / 2) * 10) / 10;
      if (!renderAt(mid)) break;
      const w = svg.getBBox().width;
      if (w <= maxWidthPx) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best !== fittedBarWidth) {
      setFittedBarWidth(best);
      renderAt(best);
    }
  }, [value, height, displayValue, fittedBarWidth, margin, maxWidthPx]);

  if (!value.trim()) return null;

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={`Barcode ${value}`}
      className={cn('block', className)}
      style={{ maxWidth: maxWidthPx != null ? `${maxWidthPx}px` : undefined, width: 'auto', height: 'auto' }}
    />
  );
}
