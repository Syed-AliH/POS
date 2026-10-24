import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Raw printing goes through winspool's WritePrinter, reached from PowerShell via a
 * small C# shim. Starting PowerShell and compiling that shim costs 3–5 seconds on a
 * shop PC, and it used to happen on every receipt and every label job — that was the
 * pause between saving a bill and the printer moving.
 *
 * Now one PowerShell process compiles the shim once (warmed up at app start) and
 * then prints jobs read from stdin, so a receipt reaches the spooler in milliseconds.
 * If that worker can't start or dies, a job falls back to the old one-shot process,
 * which is slow but always works.
 */

const RAW_PRINT_TYPE = `
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOW di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);
}
`;

/** Prints the bytes in $file on $printer; throws on any spooler failure. */
const PRINT_FUNCTION = `
function Send-RawFile([string]$printer, [string]$file) {
  $bytes = [System.IO.File]::ReadAllBytes($file)
  $h = [IntPtr]::Zero
  if (-not [RawPrint]::OpenPrinter($printer, [ref]$h, [IntPtr]::Zero)) {
    throw "OpenPrinter failed for '$printer'"
  }
  try {
    $doc = New-Object RawPrint+DOCINFOW
    $doc.pDocName = 'MamaBabiLabel'
    $doc.pOutputFile = $null
    $doc.pDatatype = 'RAW'
    if (-not [RawPrint]::StartDocPrinter($h, 1, [ref]$doc)) { throw 'StartDocPrinter failed' }
    try {
      if (-not [RawPrint]::StartPagePrinter($h)) { throw 'StartPagePrinter failed' }
      try {
        $written = 0
        if (-not [RawPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw 'WritePrinter failed' }
      } finally { [RawPrint]::EndPagePrinter($h) | Out-Null }
    } finally { [RawPrint]::EndDocPrinter($h) | Out-Null }
  } finally { [RawPrint]::ClosePrinter($h) | Out-Null }
}
`;

/**
 * Worker loop: one job per stdin line, "<id>\\t<base64 printer>\\t<base64 file path>",
 * answered with "OK\\t<id>" or "ERR\\t<id>\\t<message>". Base64 keeps quotes, tabs and
 * non-ASCII printer names out of the protocol. Ends when stdin closes (app exit).
 */
const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
# Progress records arrive on stderr as CLIXML noise; UTF-8 keeps non-ASCII printer
# names readable in the error messages sent back.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${RAW_PRINT_TYPE}
'@
${PRINT_FUNCTION}
function From-B64([string]$s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line.Trim() -eq '') { continue }
  $parts = $line.Split([char]9)
  $id = $parts[0]
  try {
    Send-RawFile (From-B64 $parts[1]) (From-B64 $parts[2])
    [Console]::Out.WriteLine("OK" + [char]9 + $id)
  } catch {
    $msg = ($_.Exception.Message -replace '[\\r\\n\\t]+', ' ')
    [Console]::Out.WriteLine("ERR" + [char]9 + $id + [char]9 + $msg)
  }
  [Console]::Out.Flush()
}
`;

/** A spooler hand-off is milliseconds; anything this slow means the worker is stuck. */
const JOB_TIMEOUT_MS = 30_000;

let tempSequence = 0;

function writeJobFile(data: string | Buffer): string {
  tempSequence += 1;
  const file = join(tmpdir(), `label_raw_${process.pid}_${Date.now()}_${tempSequence}.bin`);
  writeFileSync(file, data);
  return file;
}

function removeQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

type PendingJob = { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

class RawPrintWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingJob>();
  private stdoutBuffer = '';
  private nextId = 0;

  start(): void {
    if (this.proc) return;
    // -EncodedCommand takes UTF-16LE base64 and keeps the script off stdin, which the
    // worker reads jobs from.
    const encoded = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { shell: false, windowsHide: true },
    );
    this.proc = proc;
    this.stdoutBuffer = '';
    proc.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => console.warn('[print:raw-worker] stderr', chunk.toString().trim()));
    proc.on('error', (err) => this.fail(proc, err));
    proc.on('exit', (code) => this.fail(proc, new Error(`print worker exited (code ${code})`)));
  }

  send(printerName: string, file: string): Promise<void> {
    this.start();
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error('print worker unavailable'));
    this.nextId += 1;
    const id = String(this.nextId);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`print worker did not answer within ${JOB_TIMEOUT_MS / 1000}s`));
        this.stop(); // Wedged — the next job starts a fresh worker.
      }, JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${id}\t${b64(printerName)}\t${b64(file)}\n`);
    });
  }

  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    this.fail(proc, new Error('print worker stopped'));
    try {
      proc.stdin.end();
      proc.kill();
    } catch {
      /* already exiting */
    }
  }

  private onStdout(text: string): void {
    this.stdoutBuffer += text;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      const [status, id, message] = line.split('\t');
      if (status === 'READY') {
        console.log('[print:raw-worker] ready');
        continue;
      }
      const job = id ? this.pending.get(id) : undefined;
      if (!job) continue;
      this.pending.delete(id!);
      clearTimeout(job.timer);
      if (status === 'OK') job.resolve();
      else job.reject(new Error(message || 'RAW print failed'));
    }
  }

  /** Rejects everything in flight for `proc` and forgets it, once. */
  private fail(proc: ChildProcessWithoutNullStreams, err: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(err);
    }
    this.pending.clear();
  }
}

const worker = new RawPrintWorker();

/** Start the print worker ahead of the first receipt so even that one prints instantly. */
export function warmRawPrinter(): void {
  if (process.platform !== 'win32') return;
  try {
    worker.start();
  } catch (err) {
    console.warn('[print:raw-worker] could not start', err);
  }
}

export function stopRawPrinter(): void {
  worker.stop();
}

/** Send RAW bytes to a Windows printer (WritePrinter API — works with Gainscha TSPL). */
export async function sendRawToWindowsPrinter(printerName: string, data: string | Buffer): Promise<void> {
  const file = writeJobFile(data);
  const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  try {
    try {
      await worker.send(printerName, file);
    } catch (err) {
      // A spooler error (printer offline, wrong name) is the printer's answer, not a
      // worker problem — retrying would only repeat it, slowly. Anything else means
      // the worker itself is unusable, so this job goes the old way.
      if (err instanceof Error && /OpenPrinter|StartDoc|StartPage|WritePrinter/.test(err.message)) throw err;
      console.warn('[print:raw-worker] falling back to one-shot print:', err instanceof Error ? err.message : err);
      await sendRawOneShot(printerName, file);
    }
    console.log('[print:raw] sent', { printerName, bytes });
  } finally {
    removeQuietly(file);
  }
}

/** The original path: a fresh PowerShell per job. Slow (seconds), kept as the fallback. */
function sendRawOneShot(printerName: string, file: string): Promise<void> {
  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedFile = file.replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${RAW_PRINT_TYPE}
'@
${PRINT_FUNCTION}
Send-RawFile '${escapedPrinter}' '${escapedFile}'
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { shell: false, windowsHide: true },
    );
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`RAW print failed (exit ${code}): ${stderr.trim() || stdout.trim() || 'unknown error'}`));
    });
  });
}
