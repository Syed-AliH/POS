import type { LabelRollConfig, LabelSlotPosition } from '@mama-babi/printer';
import {
  calcLabelSlotPosition,
  calcPrintableHeight,
  calcPrintableWidth,
  normalizeLabelRollConfig,
} from '@mama-babi/printer';

export type LabelRollLayout = {
  labelWidthMm: number;
  labelHeightMm: number;
  rollConfig: LabelRollConfig;
  /** Full printable width for one row (includes all columns + gaps + margins) */
  printableWidthMm: number;
  /** Printable height for the page (one or more label rows). */
  printableHeightMm: number;
  /** Label rows on this print page. */
  rowCount: number;
};

export function resolveLabelRollLayout(
  labelWidthMm: number,
  labelHeightMm: number,
  rollConfig?: Partial<LabelRollConfig> | null,
  rowCount = 1,
): LabelRollLayout {
  const config = normalizeLabelRollConfig(rollConfig);
  const rows = Math.max(1, rowCount);
  return {
    labelWidthMm,
    labelHeightMm,
    rollConfig: config,
    printableWidthMm: calcPrintableWidth(config, labelWidthMm),
    printableHeightMm: calcPrintableHeight(config, labelHeightMm, rows),
    rowCount: rows,
  };
}

export function slotForIndex(
  roll: LabelRollLayout,
  slotIndex: number,
): LabelSlotPosition {
  return calcLabelSlotPosition(
    roll.rollConfig,
    roll.labelWidthMm,
    roll.labelHeightMm,
    slotIndex,
  );
}
