import { LABEL_PRINT_PX_PER_MM } from './labelRender';

export type LabelPaperType = 'gap' | 'black_mark' | 'continuous';
export type LabelOrientation = 'portrait' | 'landscape';
export type LabelScaleMode = '100' | 'fit_width' | 'custom';

export interface LabelRollConfig {
  columns: number;
  /** 1 = thermal roll (one row per print job); >1 for multi-row sheets */
  rows: number;
  horizontalGapMm: number;
  verticalGapMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  paperType: LabelPaperType;
  dpi: 203 | 300;
  orientation: LabelOrientation;
  rotate180: boolean;
  scaleMode: LabelScaleMode;
  customScalePercent: number;
  offsetXMm: number;
  offsetYMm: number;
}

export const DEFAULT_LABEL_ROLL_CONFIG: LabelRollConfig = {
  columns: 2,
  rows: 1,
  horizontalGapMm: 2,
  verticalGapMm: 2,
  marginLeftMm: 0,
  marginRightMm: 0,
  marginTopMm: 0,
  marginBottomMm: 0,
  paperType: 'gap',
  dpi: 203,
  orientation: 'portrait',
  rotate180: false,
  scaleMode: '100',
  customScalePercent: 100,
  offsetXMm: 0,
  offsetYMm: 0,
};

export function normalizeLabelRollConfig(raw?: Partial<LabelRollConfig> | null): LabelRollConfig {
  if (!raw) return { ...DEFAULT_LABEL_ROLL_CONFIG };
  return {
    ...DEFAULT_LABEL_ROLL_CONFIG,
    ...raw,
    columns: Math.max(1, Math.round(raw.columns ?? DEFAULT_LABEL_ROLL_CONFIG.columns)),
    rows: Math.max(1, Math.round(raw.rows ?? DEFAULT_LABEL_ROLL_CONFIG.rows)),
    horizontalGapMm: Math.max(0, raw.horizontalGapMm ?? DEFAULT_LABEL_ROLL_CONFIG.horizontalGapMm),
    verticalGapMm: Math.max(0, raw.verticalGapMm ?? DEFAULT_LABEL_ROLL_CONFIG.verticalGapMm),
    marginLeftMm: Math.max(0, raw.marginLeftMm ?? DEFAULT_LABEL_ROLL_CONFIG.marginLeftMm),
    marginRightMm: Math.max(0, raw.marginRightMm ?? DEFAULT_LABEL_ROLL_CONFIG.marginRightMm),
    marginTopMm: Math.max(0, raw.marginTopMm ?? DEFAULT_LABEL_ROLL_CONFIG.marginTopMm),
    marginBottomMm: Math.max(0, raw.marginBottomMm ?? DEFAULT_LABEL_ROLL_CONFIG.marginBottomMm),
    customScalePercent: Math.max(10, Math.min(200, raw.customScalePercent ?? 100)),
    offsetXMm: raw.offsetXMm ?? 0,
    offsetYMm: raw.offsetYMm ?? 0,
  };
}

/** Roll width = left margin + labels + horizontal gaps + right margin (e.g. 2+38+2+38+2 = 82 mm). */
export function calcPrintableWidth(config: LabelRollConfig, labelWidthMm: number): number {
  const cols = Math.max(1, config.columns);
  return (
    config.marginLeftMm +
    cols * labelWidthMm +
    (cols - 1) * config.horizontalGapMm +
    config.marginRightMm
  );
}

export function calcRollWidthMm(config: LabelRollConfig, labelWidthMm: number): number {
  return calcPrintableWidth(config, labelWidthMm);
}

/** Printable height for a given number of label rows on the page */
export function calcPrintableHeight(
  config: LabelRollConfig,
  labelHeightMm: number,
  rowCount = 1,
): number {
  const rows = Math.max(1, rowCount);
  return (
    config.marginTopMm +
    rows * labelHeightMm +
    (rows - 1) * config.verticalGapMm +
    config.marginBottomMm
  );
}

export interface LabelSlotPosition {
  index: number;
  column: number;
  row: number;
  xMm: number;
  yMm: number;
}

export function calcLabelSlotPosition(
  config: LabelRollConfig,
  labelWidthMm: number,
  labelHeightMm: number,
  slotIndex: number,
): LabelSlotPosition {
  const columns = Math.max(1, config.columns);
  const col = slotIndex % columns;
  const row = Math.floor(slotIndex / columns);
  const xMm =
    config.marginLeftMm +
    config.offsetXMm +
    col * (labelWidthMm + config.horizontalGapMm);
  const yMm =
    config.marginTopMm +
    config.offsetYMm +
    row * (labelHeightMm + config.verticalGapMm);
  return { index: slotIndex, column: col, row, xMm, yMm };
}

export function resolvePrintScalePercent(config: LabelRollConfig): number {
  if (config.scaleMode === 'custom') return config.customScalePercent;
  return 100;
}

export function resolveLabelDimensions(
  labelWidthMm: number,
  labelHeightMm: number,
  config: LabelRollConfig,
): { widthMm: number; heightMm: number } {
  if (config.orientation === 'landscape') {
    return { widthMm: labelHeightMm, heightMm: labelWidthMm };
  }
  return { widthMm: labelWidthMm, heightMm: labelHeightMm };
}

export function buildPreviewSlots(
  config: LabelRollConfig,
  labelWidthMm: number,
  labelHeightMm: number,
  previewRowCount: number,
): LabelSlotPosition[] {
  const columns = Math.max(1, config.columns);
  const rows = Math.max(1, previewRowCount);
  const slots: LabelSlotPosition[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      slots.push(calcLabelSlotPosition(config, labelWidthMm, labelHeightMm, r * columns + c));
    }
  }
  return slots;
}

export interface LabelSlotPositionPx {
  index: number;
  column: number;
  row: number;
  leftPx: number;
  topPx: number;
  labelWidthPx: number;
  labelHeightPx: number;
}

/** Pixel layout for print/capture — keeps column gaps consistent (avoids mm rounding drift). */
export function calcLabelSlotPositionPx(
  config: LabelRollConfig,
  labelWidthMm: number,
  labelHeightMm: number,
  slotIndex: number,
): LabelSlotPositionPx {
  const columns = Math.max(1, config.columns);
  const col = slotIndex % columns;
  const row = Math.floor(slotIndex / columns);
  const labelWidthPx = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const labelHeightPx = Math.round(labelHeightMm * LABEL_PRINT_PX_PER_MM);
  const hGapPx = Math.round(config.horizontalGapMm * LABEL_PRINT_PX_PER_MM);
  const vGapPx = Math.round(config.verticalGapMm * LABEL_PRINT_PX_PER_MM);
  const marginLeftPx = Math.round(config.marginLeftMm * LABEL_PRINT_PX_PER_MM);
  const marginTopPx = Math.round(config.marginTopMm * LABEL_PRINT_PX_PER_MM);
  const offsetXPx = Math.round(config.offsetXMm * LABEL_PRINT_PX_PER_MM);
  const offsetYPx = Math.round(config.offsetYMm * LABEL_PRINT_PX_PER_MM);
  return {
    index: slotIndex,
    column: col,
    row,
    leftPx: marginLeftPx + offsetXPx + col * (labelWidthPx + hGapPx),
    topPx: marginTopPx + offsetYPx + row * (labelHeightPx + vGapPx),
    labelWidthPx,
    labelHeightPx,
  };
}

/** Page bitmap size in print pixels — sum of rounded slot parts (matches TSPL dot count). */
export function calcPrintablePageSizePx(
  config: LabelRollConfig,
  labelWidthMm: number,
  labelHeightMm: number,
  rowCount = 1,
): { width: number; height: number } {
  const columns = Math.max(1, config.columns);
  const rows = Math.max(1, rowCount);
  const labelWidthPx = Math.round(labelWidthMm * LABEL_PRINT_PX_PER_MM);
  const labelHeightPx = Math.round(labelHeightMm * LABEL_PRINT_PX_PER_MM);
  const hGapPx = Math.round(config.horizontalGapMm * LABEL_PRINT_PX_PER_MM);
  const vGapPx = Math.round(config.verticalGapMm * LABEL_PRINT_PX_PER_MM);
  const marginLeftPx = Math.round(config.marginLeftMm * LABEL_PRINT_PX_PER_MM);
  const marginRightPx = Math.round(config.marginRightMm * LABEL_PRINT_PX_PER_MM);
  const marginTopPx = Math.round(config.marginTopMm * LABEL_PRINT_PX_PER_MM);
  const marginBottomPx = Math.round(config.marginBottomMm * LABEL_PRINT_PX_PER_MM);
  return {
    width: Math.max(
      1,
      marginLeftPx + columns * labelWidthPx + (columns - 1) * hGapPx + marginRightPx,
    ),
    height: Math.max(
      1,
      marginTopPx + rows * labelHeightPx + (rows - 1) * vGapPx + marginBottomPx,
    ),
  };
}

/** Gainscha MamaBabi die-cut 2-up on 78 mm roll (matches BarTender stock 38.1 × 25.4 mm). */
export const MAMABABI_38_1x25_4_2UP_ROLL: LabelRollConfig = {
  ...DEFAULT_LABEL_ROLL_CONFIG,
  columns: 2,
  horizontalGapMm: 1.8,
  verticalGapMm: 2,
  marginLeftMm: 0,
  marginRightMm: 0,
};
