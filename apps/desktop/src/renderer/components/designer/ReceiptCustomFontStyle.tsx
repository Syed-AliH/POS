import { resolveReceiptStyle } from '@mama-babi/printer';
import type { ReceiptTemplateHeader } from '@mama-babi/printer';

function fontFaceCss(name: string, dataUrl: string, format: string): string {
  const safeName = name.replace(/'/g, '');
  return `
    @font-face {
      font-family: '${safeName}';
      src: url('${dataUrl}') format('${format}');
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }
  `;
}

export function ReceiptCustomFontStyle({ header }: { header: ReceiptTemplateHeader }) {
  const parts: string[] = [];
  if (header.storeNameFontFamily === 'custom' && header.storeNameCustomFontDataUrl && header.storeNameCustomFontName) {
    parts.push(fontFaceCss(
      header.storeNameCustomFontName,
      header.storeNameCustomFontDataUrl,
      header.storeNameCustomFontFormat ?? 'truetype',
    ));
  }
  const style = resolveReceiptStyle(header);
  const usesBodyCustom =
    style.bodyFontFamily === 'custom' ||
    style.itemFontFamily === 'custom' ||
    style.metaFontFamily === 'custom' ||
    style.footerFontFamily === 'custom';
  if (usesBodyCustom && style.customFontDataUrl && style.customFontName) {
    parts.push(fontFaceCss(style.customFontName, style.customFontDataUrl, style.customFontFormat ?? 'truetype'));
  }
  if (!parts.length) return null;
  return <style>{parts.join('')}</style>;
}
