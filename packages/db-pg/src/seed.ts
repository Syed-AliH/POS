import './load-env';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { deriveSkuPrefix } from '@mama-babi/barcode';
import { eq } from 'drizzle-orm';
import {
  brands,
  categories,
  expenseCategories,
  loyaltyRules,
  receiptTemplates,
  settings,
  users,
  vendors,
} from './schema';
import { createPostgresDatabase } from './client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = createPostgresDatabase(connectionString);
const now = new Date().toISOString();
const deviceId = 'cloud';
const branchId = 'main';

async function seed() {
  const [existing] = await db.select().from(users).limit(1);
  if (existing) {
    console.log('Database already seeded — skipping.');
    process.exit(0);
  }

  const adminHash = await bcrypt.hash('admin123', 12);
  const managerHash = await bcrypt.hash('manager123', 12);
  const salesHash = await bcrypt.hash('sales123', 12);

  const adminId = uuid();
  const managerId = uuid();
  const salesId = uuid();
  const vendorId = uuid();
  const brandId = uuid();
  const categoryId = uuid();

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
    { key: 'auto_print_receipt', value: 'true' },
    { key: 'device_id', value: deviceId },
    { key: 'branch_id', value: branchId },
    { key: 'default_retail_markup', value: '100' },
    { key: 'secondary_currency', value: 'USD' },
    { key: 'exchange_rate', value: '0.0036' },
  ];

  for (const s of defaultSettings) {
    await db.insert(settings).values({
      id: uuid(),
      key: s.key,
      value: s.value,
      scope: 'global',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.insert(users).values([
    {
      id: adminId,
      name: 'Admin',
      username: 'admin',
      passwordHash: adminHash,
      role: 'super_admin',
      isActive: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      name: 'Manager',
      username: 'manager',
      passwordHash: managerHash,
      role: 'manager',
      isActive: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: salesId,
      name: 'Salesman',
      username: 'sales',
      passwordHash: salesHash,
      role: 'cashier',
      isActive: true,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(categories).values({
    id: categoryId,
    name: 'General',
    color: '#3B82F6',
    skuPrefix: deriveSkuPrefix('General'),
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(brands).values({
    id: brandId,
    name: 'Mama Babi House Brand',
    country: 'PK',
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(vendors).values({
    id: vendorId,
    name: 'Default Supplier',
    contact: 'Supplier Contact',
    email: 'supplier@example.com',
    paymentTerms: 'Net 30',
    preferredPaymentType: 'cash',
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(loyaltyRules).values({
    id: uuid(),
    spendThreshold: 1000,
    pointsAwarded: 10,
    redemptionRate: 1,
    isActive: true,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  for (const c of [
    { name: 'Utilities', description: 'Electricity, water, etc.' },
    { name: 'Supplies', description: 'Store supplies' },
    { name: 'Transport', description: 'Delivery and transport' },
    { name: 'Miscellaneous', description: 'Other expenses' },
  ]) {
    await db.insert(expenseCategories).values({
      id: uuid(),
      ...c,
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.insert(receiptTemplates).values({
    id: uuid(),
    name: 'Default Receipt',
    headerJson: JSON.stringify({ storeName: 'Mama Babi', widthMm: 80 }),
    footerJson: JSON.stringify({ message: 'Thank you for shopping!' }),
    isDefault: true,
    deviceId,
    branchId,
    createdAt: now,
    updatedAt: now,
  });

  console.log('PostgreSQL seed complete.');
  console.log('Users (change passwords after first login):');
  console.log('  admin   / admin123   (Super Admin)');
  console.log('  manager / manager123 (Manager — stock, GRN, reports)');
  console.log('  sales   / sales123   (Salesman — checkout only)');

  await db.$client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
