import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { labelTemplates, receiptTemplates } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import type { ApiResult } from '../types';
import { getAllSettings } from './settings.service';

const DEFAULT_RECEIPT_SECTIONS = {
  showLogo: true,
  showStoreName: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showHeaderText: true,
  showSaleNumber: true,
  showDate: true,
  showCashier: true,
  showDividerAfterHeader: true,
  showItems: true,
  showSubtotal: true,
  showDiscount: true,
  showTax: true,
  showTotal: true,
  showPayment: true,
  showChange: true,
  showDividerBeforeFooter: true,
  showThankYou: true,
  showReturnPolicy: true,
  showTaxInfo: true,
  showQrCode: true,
} as const;

type ReceiptSections = typeof DEFAULT_RECEIPT_SECTIONS;
type ReceiptHeader = Record<string, unknown>;
type ReceiptFooter = Record<string, unknown> & {
  message?: string;
  thankYouMessage?: string;
  returnPolicy?: string;
  taxInfo?: string;
  qrCodeContent?: string;
};

type LabelRollConfig = {
  columns: number;
  horizontalGapMm: number;
  verticalGapMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
};

type LabelLayout = {
  elements: unknown[];
  showBarcodeGraphic?: boolean;
  storeName?: string;
};

export type ReceiptTemplate = {
  id: string;
  name: string;
  widthMm: 58 | 80;
  sections: ReceiptSections;
  header: ReceiptHeader;
  footer: ReceiptFooter;
  isDefault: boolean;
};

export type LabelTemplateSummary = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  layout: LabelLayout;
  rollConfig: LabelRollConfig;
  isDefault: boolean;
};

function normalizeLabelRollConfig(input: Partial<LabelRollConfig> = {}): LabelRollConfig {
  return {
    columns: input.columns ?? 1,
    horizontalGapMm: input.horizontalGapMm ?? 2,
    verticalGapMm: input.verticalGapMm ?? 2,
    marginLeftMm: input.marginLeftMm ?? 0,
    marginRightMm: input.marginRightMm ?? 0,
    marginTopMm: input.marginTopMm ?? 0,
    marginBottomMm: input.marginBottomMm ?? 0,
  };
}

type StoredHeader = ReceiptHeader & {
  widthMm?: 58 | 80;
  sections?: Partial<ReceiptSections>;
};

function normalizeReceiptRow(
  row: typeof receiptTemplates.$inferSelect,
  settings: Record<string, string>,
) {
  const headerRaw = JSON.parse(row.headerJson) as StoredHeader;
  const footerRaw = JSON.parse(row.footerJson) as ReceiptFooter | undefined;
  const { widthMm, sections, ...storedHeader } = headerRaw;

  return {
    id: row.id,
    name: row.name,
    widthMm: widthMm ?? 80,
    sections: { ...DEFAULT_RECEIPT_SECTIONS, ...sections },
    header: {
      ...storedHeader,
      storeName: storedHeader.storeName ?? settings.store_name ?? 'Store',
      address: storedHeader.address ?? settings.store_address ?? '',
      phone: storedHeader.phone ?? settings.store_phone ?? '',
      email: storedHeader.email ?? settings.store_email ?? '',
      headerText: storedHeader.headerText ?? '',
    },
    footer: {
      ...(footerRaw ?? {}),
      thankYouMessage: footerRaw?.thankYouMessage ?? footerRaw?.message ?? 'Thank you for your purchase!',
      returnPolicy: footerRaw?.returnPolicy ?? '',
      taxInfo: footerRaw?.taxInfo ?? '',
      qrCodeContent: footerRaw?.qrCodeContent ?? '',
    },
    isDefault: row.isDefault,
  };
}

function rowToLabelSummary(
  row: typeof labelTemplates.$inferSelect,
  storeName: string,
) {
  const layout = JSON.parse(row.layoutJson) as LabelTemplateSummary['layout'];
  if (!layout.storeName) layout.storeName = storeName;
  const rollConfig = row.rollConfigJson
    ? normalizeLabelRollConfig(JSON.parse(row.rollConfigJson))
    : normalizeLabelRollConfig();
  return {
    id: row.id,
    name: row.name,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    layout,
    rollConfig,
    isDefault: row.isDefault,
  };
}

function receiptToStorage(tpl: Pick<ReceiptTemplate, 'widthMm' | 'sections' | 'header' | 'footer'>) {
  const headerJson: StoredHeader = { ...tpl.header, widthMm: tpl.widthMm, sections: tpl.sections };
  return { headerJson: JSON.stringify(headerJson), footerJson: JSON.stringify(tpl.footer) };
}

export async function listReceiptTemplates(db: PostgresClient): Promise<ApiResult<ReceiptTemplate[]>> {
  const settings = await getAllSettings(db);
  const rows = await db.select().from(receiptTemplates).where(eq(receiptTemplates.isDeleted, false));
  return { success: true, data: rows.map((r) => normalizeReceiptRow(r, settings)) };
}

export async function updateReceiptTemplate(
  db: PostgresClient,
  id: string,
  input: Partial<ReceiptTemplate>,
): Promise<ApiResult<ReceiptTemplate>> {
  const settings = await getAllSettings(db);
  const [existing] = await db.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).limit(1);
  if (!existing) return { success: false, error: 'Template not found' };

  const current = normalizeReceiptRow(existing, settings);
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
  const { headerJson, footerJson } = receiptToStorage(merged);

  await db
    .update(receiptTemplates)
    .set({ name: merged.name, headerJson, footerJson, updatedAt: now })
    .where(eq(receiptTemplates.id, id));

  const [saved] = await db.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).limit(1);
  if (!saved) return { success: false, error: 'Failed to read saved template' };
  return { success: true, data: normalizeReceiptRow(saved, settings) };
}

export async function listLabelTemplates(db: PostgresClient): Promise<ApiResult<LabelTemplateSummary[]>> {
  const settings = await getAllSettings(db);
  const storeName = settings.store_name ?? 'Store';
  const rows = await db.select().from(labelTemplates).where(eq(labelTemplates.isDeleted, false));
  return { success: true, data: rows.map((r) => rowToLabelSummary(r, storeName)) };
}

export async function getLabelTemplate(db: PostgresClient, id: string): Promise<ApiResult<LabelTemplateSummary>> {
  const settings = await getAllSettings(db);
  const [row] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
  if (!row) return { success: false, error: 'Template not found' };
  return { success: true, data: rowToLabelSummary(row, settings.store_name ?? 'Store') };
}

export async function updateLabelTemplate(
  db: PostgresClient,
  id: string,
  input: {
    name?: string;
    widthMm?: number;
    heightMm?: number;
    layout?: LabelTemplateSummary['layout'];
    rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
  },
): Promise<ApiResult<LabelTemplateSummary>> {
  const settings = await getAllSettings(db);
  const [existing] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
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

  await db
    .update(labelTemplates)
    .set({
      name: input.name ?? existing.name,
      widthMm: input.widthMm ?? existing.widthMm,
      heightMm: input.heightMm ?? existing.heightMm,
      layoutJson: JSON.stringify(layout),
      rollConfigJson: JSON.stringify(rollConfig),
      updatedAt: now,
    })
    .where(eq(labelTemplates.id, id));

  const [updated] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
  if (!updated) return { success: false, error: 'Failed to load saved template' };
  return { success: true, data: rowToLabelSummary(updated, settings.store_name ?? 'Store') };
}

export async function createLabelTemplate(
  db: PostgresClient,
  input: {
    name: string;
    widthMm: number;
    heightMm: number;
    layout?: LabelTemplateSummary['layout'];
    rollConfig?: Partial<LabelTemplateSummary['rollConfig']>;
    isDefault?: boolean;
  },
): Promise<ApiResult<LabelTemplateSummary>> {
  const settings = await getAllSettings(db);
  const now = new Date().toISOString();
  const deviceId = settings.device_id ?? 'cloud';
  const branchId = settings.branch_id ?? 'main';
  const id = uuid();
  const rollConfig = normalizeLabelRollConfig(input.rollConfig ?? {});
  const layout = input.layout ?? { elements: [], showBarcodeGraphic: true, storeName: settings.store_name ?? 'Store' };

  if (input.isDefault) {
    await db.update(labelTemplates).set({ isDefault: false, updatedAt: now });
  }

  await db.insert(labelTemplates).values({
    id,
    name: input.name,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    layoutJson: JSON.stringify(layout),
    rollConfigJson: JSON.stringify(rollConfig),
    isDefault: input.isDefault ?? false,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
  if (!created) return { success: false, error: 'Failed to create template' };
  return { success: true, data: rowToLabelSummary(created, settings.store_name ?? 'Store') };
}

export async function deleteLabelTemplate(db: PostgresClient, id: string): Promise<ApiResult<void>> {
  const now = new Date().toISOString();
  await db
    .update(labelTemplates)
    .set({ isDeleted: true, updatedAt: now })
    .where(eq(labelTemplates.id, id));
  return { success: true, data: undefined };
}

export async function setDefaultLabelTemplate(
  db: PostgresClient,
  id: string,
): Promise<ApiResult<LabelTemplateSummary>> {
  const settings = await getAllSettings(db);
  const now = new Date().toISOString();
  await db.update(labelTemplates).set({ isDefault: false, updatedAt: now });
  await db.update(labelTemplates).set({ isDefault: true, updatedAt: now }).where(eq(labelTemplates.id, id));
  const [updated] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
  if (!updated) return { success: false, error: 'Template not found' };
  return { success: true, data: rowToLabelSummary(updated, settings.store_name ?? 'Store') };
}
