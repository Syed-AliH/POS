import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import {
  brands,
  categories,
  expenseCategories,
  loyaltyRules,
  receiptTemplates,
  settings,
  users,
  vendors,
} from '@mama-babi/db-schema';
import { getDb } from '../db';
import { DEMO_CATEGORIES, seedDemoProducts } from './demoProducts';
import { deriveSkuPrefix } from './skuGenerator';

export async function seedIfEmpty(): Promise<void> {
  const db = getDb();
  const existing = db.select().from(users).limit(1).all();
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const deviceId = 'local-device';
  const branchId = 'main';

  const adminPassword = await bcrypt.hash('admin123', 12);

  const categoryData = DEMO_CATEGORIES.map((c) => ({
    id: uuid(),
    name: c.name,
    color: c.color,
    skuPrefix: deriveSkuPrefix(c.name),
  }));

  const brandId = uuid();
  const vendorId = uuid();

  const defaultSettings = [
    { key: 'store_name', value: 'Mama Babi' },
    { key: 'store_address', value: 'Main Street, City' },
    { key: 'store_phone', value: '+92-300-0000000' },
    { key: 'currency', value: 'PKR' },
    { key: 'tax_inclusive', value: 'true' },
    { key: 'default_tax_rate', value: '17' },
    { key: 'sale_counter', value: '0' },
    { key: 'grn_counter', value: '0' },
    { key: 'return_counter', value: '0' },
    { key: 'secondary_currency', value: 'USD' },
    { key: 'exchange_rate', value: '0.0036' },
    { key: 'return_policy_days', value: '7' },
    { key: 'auto_print_receipt', value: 'true' },
    { key: 'device_id', value: deviceId },
    { key: 'branch_id', value: branchId },
    { key: 'default_retail_markup', value: '100' },
  ];

  db.transaction((tx) => {
    for (const s of defaultSettings) {
      tx.insert(settings).values({
        id: uuid(),
        key: s.key,
        value: s.value,
        scope: 'global',
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    tx.insert(users).values({
      id: uuid(),
      name: 'Admin',
      username: 'admin',
      passwordHash: adminPassword,
      pinHash: '',
      role: 'super_admin',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();

    for (const cat of categoryData) {
      tx.insert(categories).values({ ...cat, deviceId, branchId, createdAt: now, updatedAt: now }).run();
    }

    tx.insert(brands).values({ id: brandId, name: 'Mama Babi House Brand', country: 'PK', deviceId, branchId, createdAt: now, updatedAt: now }).run();
    tx.insert(vendors).values({ id: vendorId, name: 'Default Supplier', contact: 'Supplier Contact', email: 'supplier@example.com', paymentTerms: 'Net 30', deviceId, branchId, createdAt: now, updatedAt: now }).run();

    tx.insert(loyaltyRules).values({ id: uuid(), spendThreshold: 1000, pointsAwarded: 10, redemptionRate: 1, isActive: true, deviceId, branchId, createdAt: now, updatedAt: now }).run();

    for (const c of [
      { name: 'Utilities', description: 'Electricity, water, etc.' },
      { name: 'Supplies', description: 'Store supplies' },
      { name: 'Transport', description: 'Delivery and transport' },
      { name: 'Miscellaneous', description: 'Other expenses' },
    ]) {
      tx.insert(expenseCategories).values({ id: uuid(), ...c, deviceId, branchId, createdAt: now, updatedAt: now }).run();
    }

    tx.insert(receiptTemplates).values({
      id: uuid(),
      name: 'Default Receipt',
      headerJson: JSON.stringify({ storeName: 'Mama Babi', showLogo: true, showAddress: true }),
      footerJson: JSON.stringify({ message: 'Thank you for shopping with Mama Babi!', returnPolicy: 'Returns within 7 days with receipt.' }),
      isDefault: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  seedDemoProducts({ skipExisting: true });
  console.log('[seed] Database seeded. Login: admin / admin123');
}
