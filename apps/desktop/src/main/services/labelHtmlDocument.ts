import { createRequire } from 'node:module';
import {
  buildLabelPrintFontFaceCss,
  buildLabelSlotInnerHtml,
  calcLabelSlotPositionPx,
  calcPrintablePageSizePx,
  collectCustomLabelFonts,
  labelCanvasSizePx,
  type LabelLayout,
  type LabelProduct,
} from '@mama-babi/printer';
import type { LabelRollLayout } from './labelRollLayout';

const require = createRequire(import.meta.url);
const JSBARCODE_REQUIRE_PATH = require.resolve('jsbarcode');

export type LabelSlotContent = {
  product: LabelProduct;
  layout: LabelLayout;
  currency: string;
  widthMm: number;
  heightMm: number;
  xMm: number;
  yMm: number;
  slotIndex: number;
};

/** Inject barcodes in the hidden print window (jsbarcode needs a browser document). */
export function buildBarcodeInjectScript(): string {
  const jsBarcodePath = JSON.stringify(JSBARCODE_REQUIRE_PATH);
  return `(function(){
  try {
    const JsBarcode = require(${jsBarcodePath});
    function detectFormat(v) {
      const d = String(v).replace(/\\D/g, '');
      if (d.length === 12 || d.length === 13) return 'EAN13';
      if (d.length === 8) return 'EAN8';
      if (d.length === 11) return 'UPC';
      return 'CODE128';
    }
    function normalize(v, fmt) {
      if (fmt === 'EAN13' || fmt === 'EAN8' || fmt === 'UPC') return String(v).replace(/\\D/g, '');
      return String(v).trim();
    }
    function renderInto(wrap, svg, value, format, barWidth, height) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      JsBarcode(svg, value, {
        format: format,
        width: barWidth,
        height: height,
        displayValue: false,
        textMargin: 0,
        margin: 4,
        flat: true,
        lineColor: '#000000',
        background: '#ffffff',
      });
    }
    document.querySelectorAll('[data-barcode-value]').forEach(function(wrap) {
      const svg = wrap.querySelector('svg');
      const value = wrap.getAttribute('data-barcode-value') || '';
      const height = parseInt(wrap.getAttribute('data-barcode-height') || '40', 10);
      let width = parseFloat(wrap.getAttribute('data-barcode-width') || '1.1');
      const maxW = parseFloat(wrap.getAttribute('data-barcode-max-width') || '0');
      const formatAttr = wrap.getAttribute('data-barcode-format') || '';
      if (!svg || !value.trim()) return;
      const primary = formatAttr || detectFormat(value);
      const candidates = primary === 'CODE128' ? ['CODE128', 'CODE39'] : [primary, 'CODE128'];
      for (let i = 0; i < candidates.length; i++) {
        try {
          const fmt = candidates[i];
          const encoded = normalize(value, fmt);
          renderInto(wrap, svg, encoded, fmt, width, height);
          if (maxW > 0) {
            const bbox = svg.getBBox();
            const drawnW = bbox.width + 8;
            if (drawnW > 0 && drawnW < maxW * 0.92) {
              width = Math.max(0.5, width * (maxW / drawnW));
              renderInto(wrap, svg, encoded, fmt, width, height);
            }
          }
          wrap.setAttribute('data-barcode-rendered', value);
          break;
        } catch (e) {}
      }
    });
  } catch (e) { console.error('barcode inject', e); }
})();`;
}

/** Multi-slot HTML — each label clipped to labelWidthMm × labelHeightMm at computed X/Y. */
export function buildLabelHtmlDocument(slots: LabelSlotContent[], roll: LabelRollLayout): string {
  if (!Array.isArray(slots)) {
    throw new TypeError(`buildLabelHtmlDocument expected slots array, got ${typeof slots}`);
  }
  const { labelWidthMm, labelHeightMm, printableWidthMm, rollConfig } = roll;
  const columns = Math.max(1, rollConfig.columns);
  const rowCount = Math.max(1, Math.ceil(slots.length / columns));
  const pageSizePx = calcPrintablePageSizePx(rollConfig, labelWidthMm, labelHeightMm, rowCount);
  const pageWidthPx = pageSizePx.width;
  const pageHeightPx = pageSizePx.height;
  const printableHeightMm = roll.printableHeightMm;

  const labelDivs = slots
    .map((slot) => {
      const pos = calcLabelSlotPositionPx(rollConfig, labelWidthMm, labelHeightMm, slot.slotIndex);
      const inner = buildLabelSlotInnerHtml(
        slot.product,
        slot.layout,
        slot.currency,
        slot.widthMm,
        slot.heightMm,
      );
      return `<div class="label-slot" style="left:${pos.leftPx}px;top:${pos.topPx}px;width:${pos.labelWidthPx}px;height:${pos.labelHeightPx}px"><div class="label-clip">${inner}</div></div>`;
    })
    .join('');

  const pageTransform = rollConfig.rotate180 ? 'transform:rotate(180deg);transform-origin:center center;' : '';
  const customFonts = collectCustomLabelFonts(slots.flatMap((s) => s.layout.elements ?? []));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<style>
  ${buildLabelPrintFontFaceCss(customFonts)}
  :root { color-scheme: light only; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: ${printableWidthMm}mm ${printableHeightMm}mm; margin: 0; }
  html, body {
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    overflow: hidden;
    background: #fff;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #page {
    position: relative;
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    overflow: hidden;
    ${pageTransform}
  }
  .label-slot {
    position: absolute;
    overflow: hidden;
    clip-path: inset(0);
    contain: strict;
  }
  .label-clip {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .label-clip > div {
    font-stretch: normal;
    letter-spacing: normal;
  }
  .label-clip svg.barcode-svg {
    display: block;
    max-width: none !important;
    width: auto;
    height: auto;
    overflow: hidden;
    shape-rendering: crispEdges;
  }
  .label-barcode {
    line-height: 0;
  }
</style>
</head>
<body>
  <div id="page">${labelDivs}</div>
</body>
</html>`;
}

/** One label at full page size — captured per slot then composited (crisp 2-up barcodes). */
export function buildSingleLabelHtmlDocument(
  slot: LabelSlotContent,
  rotate180 = false,
): string {
  const { width: pageWidthPx, height: pageHeightPx } = labelCanvasSizePx(slot.widthMm, slot.heightMm);
  const inner = buildLabelSlotInnerHtml(
    slot.product,
    slot.layout,
    slot.currency,
    slot.widthMm,
    slot.heightMm,
  );
  const pageTransform = rotate180 ? 'transform:rotate(180deg);transform-origin:center center;' : '';
  const customFonts = collectCustomLabelFonts(slot.layout.elements ?? []);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<style>
  ${buildLabelPrintFontFaceCss(customFonts)}
  :root { color-scheme: light only; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    overflow: hidden;
    background: #fff;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #page {
    position: relative;
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    overflow: hidden;
    ${pageTransform}
  }
  .label-clip {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .label-clip svg.barcode-svg {
    display: block;
    max-width: none !important;
    width: auto;
    height: auto;
    shape-rendering: crispEdges;
  }
  .label-barcode { line-height: 0; }
</style>
</head>
<body>
  <div id="page"><div class="label-clip">${inner}</div></div>
</body>
</html>`;
}

/** Single-page HTML that prints a captured PNG at exact pixel/mm size. */
export function buildRasterPrintHtml(
  pngBase64: string,
  pageWidthPx: number,
  pageHeightPx: number,
  printableWidthMm: number,
  printableHeightMm: number,
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: ${printableWidthMm}mm ${printableHeightMm}mm; margin: 0; }
  html, body {
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    overflow: hidden;
  }
  img {
    width: ${pageWidthPx}px;
    height: ${pageHeightPx}px;
    display: block;
  }
</style>
</head>
<body>
  <img src="data:image/png;base64,${pngBase64}" width="${pageWidthPx}" height="${pageHeightPx}" alt="" />
</body>
</html>`;
}
