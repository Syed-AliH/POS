import { BrowserWindow } from 'electron';

export type SystemPrinter = { name: string; isDefault: boolean };

export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
}

function findByName(printers: SystemPrinter[], name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const exact = printers.find((p) => p.name === trimmed);
  if (exact) return exact.name;
  const lower = trimmed.toLowerCase();
  return printers.find((p) => p.name.toLowerCase() === lower)?.name;
}

function findByHint(printers: SystemPrinter[], hint: string): string | undefined {
  const h = hint.trim().toLowerCase();
  if (!h) return undefined;
  return printers.find((p) => p.name.toLowerCase().includes(h))?.name;
}

/** Gainscha / label printers speak TSPL — not ESC/POS receipts. */
export function isLikelyLabelPrinterName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('gainscha') ||
    n.includes('tspl') ||
    n.includes('label') ||
    /\bgs-\d/i.test(name)
  );
}

/** Receipt printer: configured name only. Empty = print preview (no hardware). */
export async function resolveReceiptPrinterName(
  configuredName?: string | null,
): Promise<string | undefined> {
  const trimmed = configuredName?.trim();
  if (!trimmed) return undefined;
  const printers = await listSystemPrinters();
  return findByName(printers, trimmed) ?? findByHint(printers, trimmed);
}

/** Label printer: configured name, else auto-detect Gainscha. Never falls back to receipt printer. */
export async function resolveLabelPrinterName(configuredName?: string | null): Promise<string | undefined> {
  const printers = await listSystemPrinters();
  if (!printers.length) return undefined;

  const fromSetting = configuredName ? findByName(printers, configuredName) ?? findByHint(printers, configuredName) : undefined;
  if (fromSetting) return fromSetting;

  return findByHint(printers, 'gainscha');
}

export async function resolveLabelPrinterNameOrThrow(configuredName?: string | null): Promise<string> {
  const name = await resolveLabelPrinterName(configuredName);
  if (!name) {
    const available = (await listSystemPrinters()).map((p) => p.name).join(', ') || 'none detected';
    throw new Error(
      `Label printer not found. Set Settings → Printers → Label printer to your Gainscha device, or install the Gainscha driver. Available: ${available}`,
    );
  }
  return name;
}
