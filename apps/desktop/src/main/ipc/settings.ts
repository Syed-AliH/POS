import type { ApiResult, PrinterInfo, SettingsUpdateInput } from '@shared/types';import { requireRole, requireSession } from '../session';
import { getAllSettings, getSetting, setSetting } from '../services/settings';
import { logAudit } from '../services/audit';

const EDITABLE_SETTINGS = new Set([
  'store_name',
  'store_address',
  'store_phone',
  'currency',
  'tax_inclusive',
  'default_tax_rate',
  'receipt_printer',
  'receipt_paper_mm',
  'label_printer',
  'label_print_offset_mm',
  'auto_print_receipt',
  'return_policy_days',
  'secondary_currency',
  'exchange_rate',
]);

export function handleSettingsGet(key: string): ApiResult<string | null> {
  try {
    requireSession();
    return { success: true, data: getSetting(key) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Settings get failed' };
  }
}

export function handleSettingsGetAll(): ApiResult<Record<string, string>> {
  try {
    requireSession();
    return { success: true, data: getAllSettings() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Settings get failed' };
  }
}

export function handleSettingsSet(input: SettingsUpdateInput): ApiResult<Record<string, string>> {
  try {
    requireRole('super_admin', 'manager');
    for (const [key, value] of Object.entries(input.settings)) {
      if (!EDITABLE_SETTINGS.has(key)) {
        return { success: false, error: `Setting not editable: ${key}` };
      }
      setSetting(key, value);
    }
    logAudit('settings', 'update', undefined, undefined, input.settings);
    return { success: true, data: getAllSettings() };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Settings save failed' };
  }
}

export async function handleListPrinters(): Promise<ApiResult<PrinterInfo[]>> {
  try {
    requireRole('super_admin', 'manager');
    const { listSystemPrinters, resolveLabelPrinterName } = await import('../services/printerDevices');
    const printers = await listSystemPrinters();

    // Auto-pick Gainscha for labels when not configured yet
    if (!getSetting('label_printer') && printers.length) {
      const gainscha = await resolveLabelPrinterName(null);
      if (gainscha) setSetting('label_printer', gainscha);
    }

    return {
      success: true,
      data: printers.map((p) => ({ name: p.name, isDefault: p.isDefault })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List printers failed' };
  }
}
