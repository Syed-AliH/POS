import { BrowserWindow } from 'electron';
import type { ApiResult, PrinterInfo, SettingsUpdateInput } from '@shared/types';
import { requireRole, requireSession } from '../session';
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
  'label_printer',
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
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { success: true, data: [] };

    const printers = await win.webContents.getPrintersAsync();
    return {
      success: true,
      data: printers.map((p) => ({ name: p.name, isDefault: p.isDefault })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List printers failed' };
  }
}
