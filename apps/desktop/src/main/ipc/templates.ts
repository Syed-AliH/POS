import { eq } from 'drizzle-orm';
import { labelTemplates, receiptTemplates } from '@mama-babi/db-schema';
import type { ApiResult, LabelTemplateSummary, ReceiptTemplate } from '@shared/types';
import { getDb } from '../db';
import { requireRole } from '../session';
import { logAudit } from '../services/audit';
import { listLabelTemplates } from '../services/labelTemplates';

export function handleReceiptTemplates(): ApiResult<ReceiptTemplate[]> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const rows = db.select().from(receiptTemplates).where(eq(receiptTemplates.isDeleted, false)).all();
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        header: JSON.parse(r.headerJson),
        footer: JSON.parse(r.footerJson),
        isDefault: r.isDefault,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'List failed' };
  }
}

export function handleReceiptTemplateUpdate(
  id: string,
  input: { name?: string; header?: ReceiptTemplate['header']; footer?: ReceiptTemplate['footer'] },
): ApiResult<ReceiptTemplate> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).get();
    if (!existing) return { success: false, error: 'Template not found' };

    const now = new Date().toISOString();
    const header = input.header ?? JSON.parse(existing.headerJson);
    const footer = input.footer ?? JSON.parse(existing.footerJson);

    db.update(receiptTemplates)
      .set({
        name: input.name ?? existing.name,
        headerJson: JSON.stringify(header),
        footerJson: JSON.stringify(footer),
        updatedAt: now,
      })
      .where(eq(receiptTemplates.id, id))
      .run();

    logAudit('templates', 'update_receipt', id);
    return {
      success: true,
      data: { id, name: input.name ?? existing.name, header, footer, isDefault: existing.isDefault },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export function handleLabelTemplateUpdate(
  id: string,
  input: { name?: string; layout?: LabelTemplateSummary['layout'] },
): ApiResult<LabelTemplateSummary> {
  try {
    requireRole('super_admin', 'manager');
    const db = getDb();
    const existing = db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).get();
    if (!existing) return { success: false, error: 'Template not found' };

    const now = new Date().toISOString();
    const layout = input.layout ?? (JSON.parse(existing.layoutJson) as LabelTemplateSummary['layout']);

    db.update(labelTemplates)
      .set({
        name: input.name ?? existing.name,
        layoutJson: JSON.stringify(layout),
        updatedAt: now,
      })
      .where(eq(labelTemplates.id, id))
      .run();

    logAudit('templates', 'update_label', id);
    const updated = listLabelTemplates().find((t) => t.id === id)!;
    return { success: true, data: updated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}
