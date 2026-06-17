import {
  normalizeLabelRollConfig,
  normalizeBarcodeForPrint,
  resolveLabelLayoutForPrint,
  SAMPLE_LABEL_PRODUCT,
  type LabelProduct,
} from '@mama-babi/printer';
import { printLabelsBatch } from './labelPrinter';
import { getLabelTemplateById } from './labelTemplates';
import { getAllSettings } from './settings';

/** Same sample product as Label Designer canvas — one per column on the test row. */
function buildTestPrintProducts(columns: number): LabelProduct[] {
  const sample: LabelProduct = {
    ...SAMPLE_LABEL_PRODUCT,
    barcode: normalizeBarcodeForPrint(SAMPLE_LABEL_PRODUCT.barcode),
  };
  return Array.from({ length: Math.max(1, columns) }, () => ({ ...sample }));
}

function resolveTemplateForPrint(templateId: string) {
  const template = getLabelTemplateById(templateId);
  if (!template) throw new Error('Label template not found');

  const settings = getAllSettings();
  return {
    template,
    layout: resolveLabelLayoutForPrint(template.layout, settings.store_name),
    rollConfig: normalizeLabelRollConfig(template.rollConfig),
    currency: settings.currency ?? 'PKR',
  };
}

/** Single print entry point — always reads layout + roll config from the saved DB template. */
export async function printLabelsFromTemplate(
  templateId: string,
  products: LabelProduct[],
): Promise<{ printed: boolean; labelCount: number; templateName: string }> {
  const { template, layout, rollConfig } = resolveTemplateForPrint(templateId);

  console.log('[print:label:template]', {
    templateId,
    templateName: template.name,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    columns: rollConfig.columns,
    horizontalGapMm: rollConfig.horizontalGapMm,
    verticalGapMm: rollConfig.verticalGapMm,
    marginLeftMm: rollConfig.marginLeftMm,
    offsetXMm: rollConfig.offsetXMm,
    offsetYMm: rollConfig.offsetYMm,
    elements: layout.elements?.map((e) => ({
      type: e.type, x: e.x, y: e.y, align: e.align, visible: e.visible,
    })) ?? [],
    labelCount: products.length,
  });

  const result = await printLabelsBatch(
    products,
    layout,
    template.widthMm,
    template.heightMm,
    rollConfig,
  );

  return { ...result, templateName: template.name };
}

export async function printTestLabelFromTemplate(
  templateId: string,
): Promise<{ printed: boolean; templateName: string }> {
  const { template, rollConfig } = resolveTemplateForPrint(templateId);
  const sampleProducts = buildTestPrintProducts(rollConfig.columns);
  const result = await printLabelsFromTemplate(templateId, sampleProducts);
  return { printed: result.printed, templateName: template.name };
}
