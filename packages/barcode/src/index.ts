let skuCounter = Date.now() % 100000;

export function generateSku(prefix = 'MB'): string {
  skuCounter += 1;
  return `${prefix}-${String(skuCounter).padStart(6, '0')}`;
}

export function generateBarcode(): string {
  const base = Date.now().toString().slice(-11);
  return `89${base.padStart(11, '0').slice(0, 11)}`;
}
