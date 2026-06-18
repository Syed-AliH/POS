/** Build ESC/POS bytes for a plain-text receipt (thermal 58/80 mm). */
export function buildEscPosReceipt(
  text: string,
  options?: { feedLines?: number; cut?: boolean },
): Buffer {
  const chunks: Buffer[] = [];
  // Initialize printer
  chunks.push(Buffer.from([0x1b, 0x40]));
  // Left align (default)
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));

  for (const line of text.split(/\r?\n/)) {
    chunks.push(Buffer.from(`${line}\n`, 'utf8'));
  }

  const feed = Math.min(255, Math.max(1, options?.feedLines ?? 4));
  chunks.push(Buffer.from([0x1b, 0x64, feed]));

  if (options?.cut !== false) {
    // Partial cut with feed — widely supported on 58/80 mm thermal printers
    chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  }

  return Buffer.concat(chunks);
}
