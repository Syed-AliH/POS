import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { ReceiptSale } from '@mama-babi/printer';
import { printReceiptToDevice } from '../services/printer';

export type PrintJobState = 'queued' | 'printing' | 'printed' | 'failed';

export interface PrintStatusEvent {
  jobId: string;
  saleNumber: string;
  state: PrintJobState;
  error?: string;
}

interface Job {
  jobId: string;
  sale: ReceiptSale;
}

const queue: Job[] = [];
let running = false;
let sequence = 0;

/** A thermal printer cannot interleave jobs, so keep the queue strictly serial. */
const MAX_QUEUED = 20;

function broadcast(event: PrintStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.PRINT_STATUS, event);
  }
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      broadcast({ jobId: job.jobId, saleNumber: job.sale.saleNumber, state: 'printing' });
      try {
        const result = await printReceiptToDevice(job.sale);
        broadcast({
          jobId: job.jobId,
          saleNumber: job.sale.saleNumber,
          state: result.printed ? 'printed' : 'failed',
          error: result.printed ? undefined : 'Printer did not accept the job',
        });
      } catch (e) {
        broadcast({
          jobId: job.jobId,
          saleNumber: job.sale.saleNumber,
          state: 'failed',
          error: e instanceof Error ? e.message : 'Print failed',
        });
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Accepts a receipt for printing and returns immediately — rendering a receipt takes
 * hundreds of milliseconds and must not hold the Charge button. Progress is pushed to
 * the renderer on PRINT_STATUS.
 */
export function enqueueReceipt(sale: ReceiptSale): { jobId: string; queued: boolean; error?: string } {
  if (queue.length >= MAX_QUEUED) {
    return { jobId: '', queued: false, error: 'Print queue is full — check the printer' };
  }
  sequence += 1;
  const jobId = `print-${sequence}`;
  queue.push({ jobId, sale });
  broadcast({ jobId, saleNumber: sale.saleNumber, state: 'queued' });
  void drain();
  return { jobId, queued: true };
}

export function pendingReceiptCount(): number {
  return queue.length + (running ? 1 : 0);
}
