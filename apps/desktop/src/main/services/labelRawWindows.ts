import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Send RAW bytes to a Windows printer (WritePrinter API — works with Gainscha TSPL). */
export function sendRawToWindowsPrinter(printerName: string, data: string | Buffer): Promise<void> {
  const file = join(tmpdir(), `label_raw_${Date.now()}.bin`);
  writeFileSync(file, data);

  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedFile = file.replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
$printer = '${escapedPrinter}'
$file = '${escapedFile}'
$bytes = [System.IO.File]::ReadAllBytes($file)
Add-Type -TypeDefinition @'
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
'@
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
`;

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { shell: false },
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
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
      if (code === 0) {
        console.log('[print:raw] sent', { printerName, bytes: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data) });
        resolve();
      } else {
        reject(new Error(`RAW print failed (exit ${code}): ${stderr.trim() || stdout.trim() || 'unknown error'}`));
      }
    });
  });
}
