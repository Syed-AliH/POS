import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { labelTemplates } from '@mama-babi/db-schema';
import { defaultLabelElements, type LabelLayout } from '@mama-babi/printer';
import type { LabelTemplateSummary } from '@shared/types';
import { getDb } from '../db';
import { getSetting, getAllSettings } from './settings';

const PRESET_TEMPLATES = [
  {
    name: 'Standard 50×30',
    widthMm: 50,
    heightMm: 30,
    layout: {
      elements: defaultLabelElements(),
      showBarcodeGraphic: true,
    } satisfies LabelLayout,
    isDefault: true,
  },
  {
    name: 'Compact 40×30',
    widthMm: 40,
    heightMm: 30,
    layout: {
      elements: defaultLabelElements().map((e) => ({ ...e, fontSize: Math.max(7, e.fontSize - 1) })),
      showBarcodeGraphic: true,
    } satisfies LabelLayout,
    isDefault: false,
  },
  {
    name: 'Shelf Tag 50×25',
    widthMm: 50,
    heightMm: 25,
    layout: {
      elements: [
        { id: 'name', type: 'name' as const, visible: true, x: 5, y: 15, fontSize: 10, align: 'left' as const, fontWeight: 'bold' as const },
        { id: 'price', type: 'price' as const, visible: true, x: 5, y: 38, fontSize: 14, align: 'left' as const, fontWeight: 'bold' as const },
        { id: 'sku', type: 'sku' as const, visible: true, x: 5, y: 58, fontSize: 7, align: 'left' as const },
      ],
      showBarcodeGraphic: false,
    } satisfies LabelLayout,
    isDefault: false,
  },
  {
    name: 'Large 60×40',
    widthMm: 60,
    heightMm: 40,
    layout: {
      elements: defaultLabelElements().map((e) => ({ ...e, fontSize: e.fontSize + 1 })),
      showBarcodeGraphic: true,
    } satisfies LabelLayout,
    isDefault: false,
  },
];

export function seedLabelTemplatesIfEmpty(): void {
  const db = getDb();
  const existing = db.select().from(labelTemplates).limit(1).all();
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';
  const storeName = getSetting('store_name') ?? 'Store';

  for (const preset of PRESET_TEMPLATES) {
    const layout = { ...preset.layout, storeName };
    db.insert(labelTemplates)
      .values({
        id: uuid(),
        name: preset.name,
        widthMm: preset.widthMm,
        heightMm: preset.heightMm,
        layoutJson: JSON.stringify(layout),
        isDefault: preset.isDefault,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  console.log('[seed] Label templates seeded');
}

export function listLabelTemplates(): LabelTemplateSummary[] {
  const db = getDb();
  const settings = getAllSettings();
  const storeName = settings.store_name ?? 'Store';

  return db
    .select()
    .from(labelTemplates)
    .where(eq(labelTemplates.isDeleted, false))
    .all()
    .map((row) => {
      const layout = JSON.parse(row.layoutJson) as LabelLayout;
      if (!layout.storeName) layout.storeName = storeName;
      return {
        id: row.id,
        name: row.name,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        layout,
        isDefault: row.isDefault,
      };
    });
}
