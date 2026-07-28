import type { ReceiptTemplateConfig } from '@mama-babi/printer';
import { getAllSettings } from '../services/settings';
import { getDefaultReceiptTemplate, receiptTemplateToConfig } from '../services/receiptTemplates';
import { resolveReceiptPrinterName } from '../services/printerDevices';

/**
 * Everything a receipt print needs that does not change between receipts.
 *
 * Resolving this used to happen per receipt: two full reads of the receipt-template
 * table, two settings reads, and a system printer enumeration. It is cached with a
 * short TTL so a newly connected printer is still picked up, and invalidated
 * explicitly when settings or templates change.
 */
export interface PrintContext {
  settings: Record<string, string>;
  template: ReceiptTemplateConfig | undefined;
  printerName: string | undefined;
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: PrintContext } | null = null;
let inflight: Promise<PrintContext> | null = null;

export function invalidatePrintContext(): void {
  cached = null;
  inflight = null;
}

export async function getPrintContext(): Promise<PrintContext> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const settings = getAllSettings();
      const tpl = getDefaultReceiptTemplate();
      const value: PrintContext = {
        settings,
        template: tpl ? receiptTemplateToConfig(tpl) : undefined,
        printerName: await resolveReceiptPrinterName(settings.receipt_printer),
      };
      cached = { at: Date.now(), value };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
