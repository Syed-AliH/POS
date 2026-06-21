import { eq } from 'drizzle-orm';
import { labelTemplates, receiptTemplates } from '@mama-babi/db-schema';
import type { LabelTemplateSummary, ReceiptTemplate } from '@shared/types';
import { getDb } from '../db';
import { getSetting } from '../services/settings';
import { v4 as uuid } from 'uuid';

export function applyReceiptTemplatesToLocal(templates: ReceiptTemplate[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';

  db.delete(receiptTemplates).run();

  for (const tpl of templates) {
    const headerJson = JSON.stringify({
      ...tpl.header,
      widthMm: tpl.widthMm,
      sections: tpl.sections,
    });
    const footerJson = JSON.stringify(tpl.footer);
    db.insert(receiptTemplates)
      .values({
        id: tpl.id || uuid(),
        name: tpl.name,
        headerJson,
        footerJson,
        isDefault: tpl.isDefault,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function applyLabelTemplatesToLocal(templates: LabelTemplateSummary[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';

  db.delete(labelTemplates).run();

  for (const tpl of templates) {
    db.insert(labelTemplates)
      .values({
        id: tpl.id || uuid(),
        name: tpl.name,
        widthMm: tpl.widthMm,
        heightMm: tpl.heightMm,
        layoutJson: JSON.stringify(tpl.layout),
        rollConfigJson: JSON.stringify(tpl.rollConfig),
        isDefault: tpl.isDefault,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function upsertReceiptTemplateLocal(tpl: ReceiptTemplate): void {
  const db = getDb();
  const now = new Date().toISOString();
  const headerJson = JSON.stringify({
    ...tpl.header,
    widthMm: tpl.widthMm,
    sections: tpl.sections,
  });
  const footerJson = JSON.stringify(tpl.footer);
  const existing = db.select().from(receiptTemplates).where(eq(receiptTemplates.id, tpl.id)).get();
  if (existing) {
    db.update(receiptTemplates)
      .set({ name: tpl.name, headerJson, footerJson, isDefault: tpl.isDefault, updatedAt: now })
      .where(eq(receiptTemplates.id, tpl.id))
      .run();
  } else {
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    db.insert(receiptTemplates)
      .values({
        id: tpl.id,
        name: tpl.name,
        headerJson,
        footerJson,
        isDefault: tpl.isDefault,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function upsertLabelTemplateLocal(tpl: LabelTemplateSummary): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.select().from(labelTemplates).where(eq(labelTemplates.id, tpl.id)).get();
  if (existing) {
    db.update(labelTemplates)
      .set({
        name: tpl.name,
        widthMm: tpl.widthMm,
        heightMm: tpl.heightMm,
        layoutJson: JSON.stringify(tpl.layout),
        rollConfigJson: JSON.stringify(tpl.rollConfig),
        isDefault: tpl.isDefault,
        updatedAt: now,
      })
      .where(eq(labelTemplates.id, tpl.id))
      .run();
  } else {
    const deviceId = getSetting('device_id') ?? 'local-device';
    const branchId = getSetting('branch_id') ?? 'main';
    db.insert(labelTemplates)
      .values({
        id: tpl.id,
        name: tpl.name,
        widthMm: tpl.widthMm,
        heightMm: tpl.heightMm,
        layoutJson: JSON.stringify(tpl.layout),
        rollConfigJson: JSON.stringify(tpl.rollConfig),
        isDefault: tpl.isDefault,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function removeLabelTemplateLocal(id: string): void {
  const db = getDb();
  db.delete(labelTemplates).where(eq(labelTemplates.id, id)).run();
}
