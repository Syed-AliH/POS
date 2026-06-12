import { useEffect, useRef } from 'react';
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
  maxWidth,
  barWidth = 1.35,
}: {
  value: string;
  height?: number;
  displayValue?: boolean;
  className?: string;
  maxWidth?: number;
  barWidth?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !value.trim()) return;

    svg.replaceChildren();

    const primary = detectBarcodeFormat(value);
    const candidates = primary === 'CODE128' ? ['CODE128', 'CODE39'] : [primary, 'CODE128'];

    for (const format of candidates) {
      try {
        JsBarcode(svg, normalizeBarcodeValue(value, format), {
          format,
          width: barWidth,
          height,
          displayValue,
          margin: 6,
          fontSize: 11,
          font: 'ui-monospace, monospace',
          textMargin: 2,
          textAlign: 'center',
          background: '#ffffff',
          lineColor: '#000000',
        });
        return;
      } catch {
        svg.replaceChildren();
      }
    }
  }, [value, height, displayValue, barWidth]);

  if (!value.trim()) return null;

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={`Barcode ${value}`}
      className={cn('block max-w-full', className)}
      style={{ maxWidth: maxWidth ?? '100%', height: 'auto' }}
    />
  );
}
