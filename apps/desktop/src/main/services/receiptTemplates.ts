import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { receiptTemplates } from '@mama-babi/db-schema';
import {
  DEFAULT_RECEIPT_SECTIONS,
  parseReceiptTemplateConfig,
  type ReceiptTemplateConfig,
  type ReceiptTemplateFooter,
  type ReceiptTemplateHeader,
  type ReceiptTemplateSections,
} from '@mama-babi/printer';
import type { ReceiptTemplate } from '@shared/types';
import { getDb } from '../db';
import { getAllSettings, getSetting } from './settings';

type StoredHeader = ReceiptTemplateHeader & {
  widthMm?: 58 | 80;
  sections?: Partial<ReceiptTemplateSections>;
};

export function normalizeReceiptTemplateRow(row: {
  id: string;
  name: string;
  headerJson: string;
  footerJson: string;
  isDefault: boolean;
}): ReceiptTemplate {
  const headerRaw = JSON.parse(row.headerJson) as StoredHeader;
  const footerRaw = JSON.parse(row.footerJson) as ReceiptTemplateFooter;
  const { widthMm, sections, ...storedHeader } = headerRaw;
  const settings = getAllSettings();

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
      ...footerRaw,
      thankYouMessage: footerRaw.thankYouMessage ?? footerRaw.message ?? 'Thank you for your purchase!',
      returnPolicy: footerRaw.returnPolicy ?? '',
      taxInfo: footerRaw.taxInfo ?? '',
      qrCodeContent: footerRaw.qrCodeContent ?? '',
    },
    isDefault: row.isDefault,
  };
}

export function getDefaultReceiptTemplate(): ReceiptTemplate | null {
  const db = getDb();
  const row = db
    .select()
    .from(receiptTemplates)
    .where(eq(receiptTemplates.isDeleted, false))
    .all()
    .find((r) => r.isDefault) ?? db.select().from(receiptTemplates).where(eq(receiptTemplates.isDeleted, false)).get();

  if (!row) return null;
  return normalizeReceiptTemplateRow(row);
}

export function receiptTemplateToConfig(tpl: ReceiptTemplate): ReceiptTemplateConfig {
  return {
    widthMm: tpl.widthMm,
    sections: tpl.sections,
    header: tpl.header,
    footer: tpl.footer,
  };
}

export function receiptTemplateToStorage(tpl: Pick<ReceiptTemplate, 'widthMm' | 'sections' | 'header' | 'footer'>) {
  const headerJson: StoredHeader = {
    ...tpl.header,
    widthMm: tpl.widthMm,
    sections: tpl.sections,
  };
  const footerJson: ReceiptTemplateFooter = { ...tpl.footer };
  return { headerJson: JSON.stringify(headerJson), footerJson: JSON.stringify(footerJson) };
}

export function seedReceiptTemplatesIfEmpty(): void {
  const db = getDb();
  const existing = db
    .select()
    .from(receiptTemplates)
    .where(eq(receiptTemplates.isDeleted, false))
    .limit(1)
    .all();
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const deviceId = getSetting('device_id') ?? 'local-device';
  const branchId = getSetting('branch_id') ?? 'main';
  const settings = getAllSettings();

  db.insert(receiptTemplates)
    .values({
      id: uuid(),
      name: 'Default Receipt',
      headerJson: JSON.stringify({
        widthMm: 80,
        sections: DEFAULT_RECEIPT_SECTIONS,
        storeName: settings.store_name ?? 'Store',
        showLogo: true,
        showAddress: true,
      }),
      footerJson: JSON.stringify({
        message: 'Thank you for shopping!',
        thankYouMessage: 'Thank you for shopping!',
        returnPolicy: 'Returns within 7 days with receipt.',
      }),
      isDefault: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  console.log('[seed] Receipt templates seeded');
}
