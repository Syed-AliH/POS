import type {
  ReceiptSale,
  ReceiptTemplateConfig,
  ReceiptTemplateHeader,
  ReceiptTemplateSections,
} from './index';
import { DEFAULT_RECEIPT_SECTIONS, resolveStoreNameFontFamily, resolveReceiptLabels, resolveReceiptStyle, resolveReceiptZoneFontFamily } from './index';

/** Receipt designer canvas width — must match ThermalReceiptPreview. */
export function receiptPreviewWidthPx(widthMm: 58 | 80): number {
  return widthMm === 58 ? 220 : 302;
}

/** 203 DPI — matches POS-80 / Xprinter thermal heads. */
export const RECEIPT_PRINT_PX_PER_MM = 8;

/** Side margin baked into raster width so text does not clip at roll edges. */
export const RECEIPT_PRINT_MARGIN_MM = 0;

/** Printable area inside the roll (mm), not the Windows driver page size. */
export const RECEIPT_PRINTABLE_MM: Record<58 | 80, number> = {
  58: 48,
  80: 72.1,
};

/** Printable width in dots at 203 DPI, with side margins. */
export function receiptPrintWidthPx(widthMm: 58 | 80): number {
  const printableMm = RECEIPT_PRINTABLE_MM[widthMm] - RECEIPT_PRINT_MARGIN_MM * 2;
  return Math.round(printableMm * RECEIPT_PRINT_PX_PER_MM);
}

/** Paper width for physical print — settings override, else template, default 58 mm. */
export function resolveReceiptPaperWidthMm(
  settings: Record<string, string>,
  template?: ReceiptTemplateConfig,
): 58 | 80 {
  const raw = settings.receipt_paper_mm?.trim();
  if (raw === '58') return 58;
  if (raw === '80') return 80;
  const printer = settings.receipt_printer?.toLowerCase() ?? '';
  if (printer.includes('58') || /xp-?58/i.test(printer)) return 58;
  if (template?.widthMm === 58 || template?.widthMm === 80) return template.widthMm;
  return 58;
}

/** Final ESC/POS bitmap size — uniform scale from designer px to print-head dots. */
export function receiptScaledDotsSize(
  designMm: 58 | 80,
  paperMm: 58 | 80,
  _contentWidthPx: number,
  contentHeightPx: number,
): { width: number; height: number } {
  const headPx = receiptPrintWidthPx(paperMm);
  const previewPx = receiptPreviewWidthPx(designMm);
  const scale = (paperMm / designMm) * (headPx / previewPx);
  return {
    width: headPx,
    height: Math.max(1, Math.round(contentHeightPx * scale)),
  };
}

function spx(value: number, scale: number): number {
  return Math.round(value * scale);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReceiptDateTime(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(hours)}:${pad(d.getMinutes())} ${ampm}`;
}

function charsForWidth(widthMm: 58 | 80): number {
  return widthMm === 58 ? 32 : 42;
}

function fmtMoney(currency: string, n: number): string {
  return `${currency} ${n.toFixed(2)}`;
}

export function buildReceiptPrintFontFaceCss(header?: ReceiptTemplateHeader): string {
  const parts: string[] = [];
  if (header?.storeNameFontFamily === 'custom' && header.storeNameCustomFontDataUrl && header.storeNameCustomFontName) {
    const safeName = header.storeNameCustomFontName.replace(/'/g, "\\'");
    const format = header.storeNameCustomFontFormat ?? 'truetype';
    const escapedUrl = header.storeNameCustomFontDataUrl.replace(/'/g, "\\'");
    parts.push(`@font-face{font-family:'${safeName}';src:url('${escapedUrl}') format('${format}');font-weight:normal;font-style:normal;}`);
  }
  const style = resolveReceiptStyle(header);
  const usesBodyCustom =
  style.bodyFontFamily === 'custom' ||
  style.itemFontFamily === 'custom' ||
  style.metaFontFamily === 'custom' ||
  style.footerFontFamily === 'custom';
  if (usesBodyCustom && style.customFontDataUrl && style.customFontName) {
    const safeName = style.customFontName.replace(/'/g, "\\'");
    const format = style.customFontFormat ?? 'truetype';
    const escapedUrl = style.customFontDataUrl.replace(/'/g, "\\'");
    parts.push(`@font-face{font-family:'${safeName}';src:url('${escapedUrl}') format('${format}');font-weight:normal;font-style:normal;}`);
  }
  return parts.join('');
}

function storeNameCss(header: ReceiptTemplateHeader, scale: number): string {
  const fontSize = spx(header.storeNameFontSize ?? 14, scale);
  const fontFamily = resolveStoreNameFontFamily(header);
  const fontWeight = header.storeNameFontWeight === 'normal' ? 400 : 700;
  const textTransform = header.storeNameUppercase === false ? 'none' : 'uppercase';
  return `font-size:${fontSize}px;font-family:${fontFamily};font-weight:${fontWeight};text-transform:${textTransform};`;
}

function qrPlaceholderHtml(size: number): string {
  const cells = 7;
  let cellsHtml = '';
  for (let i = 0; i < cells * cells; i++) {
    const light = (i + Math.floor(i / cells)) % 2 === 0;
    cellsHtml += `<div style="aspect-ratio:1;background:${light ? '#fff' : '#0f172a'}"></div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(${cells},1fr);gap:1px;width:${size}px;height:${size}px;margin:0 auto;padding:4px;background:#0f172a">${cellsHtml}</div>`;
}

/**
 * Printable HTML matching Receipt Designer (ThermalReceiptPreview) layout and styles.
 */
export function buildReceiptPrintHtml(
  sale: ReceiptSale,
  settings: Record<string, string>,
  template?: ReceiptTemplateConfig,
  options?: { forPrint?: boolean; targetWidthPx?: number },
): { html: string; widthPx: number; widthMm: 58 | 80 } {
  const widthMm = template?.widthMm ?? 80;
  const forPrint = options?.forPrint ?? false;
  const previewPx = receiptPreviewWidthPx(widthMm);
  const widthPx = options?.targetWidthPx ?? previewPx;
  const scale = widthPx / previewPx;
  const bg = '#ffffff';
  const ink = forPrint ? '#000000' : '#0f172a';
  const muted = forPrint ? '#000000' : '#475569';
  const ruleColor = forPrint ? '#000000' : '#94a3b8';
  const dashColor = forPrint ? '#000000' : '#cbd5e1';
  const sections: ReceiptTemplateSections = {
    ...DEFAULT_RECEIPT_SECTIONS,
    ...template?.sections,
  };
  const header = template?.header ?? {};
  const footer = template?.footer ?? {};
  const currency = settings.currency ?? 'PKR';
  const labels = resolveReceiptLabels(header);
  const bodyStyle = resolveReceiptStyle(header);
  const bodyFontFamily = resolveReceiptZoneFontFamily(bodyStyle, 'body');
  const itemFontFamily = resolveReceiptZoneFontFamily(bodyStyle, 'item');
  const metaFontFamily = resolveReceiptZoneFontFamily(bodyStyle, 'meta');
  const footerFontFamily = resolveReceiptZoneFontFamily(bodyStyle, 'footer');

  const charWidth = charsForWidth(widthMm);
  const dividerRepeat = Math.min(charWidth, 24);
  const divider = bodyStyle.dividerChar.repeat(dividerRepeat);
  const dash = bodyStyle.dashChar.repeat(dividerRepeat);

  const storeName = (header.storeName || settings.store_name || 'Store').trim();
  const parts: string[] = [];

  if (sections.showLogo && header.logoDataUrl) {
    parts.push(
      `<div class="center py-1"><img src="${header.logoDataUrl}" alt="" style="max-height:${spx(56, scale)}px;max-width:85%;object-fit:contain" /></div>`,
    );
  }

  if (sections.showStoreName && storeName) {
    parts.push(`<div class="center store-name" style="${storeNameCss(header, scale)}">${escapeHtml(storeName)}</div>`);
  }

  if (sections.showAddress && header.address?.trim()) {
    parts.push(`<div class="center muted small pre">${escapeHtml(header.address.trim())}</div>`);
  }

  if ((sections.showPhone && header.phone?.trim()) || (sections.showEmail && header.email?.trim())) {
    const lines: string[] = [];
    if (sections.showPhone && header.phone?.trim()) lines.push(escapeHtml(header.phone.trim()));
    if (sections.showEmail && header.email?.trim()) lines.push(escapeHtml(header.email.trim()));
    parts.push(`<div class="center muted small">${lines.join('<br/>')}</div>`);
  }

  if (sections.showHeaderText && header.headerText?.trim()) {
    parts.push(`<div class="center muted small italic">${escapeHtml(header.headerText.trim())}</div>`);
  }

  if (header.customLine?.trim()) {
    parts.push(`<div class="center muted small pre">${escapeHtml(header.customLine.trim())}</div>`);
  }

  const hasHeader =
    (sections.showLogo && header.logoDataUrl) ||
    (sections.showStoreName && storeName) ||
    (sections.showAddress && header.address?.trim()) ||
    (sections.showPhone && header.phone?.trim()) ||
    (sections.showEmail && header.email?.trim()) ||
    (sections.showHeaderText && header.headerText?.trim());

  if (hasHeader && bodyStyle.showHeaderDivider && bodyStyle.dividerChar) {
    parts.push(`<div class="center rule">${escapeHtml(divider)}</div>`);
  }

  const hasMeta = sections.showSaleNumber || sections.showDate || sections.showCashier;
  const hasItems = sections.showItems && sale.items.length > 0;
  const hasTotals =
    sections.showSubtotal || sections.showDiscount || sections.showTax || sections.showTotal;
  const hasPayment = sections.showPayment;

  if (hasMeta) {
    if (sections.showSaleNumber) {
      parts.push(`<div class="meta">${escapeHtml(labels.receiptNumber)} ${escapeHtml(sale.saleNumber)}</div>`);
    }
    if (sections.showDate) {
      parts.push(`<div class="meta">${escapeHtml(labels.date)} ${escapeHtml(formatReceiptDateTime(sale.createdAt))}</div>`);
    }
    if (sections.showCashier) {
      parts.push(`<div class="meta">${escapeHtml(labels.cashier)} ${escapeHtml(sale.cashierName)}</div>`);
    }
  }

  if (hasMeta && (hasItems || hasTotals) && bodyStyle.showMetaDivider && bodyStyle.dashChar) {
    parts.push(`<div class="dash">${escapeHtml(dash)}</div>`);
  }

  if (hasItems) {
    const itemRows = sale.items
      .map((item) => {
        const discountRow =
          item.discountPercent && item.discountPercent > 0
            ? `<div class="row small muted"><span>${escapeHtml(labels.discount)} ${item.discountPercent}%</span><span></span></div>`
            : '';
        return `<div class="item">
          <div class="break item-name">${escapeHtml(item.productName)}</div>
          <div class="row small"><span>${item.quantity} × ${escapeHtml(fmtMoney(currency, item.unitPrice))}</span><span>${escapeHtml(fmtMoney(currency, item.lineTotal))}</span></div>
          ${discountRow}
        </div>`;
      })
      .join('');
    parts.push(`<div class="items">${itemRows}</div>`);
  }

  if (hasItems && hasTotals && bodyStyle.showBeforeTotalsDivider && bodyStyle.dashChar) {
    parts.push(`<div class="dash">${escapeHtml(dash)}</div>`);
  }

  if (hasTotals) {
    const totalQuantity = sale.items.reduce((sum, i) => sum + i.quantity, 0);
    parts.push(`<div class="row"><span>Total items</span><span>${totalQuantity}</span></div>`);
    if (sections.showSubtotal) {
      parts.push(`<div class="row"><span>${escapeHtml(labels.subtotal)}</span><span>${escapeHtml(fmtMoney(currency, sale.subtotal))}</span></div>`);
    }
    if (sections.showDiscount && sale.discountAmount > 0) {
      parts.push(`<div class="row"><span>${escapeHtml(labels.discount)}</span><span>-${escapeHtml(fmtMoney(currency, sale.discountAmount))}</span></div>`);
    }
    if (sections.showTax) {
      parts.push(`<div class="row"><span>${escapeHtml(labels.tax)}</span><span>${escapeHtml(fmtMoney(currency, sale.taxAmount))}</span></div>`);
    }
    if (sections.showTotal) {
      parts.push(`<div class="row total"><span>${escapeHtml(labels.total)}</span><span>${escapeHtml(fmtMoney(currency, sale.totalAmount))}</span></div>`);
    }
  }

  if (hasTotals && hasPayment && bodyStyle.showBeforePaymentDivider && bodyStyle.dashChar) {
    parts.push(`<div class="dash">${escapeHtml(dash)}</div>`);
  }

  if (hasPayment) {
    parts.push(`<div>${escapeHtml(labels.payment)} ${escapeHtml(sale.paymentMethod.toUpperCase())}</div>`);
    if (sale.amountTendered != null) {
      parts.push(`<div class="row"><span>${escapeHtml(labels.tendered)}</span><span>${escapeHtml(fmtMoney(currency, sale.amountTendered))}</span></div>`);
      parts.push(`<div class="row"><span>${escapeHtml(labels.change)}</span><span>${escapeHtml(fmtMoney(currency, sale.changeGiven ?? 0))}</span></div>`);
    }
  }

  if (sections.showTaxInfo && footer.taxInfo?.trim()) {
    parts.push(`<div class="muted small pre py-1">${escapeHtml(footer.taxInfo.trim())}</div>`);
  }

  const thankYou = footer.thankYouMessage?.trim() || footer.message?.trim();
  const hasFooter =
    (sections.showThankYou && thankYou) ||
    (sections.showReturnPolicy && footer.returnPolicy?.trim()) ||
    sections.showQrCode;

  if ((hasFooter || (sections.showTaxInfo && footer.taxInfo?.trim())) && (hasFooter || sections.showTaxInfo) && bodyStyle.showFooterDivider && bodyStyle.dividerChar) {
    parts.push(`<div class="center rule">${escapeHtml(divider)}</div>`);
  }

  if (sections.showThankYou && thankYou) {
    parts.push(`<div class="center small py-1">${escapeHtml(thankYou)}</div>`);
  }

  if (sections.showReturnPolicy && footer.returnPolicy?.trim()) {
    parts.push(`<div class="center xs muted pre">${escapeHtml(footer.returnPolicy.trim())}</div>`);
  }

  if (footer.customLine?.trim()) {
    parts.push(`<div class="center xs muted pre">${escapeHtml(footer.customLine.trim())}</div>`);
  }

  if (sections.showQrCode) {
    const qrSize = spx(widthMm === 58 ? 56 : 72, scale);
    const qrLabel = footer.qrCodeContent?.trim() || sale.saleNumber;
    parts.push(
      `<div class="center py-1">${qrPlaceholderHtml(qrSize)}<div class="xs muted mt-1 break">${escapeHtml(qrLabel)}</div></div>`,
    );
  }

  if (hasFooter || sections.showQrCode) {
    if (bodyStyle.showFooterDivider && bodyStyle.dividerChar) {
      parts.push(`<div class="center rule">${escapeHtml(divider)}</div>`);
    }
  }

  const body = parts.join('\n');
  const fontFace = buildReceiptPrintFontFaceCss(header);
  const padV = spx(4, scale);
  const padH = spx(forPrint ? 14 : 12, scale);
  const feedPad = forPrint ? 2 : 0;
  const lineHeight = 1.625;
  const bodyFont = spx(bodyStyle.bodyFontSize, scale);
  const smallFont = spx(bodyStyle.smallFontSize, scale);
  const totalFont = spx(bodyStyle.totalFontSize, scale);
  const footerFont = spx(bodyStyle.footerFontSize, scale);
  const fontSmoothing = forPrint
    ? '-webkit-font-smoothing:none;font-smooth:never;text-rendering:geometricPrecision;'
    : '-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  ${fontFace}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${widthPx}px;
    min-height: 0;
    overflow: hidden !important;
    background: ${bg};
    color: ${ink};
    font-family: ${bodyFontFamily};
    font-size: ${bodyFont}px;
    line-height: ${lineHeight};
    ${fontSmoothing}
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  #receipt {
    width: ${widthPx}px;
    max-width: ${widthPx}px;
    padding: ${padV}px ${padH}px ${padV + feedPad}px;
    background: ${bg};
    overflow: hidden;
    position: relative;
  }
  #receipt * { max-width: 100%; }
  .center { text-align: center; }
  .muted { color: ${muted}; }
  .small { font-size: ${smallFont}px; }
  .xs { font-size: ${footerFont}px; }
  .italic { font-style: italic; }
  .pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .break { word-break: break-word; overflow-wrap: anywhere; }
  .py-1 { padding-top: ${spx(4, scale)}px; padding-bottom: ${spx(4, scale)}px; }
  .py-2 { padding-top: ${spx(8, scale)}px; padding-bottom: ${spx(8, scale)}px; }
  .py-3 { padding-top: ${spx(12, scale)}px; padding-bottom: ${spx(12, scale)}px; }
  .mt-1 { margin-top: ${spx(4, scale)}px; }
  .rule { color: ${ruleColor}; padding: ${spx(2, scale)}px 0; }
  .dash { color: ${dashColor}; padding: ${spx(2, scale)}px 0; }
  .row { display: flex; justify-content: space-between; gap: ${spx(8, scale)}px; align-items: flex-start; min-width: 0; }
  .row span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
  .row span:last-child { flex-shrink: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; text-align: right; }
  .total { font-weight: 700; font-size: ${totalFont}px; padding: ${spx(2, scale)}px 0; }
  .items { padding: ${spx(4, scale)}px 0; }
  .item + .item { margin-top: ${spx(8, scale)}px; }
  .meta { font-family: ${metaFontFamily}; }
  .footer-text { font-family: ${footerFontFamily}; }
  .store-name { padding: ${spx(2, scale)}px 0; letter-spacing: 0.025em; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; }
  .item-name { font-family: ${itemFontFamily}; }
</style>
</head>
<body>
  <div id="receipt">${body}</div>
</body>
</html>`;

  return { html, widthPx, widthMm };
}
