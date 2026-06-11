import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { createDatabase } from './client';
import {
  brands,
  categories,
  expenseCategories,
  loyaltyRules,
  products,
  receiptTemplates,
  settings,
  users,
  vendors,
} from './schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, '../../../data/mama-babi.db');

if (!fs.existsSync(dbPath)) {
  console.error('Database not found. Run pnpm db:migrate first.');
  process.exit(1);
}

const db = createDatabase(dbPath);
const now = new Date().toISOString();
const deviceId = 'seed-device';
const branchId = 'main';

async function seed() {
  const adminPin = await bcrypt.hash('1234', 12);
  const managerPin = await bcrypt.hash('5678', 12);
  const cashierPin = await bcrypt.hash('0000', 12);

  const adminId = uuid();
  const managerId = uuid();
  const cashierId = uuid();

  const categoryData = [
    { id: uuid(), name: 'Clothing', color: '#3B82F6' },
    { id: uuid(), name: 'Diapers', color: '#10B981' },
    { id: uuid(), name: 'Baby Food', color: '#F59E0B' },
    { id: uuid(), name: 'Feeding', color: '#8B5CF6' },
    { id: uuid(), name: 'Toys', color: '#EC4899' },
    { id: uuid(), name: 'Care', color: '#06B6D4' },
  ];

  const brandId = uuid();
  const vendorId = uuid();

  const defaultSettings = [
    { key: 'store_name', value: 'Mama Babi' },
    { key: 'store_address', value: 'Main Street, City' },
    { key: 'store_phone', value: '+92-300-0000000' },
    { key: 'store_trn', value: '' },
    { key: 'currency', value: 'PKR' },
    { key: 'tax_inclusive', value: 'true' },
    { key: 'default_tax_rate', value: '17' },
    { key: 'sale_counter', value: '0' },
    { key: 'return_policy_days', value: '7' },
    { key: 'auto_print_receipt', value: 'true' },
    { key: 'device_id', value: deviceId },
    { key: 'branch_id', value: branchId },
  ];

  db.transaction((tx) => {
    for (const s of defaultSettings) {
      tx.insert(settings)
        .values({
          id: uuid(),
          key: s.key,
          value: s.value,
          scope: 'global',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    tx.insert(users)
      .values([
        {
          id: adminId,
          name: 'Admin',
          pinHash: adminPin,
          role: 'super_admin',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: managerId,
          name: 'Manager',
          pinHash: managerPin,
          role: 'manager',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: cashierId,
          name: 'Cashier',
          pinHash: cashierPin,
          role: 'cashier',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .onConflictDoNothing()
      .run();

    for (const cat of categoryData) {
      tx.insert(categories)
        .values({
          ...cat,
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    tx.insert(brands)
      .values({
        id: brandId,
        name: 'Mama Babi House Brand',
        country: 'PK',
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(vendors)
      .values({
        id: vendorId,
        name: 'Default Supplier',
        contact: 'Supplier Contact',
        email: 'supplier@example.com',
        paymentTerms: 'Net 30',
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(loyaltyRules)
      .values({
        id: uuid(),
        spendThreshold: 1000,
        pointsAwarded: 10,
        redemptionRate: 1,
        isActive: true,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(expenseCategories)
      .values([
        { id: uuid(), name: 'Utilities', description: 'Electricity, water, etc.' },
        { id: uuid(), name: 'Supplies', description: 'Store supplies' },
        { id: uuid(), name: 'Transport', description: 'Delivery and transport' },
        { id: uuid(), name: 'Miscellaneous', description: 'Other expenses' },
      ].map((c) => ({ ...c, deviceId, branchId, createdAt: now, updatedAt: now })))
      .onConflictDoNothing()
      .run();

    tx.insert(receiptTemplates)
      .values({
        id: uuid(),
        name: 'Default Receipt',
        headerJson: JSON.stringify({
          storeName: 'Mama Babi',
          showLogo: true,
          showAddress: true,
        }),
        footerJson: JSON.stringify({
          message: 'Thank you for shopping with Mama Babi!',
          returnPolicy: 'Returns within 7 days with receipt.',
        }),
        isDefault: true,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    const sampleProducts = [
      { name: 'Baby Onesie 0-3M', sku: 'MB-CL-001', barcode: '8901001001001', price: 1299, stock: 25, cat: 0 },
      { name: 'Premium Diapers Pack 48', sku: 'MB-DP-001', barcode: '8901001001002', price: 2499, stock: 40, cat: 1 },
      { name: 'Organic Baby Cereal', sku: 'MB-BF-001', barcode: '8901001001003', price: 899, stock: 30, cat: 2 },
      { name: 'Silicone Feeding Bottle', sku: 'MB-FD-001', barcode: '8901001001004', price: 1599, stock: 20, cat: 3 },
      { name: 'Soft Plush Rattle', sku: 'MB-TY-001', barcode: '8901001001005', price: 699, stock: 50, cat: 4 },
      { name: 'Baby Lotion 200ml', sku: 'MB-CR-001', barcode: '8901001001006', price: 1099, stock: 35, cat: 5 },
    ];

    for (const p of sampleProducts) {
      tx.insert(products)
        .values({
          id: uuid(),
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          categoryId: categoryData[p.cat].id,
          brandId,
          vendorId,
          costPrice: p.price * 0.6,
          retailPrice: p.price,
          taxRate: 17,
          stockQty: p.stock,
          reorderLevel: 10,
          reorderQty: 20,
          status: 'active',
          deviceId,
          branchId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  });

  console.log('Seed complete.');
  console.log('Default PINs — Admin: 1234 | Manager: 5678 | Cashier: 0000');
}

seed().catch(console.error);
