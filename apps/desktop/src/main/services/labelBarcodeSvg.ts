import JsBarcode from 'jsbarcode';
import { normalizeBarcodeForPrint, resolveBarcodePrintFormat } from '@mama-babi/printer';
import { DOMImplementation, XMLSerializer, type Document } from '@xmldom/xmldom';

function normalizeBarcodeValue(value: string, format: string): string {
  const normalized = normalizeBarcodeForPrint(value);
  if (format === 'EAN13' || format === 'EAN8' || format === 'UPC') {
    return normalized.replace(/\D/g, '');
  }
  return normalized.trim();
}

function clearSvgChildren(svg: Element): void {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
}

/** JsBarcode must create bar nodes on the same document as the root SVG. */
function withBarcodeDocument<T>(doc: Document, fn: () => T): T {
  const g = globalThis as typeof globalThis & {
    document?: { createElementNS: (ns: string, name: string) => Element };
  };
  const prev = g.document;
  g.document = {
    createElementNS: (ns: string, name: string) => doc.createElementNS(ns, name),
  };
  try {
    return fn();
  } finally {
    if (prev === undefined) delete g.document;
    else g.document = prev;
  }
}

/** Render barcode SVG markup in Node — embedded directly in print HTML. */
export function renderBarcodeSvgMarkup(
  value: string,
  height: number,
  barWidth: number,
): string {
  if (!value.trim()) return '';

  const format = resolveBarcodePrintFormat(value);
  const candidates = format === 'CODE128' ? ['CODE128', 'CODE39'] : [format, 'CODE128'];

  const impl = new DOMImplementation();
  const doc = impl.createDocument('http://www.w3.org/2000/svg', 'svg', null);
  const svg = doc.documentElement;
  svg.setAttribute('class', 'barcode-svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('shape-rendering', 'crispEdges');

  return withBarcodeDocument(doc, () => {
    for (const format of candidates) {
      clearSvgChildren(svg);
      try {
        JsBarcode(svg as unknown as SVGSVGElement, normalizeBarcodeValue(value, format), {
          format,
          width: barWidth,
          height,
          displayValue: false,
          textMargin: 0,
          margin: 0,
          flat: true,
          lineColor: '#000000',
          background: '#ffffff',
        });
        if (!svg.firstChild) continue;
        return new XMLSerializer().serializeToString(svg);
      } catch {
        // try next format
      }
    }
    return '';
  });
}
