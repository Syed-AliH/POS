import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { labelTemplates } from '@mama-babi/db-schema';
import type { LabelLayout } from '@mama-babi/printer';
import type { LabelTemplateSummary } from '@shared/types';
import { getDb } from '../db';
import { getSetting } from './settings';

const PRESET_TEMPLATES = [
  {
    name: 'Standard 50×30',
    widthMm: 50,
    heightMm: 30,
    layout: { fields: ['name', 'price', 'sku'] as const, showBarcode: true, fontSize: '12px' },
    isDefault: true,
  },
  {
    name: 'Shelf Tag',
    widthMm: 50,
    heightMm: 25,
    layout: { fields: ['name', 'price'] as const, showBarcode: false, fontSize: '14px' },
    isDefault: false,
  },
  {
    name: 'Barcode Only',
    widthMm: 50,
    heightMm: 30,
    layout: { fields: ['sku'] as const, showBarcode: true, fontSize: '10px' },
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

  for (const preset of PRESET_TEMPLATES) {
    db.insert(labelTemplates)
      .values({
        id: uuid(),
        name: preset.name,
        widthMm: preset.widthMm,
        heightMm: preset.heightMm,
        layoutJson: JSON.stringify(preset.layout),
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
  return db
    .select()
    .from(labelTemplates)
    .where(eq(labelTemplates.isDeleted, false))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      layout: JSON.parse(row.layoutJson) as LabelLayout,
      isDefault: row.isDefault,
    }));
}
