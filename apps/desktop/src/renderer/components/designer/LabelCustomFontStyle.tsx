import { buildLabelPrintFontFaceCss, collectCustomLabelFonts, type LabelElement } from '@mama-babi/printer';

export function LabelCustomFontStyle({ elements }: { elements?: LabelElement[] }) {
  const css = buildLabelPrintFontFaceCss(collectCustomLabelFonts(elements));
  if (!css) return null;
  return <style>{css}</style>;
}
