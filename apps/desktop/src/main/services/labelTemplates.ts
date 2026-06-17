import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { labelTemplates } from '@mama-babi/db-schema';
import {
  DEFAULT_LABEL_ROLL_CONFIG,
  MAMABABI_38_1x25_4_2UP_ROLL,
  defaultLabelElements,
  normalizeLabelRollConfig,
  type LabelLayout,
  type LabelRollConfig,
} from '@mama-babi/printer';
import type { LabelTemplateSummary } from '@shared/types';
import { getDb } from '../db';
import { getSetting, getAllSettings } from './settings';

const TWO_UP_38x28: LabelRollConfig = {
  ...DEFAULT_LABEL_ROLL_CONFIG,
  columns: 2,
  horizontalGapMm: 2,
  verticalGapMm: 2,
  marginLeftMm: 0,
  marginRightMm: 0,
};

const ONE_UP: LabelRollConfig = {
  ...DEFAULT_LABEL_ROLL_CONFIG,
  columns: 1,
  horizontalGapMm: 0,
  verticalGapMm: 0,
};

const PRESET_TEMPLATES: Array<{
  name: string;
  widthMm: number;
  heightMm: number;
  layout: LabelLayout;
  rollConfig: LabelRollConfig;
  isDefault: boolean;
}> = [
  {
    name: 'MamaBabi 38.1×25.4 2UP',
    widthMm: 38.1,
    heightMm: 25.4,
    layout: {
      elements: defaultLabelElements(),
      showBarcodeGraphic: true,
    },
    rollConfig: MAMABABI_38_1x25_4_2UP_ROLL,
    isDefault: true,
  },
  {
    name: '38×28 2UP',
    widthMm: 38,
    heightMm: 28,
    layout: {
      elements: defaultLabelElements(),
      showBarcodeGraphic: true,
    },
    rollConfig: TWO_UP_38x28,
    isDefault: false,
  },
  {
    name: '50×25 2UP',
    widthMm: 50,
    heightMm: 25,
    layout: {
      elements: defaultLabelElements().map((e) => ({ ...e, fontSize: Math.max(7, e.fontSize - 1) })),
      showBarcodeGraphic: true,
    },
    rollConfig: { ...ONE_UP, columns: 2, horizontalGapMm: 2 },
    isDefault: false,
  },
  {
    name: '50×50 1UP',
    widthMm: 50,
    heightMm: 50,
    layout: {
      elements: defaultLabelElements().map((e) => ({ ...e, fontSize: e.fontSize + 1 })),
      showBarcodeGraphic: true,
    },
    rollConfig: ONE_UP,
    isDefault: false,
  },
  {
    name: 'Shelf Label',
    widthMm: 50,
    heightMm: 25,
    layout: {
      elements: [
        { id: 'name', type: 'name', visible: true, x: 5, y: 15, fontSize: 10, align: 'left', fontWeight: 'bold' },
        { id: 'price', type: 'price', visible: true, x: 5, y: 38, fontSize: 14, align: 'left', fontWeight: 'bold' },
        { id: 'sku', type: 'sku', visible: true, x: 5, y: 58, fontSize: 7, align: 'left' },
      ],
      showBarcodeGraphic: false,
    },
    rollConfig: ONE_UP,
    isDefault: false,
  },
  {
    name: 'Shipping Label',
    widthMm: 60,
    heightMm: 40,
    layout: {
      elements: defaultLabelElements().map((e) => ({ ...e, fontSize: e.fontSize + 1 })),
      showBarcodeGraphic: true,
    },
    rollConfig: ONE_UP,
    isDefault: false,
  },
];

function parseRollConfigJson(raw: string | null | undefined): LabelRollConfig {
  if (!raw) return { ...DEFAULT_LABEL_ROLL_CONFIG };
  try {
    return normalizeLabelRollConfig(JSON.parse(raw) as Partial<LabelRollConfig>);
  } catch {
    return { ...DEFAULT_LABEL_ROLL_CONFIG };
  }
}

function rowToSummary(row: typeof labelTemplates.$inferSelect, storeName: string): LabelTemplateSummary {
  const layout = JSON.parse(row.layoutJson) as LabelLayout;
  if (!layout.storeName) layout.storeName = storeName;
  return {
    id: row.id,
    name: row.name,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    layout,
    rollConfig: parseRollConfigJson(row.rollConfigJson),
    isDefault: row.isDefault,
  };
}

export function upgradeLabelTemplatesRollConfig(): void {
  const db = getDb();
  const rows = db.select().from(labelTemplates).where(eq(labelTemplates.isDeleted, false)).all();
  const now = new Date().toISOString();

  const hasMamaBabi = rows.some(
    (r) => r.name.includes('MamaBabi') || (r.widthMm === 38.1 && r.heightMm === 25.4),
  );
  if (!hasMamaBabi) {
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const storeName = getSetting('store_name') ?? 'Store';
    const preset = PRESET_TEMPLATES[0];
    const layout = { ...preset.layout, storeName };
    db.insert(labelTemplates)
      .values({
        id: uuid(),
        name: preset.name,
        widthMm: preset.widthMm,
        heightMm: preset.heightMm,
        layoutJson: JSON.stringify(layout),
        rollConfigJson: JSON.stringify(preset.rollConfig),
        isDefault: false,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    console.log('[migrate] Added MamaBabi 38.1×25.4 2UP label template');
  }

  const has2Up = rows.some((r) => r.name.includes('38×28 2UP') || r.name.includes('38x28 2UP'));
  if (!has2Up) {
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    const storeName = getSetting('store_name') ?? 'Store';
    const preset = PRESET_TEMPLATES[0];
    const layout = { ...preset.layout, storeName };
    db.update(labelTemplates).set({ isDefault: false, updatedAt: now }).run();
    db.insert(labelTemplates)
      .values({
        id: uuid(),
        name: preset.name,
        widthMm: preset.widthMm,
        heightMm: preset.heightMm,
        layoutJson: JSON.stringify(layout),
        rollConfigJson: JSON.stringify(preset.rollConfig),
        isDefault: true,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    console.log('[migrate] Added default 38×28 2UP label template');
    return;
  }

  for (const row of rows) {
    const is38x28TwoUp =
      row.widthMm === 38 &&
      row.heightMm === 28 &&
      (row.name.includes('38×28 2UP') || row.name.includes('38x28 2UP'));

    if (is38x28TwoUp) {
      const current = row.rollConfigJson
        ? (JSON.parse(row.rollConfigJson) as Partial<LabelRollConfig>)
        : {};
      const fixed = normalizeLabelRollConfig({ ...current, ...TWO_UP_38x28 });
      db.update(labelTemplates)
        .set({ rollConfigJson: JSON.stringify(fixed), updatedAt: now })
        .where(eq(labelTemplates.id, row.id))
        .run();
      continue;
    }

    if (row.rollConfigJson) continue;
    const inferred = { ...ONE_UP, columns: 1 };
    db.update(labelTemplates)
      .set({
        rollConfigJson: JSON.stringify(inferred),
        updatedAt: now,
      })
      .where(eq(labelTemplates.id, row.id))
      .run();
  }
}

export function seedLabelTemplatesIfEmpty(): void {
  const db = getDb();
  const existing = db.select().from(labelTemplates).limit(1).all();
  if (existing.length > 0) {
    upgradeLabelTemplatesRollConfig();
    return;
  }

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
        rollConfigJson: JSON.stringify(preset.rollConfig),
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
    .map((row) => rowToSummary(row, storeName));
}

export function getLabelTemplateById(id: string): LabelTemplateSummary | null {
  const db = getDb();
  const settings = getAllSettings();
  const storeName = settings.store_name ?? 'Store';
  const row = db
    .select()
    .from(labelTemplates)
    .where(eq(labelTemplates.id, id))
    .get();
  if (!row || row.isDeleted) return null;
  return rowToSummary(row, storeName);
}

export function createLabelTemplate(input: {
  name: string;
  widthMm: number;
  heightMm: number;
  layout?: LabelLayout;
  rollConfig?: Partial<LabelRollConfig>;
  isDefault?: boolean;
}): LabelTemplateSummary {
  const db = getDb();
  const settings = getAllSettings();
  const storeName = settings.store_name ?? 'Store';
  const now = new Date().toISOString();
  const id = uuid();
  const layout = input.layout ?? { elements: defaultLabelElements(), showBarcodeGraphic: true, storeName };
  const rollConfig = normalizeLabelRollConfig(input.rollConfig);

  if (input.isDefault) {
    db.update(labelTemplates).set({ isDefault: false, updatedAt: now }).run();
  }

  db.insert(labelTemplates)
    .values({
      id,
      name: input.name,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      layoutJson: JSON.stringify({ ...layout, storeName: layout.storeName ?? storeName }),
      rollConfigJson: JSON.stringify(rollConfig),
      isDefault: input.isDefault ?? false,
      deviceId: getSetting('device_id') ?? 'local-device',
      branchId: getSetting('branch_id') ?? 'main',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).get();
  if (!row) throw new Error('Failed to create template');
  return rowToSummary(row, storeName);
}

export function deleteLabelTemplate(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(labelTemplates)
    .set({ isDeleted: true, updatedAt: now })
    .where(eq(labelTemplates.id, id))
    .run();
}

export function setDefaultLabelTemplate(id: string): LabelTemplateSummary {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(labelTemplates).set({ isDefault: false, updatedAt: now }).run();
  db.update(labelTemplates).set({ isDefault: true, updatedAt: now }).where(eq(labelTemplates.id, id)).run();
  const settings = getAllSettings();
  const row = db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).get();
  if (!row) throw new Error('Template not found');
  return rowToSummary(row, settings.store_name ?? 'Store');
}
