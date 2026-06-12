import type { ReceiptTemplateHeader } from '@mama-babi/printer';

export function ReceiptCustomFontStyle({ header }: { header: ReceiptTemplateHeader }) {
  if (header.storeNameFontFamily !== 'custom' || !header.storeNameCustomFontDataUrl || !header.storeNameCustomFontName) {
    return null;
  }

  const safeName = header.storeNameCustomFontName.replace(/'/g, '');
  const format = header.storeNameCustomFontFormat ?? 'truetype';

  return (
    <style>{`
      @font-face {
        font-family: '${safeName}';
        src: url('${header.storeNameCustomFontDataUrl}') format('${format}');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `}</style>
  );
}
