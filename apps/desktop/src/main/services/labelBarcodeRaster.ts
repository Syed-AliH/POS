import { DOMParser } from '@xmldom/xmldom';

function parseSvgLength(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(String(value).replace(/px$/i, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseSvgDimensions(svg: Element): { width: number; height: number } {
  let width = parseSvgLength(svg.getAttribute('width'));
  let height = parseSvgLength(svg.getAttribute('height'));
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      if (width <= 0) width = parts[2]!;
      if (height <= 0) height = parts[3]!;
    }
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function parseTranslate(transform: string | null | undefined): { tx: number; ty: number } {
  if (!transform) return { tx: 0, ty: 0 };
  const match = /translate\s*\(\s*([-\d.]+)(?:[,\s]+([-\d.]+))?\s*\)/.exec(transform);
  if (!match) return { tx: 0, ty: 0 };
  return {
    tx: Number.parseFloat(match[1] ?? '0') || 0,
    ty: Number.parseFloat(match[2] ?? '0') || 0,
  };
}

function rectParentOffset(rect: Element, root: Element): { tx: number; ty: number } {
  let tx = 0;
  let ty = 0;
  let node: Element | null = rect.parentNode as Element | null;
  while (node && node !== root) {
    if (node.nodeName.toLowerCase() === 'g') {
      const t = parseTranslate(node.getAttribute('transform'));
      tx += t.tx;
      ty += t.ty;
    }
    node = node.parentNode as Element | null;
  }
  return { tx, ty };
}

/** Rasterize JsBarcode SVG rects to RGBA — 1:1 pixel bars, no browser anti-aliasing. */
export function rasterizeBarcodeSvgMarkup(
  svgMarkup: string,
): { rgba: Buffer; width: number; height: number } | null {
  if (!svgMarkup.trim()) return null;

  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;

  const { width, height } = parseSvgDimensions(svg);
  const rgba = Buffer.alloc(width * height * 4, 255);
  const rects = svg.getElementsByTagName('rect');

  for (let i = 0; i < rects.length; i++) {
    const rect = rects.item(i);
    if (!rect) continue;

    const fill = (rect.getAttribute('fill') ?? '#000000').toLowerCase();
    if (fill === '#ffffff' || fill === 'white' || fill === 'none') continue;

    const offset = rectParentOffset(rect, svg);
    const x0 = Math.max(0, Math.floor(parseSvgLength(rect.getAttribute('x')) + offset.tx));
    const y0 = Math.max(0, Math.floor(parseSvgLength(rect.getAttribute('y')) + offset.ty));
    const x1 = Math.min(
      width,
      Math.ceil(x0 + parseSvgLength(rect.getAttribute('width'))),
    );
    const y1 = Math.min(
      height,
      Math.ceil(y0 + parseSvgLength(rect.getAttribute('height'))),
    );

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 255;
      }
    }
  }

  return { rgba, width, height };
}
