import { eq } from 'drizzle-orm';
import { labelTemplates, receiptTemplates } from '@mama-babi/db-schema';
import { normalizeLabelRollConfig } from '@mama-babi/printer';
import type { ApiResult, LabelTemplateSummary, ReceiptTemplate } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import {
  createLabelTemplate,
  deleteLabelTemplate,
  getLabelTemplateById,
  listLabelTemplates,
  setDefaultLabelTemplate,
} from '../services/labelTemplates';
import { normalizeReceiptTemplateRow, receiptTemplateToStorage } from '../services/receiptTemplates';

export function handleReceiptTemplates(): ApiResult<ReceiptTemplate[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(receiptTemplates).where(eq(receiptTemplates.isDeleted, false)).all();
    return {
      success: true,
      data: rows.map(normalizeReceiptTemplateRow),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleReceiptTemplateUpdate(
  id: string,
  input: Partial<ReceiptTemplate>,
): ApiResult<ReceiptTemplate> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).get();
    if (!existing) return { success: false, error: 'Template not found' };

    const current = normalizeReceiptTemplateRow(existing);
    const merged: ReceiptTemplate = {
      ...current,
      ...input,
      name: input.name ?? current.name,
      widthMm: input.widthMm ?? current.widthMm,
      header: { ...current.header, ...input.header },
      footer: { ...current.footer, ...input.footer },
      sections: { ...current.sections, ...input.sections },
    };

    const now = new Date().toISOString();
    const { headerJson, footerJson } = receiptTemplateToStorage(merged);

    db.update(receiptTemplates)
      .set({
        name: merged.name,
        headerJson,
        footerJson,
        updatedAt: now,
      })
      .where(eq(receiptTemplates.id, id))
      .run();

    logAudit('templates', 'update_receipt', id);

    const saved = db.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).get();
    if (!saved) return { success: false, error: 'Failed to read saved template' };

    return { success: true, data: normalizeReceiptTemplateRow(saved) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleLabelTemplateUpdate(
  id: string,
  input: {
    name?: string;
    widthMm?: number;
    heightMm?: number;
    layout?: LabelTemplateSummary['layout'];
    rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
  },
): ApiResult<LabelTemplateSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).get();
    if (!existing) return { success: false, error: 'Template not found' };

    const currentLayout = JSON.parse(existing.layoutJson) as LabelTemplateSummary['layout'];
    const currentRoll = existing.rollConfigJson
      ? normalizeLabelRollConfig(JSON.parse(existing.rollConfigJson))
      : normalizeLabelRollConfig();
    const layout = input.layout ?? currentLayout;
    const rollConfig = input.rollConfig
      ? normalizeLabelRollConfig({ ...currentRoll, ...input.rollConfig })
      : currentRoll;
    const now = new Date().toISOString();

    db.update(labelTemplates)
      .set({
        name: input.name ?? existing.name,
        widthMm: input.widthMm ?? existing.widthMm,
        heightMm: input.heightMm ?? existing.heightMm,
        layoutJson: JSON.stringify(layout),
        rollConfigJson: JSON.stringify(rollConfig),
        updatedAt: now,
      })
      .where(eq(labelTemplates.id, id))
      .run();

    logAudit('templates', 'update_label', id);

    const updated = getLabelTemplateById(id);
    if (!updated) return { success: false, error: 'Failed to load saved template' };

    return { success: true, data: updated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleLabelTemplateCreate(input: {
  name: string;
  widthMm: number;
  heightMm: number;
  layout?: LabelTemplateSummary['layout'];
  rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
  isDefault?: boolean;
}): ApiResult<LabelTemplateSummary> {
  try {
    requireRole('super_admin', 'manager');
    const created = createLabelTemplate(input);
    logAudit('templates', 'create_label', created.id);
    return { success: true, data: created };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
}

export function handleLabelTemplateDelete(id: string): ApiResult<void> {
  try {
    requireRole('super_admin', 'manager');
    deleteLabelTemplate(id);
    logAudit('templates', 'delete_label', id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export function handleLabelTemplateSetDefault(id: string): ApiResult<LabelTemplateSummary> {
  try {
    requireRole('super_admin', 'manager');
    const updated = setDefaultLabelTemplate(id);
    logAudit('templates', 'default_label', id);
    return { success: true, data: updated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Set default failed' };
  }
}
