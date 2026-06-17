import type { LabelRollConfig } from '@mama-babi/printer';
import { buildTsplUtilityCommand } from './labelTspl';
import { sendRawToWindowsPrinter } from './labelRawWindows';
import { resolveLabelRollLayout } from './labelRollLayout';
import { resolveLabelPrinterNameOrThrow } from './printerDevices';
import { getAllSettings } from './settings';

export async function sendLabelPrinterCommand(
  command: 'FORMFEED' | 'GAPDETECT',
  rollConfig?: Partial<LabelRollConfig>,
  widthMm = 38,
  heightMm = 28,
): Promise<void> {
  const settings = getAllSettings();
  const printerName = await resolveLabelPrinterNameOrThrow(settings.label_printer);
  const roll = resolveLabelRollLayout(widthMm, heightMm, rollConfig);
  const tspl = buildTsplUtilityCommand(command, roll);
  console.log('[print:label:cmd]', { printerName, command, bytes: tspl.length });
  await sendRawToWindowsPrinter(printerName, tspl);
  console.log('[print:label:cmd] success', command);
}
