import { BrowserWindow, app } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiResult } from '@shared/types';
import { requireRole } from '../session';
import { apiFetch } from '../cloud/client';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, '_').replace(/_+/g, '_');
}

export interface EodSubmitInput {
  html: string;
  fileName: string;
  reportDate: string;
  storeName?: string;
  cashierName?: string;
  openingCash: number;
  cardPayments: number;
  onlinePayments: number;
  totalCashCount: number;
  totalExpenses: number;
  dailySales: number;
}

/**
 * Render the EOD report HTML to a PDF, keep a local copy in Downloads, and upload it to the
 * server so an admin can view/download it on the owner portal. Returns the new report id.
 */
export async function handleEodSubmitReport(
  input: EodSubmitInput,
): Promise<ApiResult<{ id: string; path: string }>> {
  let win: BrowserWindow | null = null;
  try {
    requireRole('super_admin', 'manager', 'cashier');
    if (!input?.html) return { success: false, error: 'No report content' };

    win = new BrowserWindow({
      width: 900,
      height: 1200,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await withTimeout(
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`),
      12000,
      'EOD report HTML load',
    );
    await withTimeout(
      win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()', true),
      5000,
      'EOD font load',
    ).catch(() => undefined);

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });

    // Keep a local copy for the cashier's records.
    const fileName = safeFileName(input.fileName || 'EOD-Report.pdf');
    const outPath = join(app.getPath('downloads'), fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
    await writeFile(outPath, pdf).catch(() => undefined);

    const upload = await apiFetch<{ id: string }>('POST', '/api/v1/eod-reports', {
      reportDate: input.reportDate,
      storeName: input.storeName,
      cashierName: input.cashierName,
      openingCash: input.openingCash,
      cardPayments: input.cardPayments,
      onlinePayments: input.onlinePayments,
      totalCashCount: input.totalCashCount,
      totalExpenses: input.totalExpenses,
      dailySales: input.dailySales,
      pdfBase64: pdf.toString('base64'),
    });

    if (!upload.success || !upload.data) {
      return { success: false, error: upload.error ?? 'Could not submit report to server' };
    }
    return { success: true, data: { id: upload.data.id, path: outPath } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'EOD submit failed' };
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}
