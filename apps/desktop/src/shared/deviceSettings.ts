/** Per-machine settings stored in local SQLite only (not the cloud database). */
export const DEVICE_LOCAL_SETTING_KEYS = new Set([
  'receipt_printer',
  'receipt_paper_mm',
  // Ink level depends on this till's head wear and paper, not the shop's settings.
  'receipt_ink_level',
  'label_printer',
  'label_print_offset_mm',
  'auto_print_receipt',
]);

export function pickDeviceLocalSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => DEVICE_LOCAL_SETTING_KEYS.has(key)),
  );
}

export function omitDeviceLocalSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !DEVICE_LOCAL_SETTING_KEYS.has(key)),
  );
}

export function mergeDeviceLocalSettings(
  cloud: Record<string, string>,
  local: Record<string, string>,
): Record<string, string> {
  return { ...cloud, ...pickDeviceLocalSettings(local) };
}
