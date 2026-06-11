export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}

export function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone?.trim()) return { valid: true };
  const normalized = normalizePhone(phone);
  if (!/^(\+92|0)?3[0-9]{9}$/.test(normalized) && !/^\+?[0-9]{10,15}$/.test(normalized)) {
    return { valid: false, error: 'Invalid phone (use 03XX-XXXXXXX or +92 format)' };
  }
  return { valid: true };
}
