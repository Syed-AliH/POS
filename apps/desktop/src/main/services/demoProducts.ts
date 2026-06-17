import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { ean13CheckDigit } from '@mama-babi/printer';
import { brands, categories, products, vendors } from '@mama-babi/db-schema';
import { getDb } from '../db';

/** Valid unique EAN-13 for demo products (890 prefix, unique 12-digit body). */
export function demoEan13(sequence: number): string {
  const body = `8901001${String(sequence).padStart(5, '0')}`;
  return body + String(ean13CheckDigit(body));
}

export interface DemoProductDef {
  name: string;
  sku: string;
  barcode: string;
  price: number;
  stock: number;
  category: string;
  salePrice?: number;
}

export const DEMO_CATEGORIES = [
  { name: 'Clothing', color: '#3B82F6' },
  { name: 'Diapers', color: '#10B981' },
  { name: 'Baby Food', color: '#F59E0B' },
  { name: 'Feeding', color: '#8B5CF6' },
  { name: 'Toys', color: '#EC4899' },
  { name: 'Care', color: '#06B6D4' },
];

export const DEMO_PRODUCTS: DemoProductDef[] = [
  { name: 'Baby Onesie 0-3M', sku: 'MB-CL-001', barcode: demoEan13(1), price: 1299, stock: 25, category: 'Clothing' },
  { name: 'Cotton Romper 3-6M', sku: 'MB-CL-002', barcode: demoEan13(2), price: 1499, stock: 30, category: 'Clothing' },
  { name: 'Knit Cardigan 6-12M', sku: 'MB-CL-003', barcode: demoEan13(3), price: 1899, stock: 18, category: 'Clothing', salePrice: 1599 },
  { name: 'Soft Socks 3-Pack', sku: 'MB-CL-004', barcode: demoEan13(4), price: 599, stock: 45, category: 'Clothing' },
  { name: 'Premium Diapers Pack 48', sku: 'MB-DP-001', barcode: demoEan13(5), price: 2499, stock: 40, category: 'Diapers' },
  { name: 'Economy Diapers Pack 32', sku: 'MB-DP-002', barcode: demoEan13(6), price: 1799, stock: 55, category: 'Diapers' },
  { name: 'Baby Wipes 80ct', sku: 'MB-DP-003', barcode: demoEan13(7), price: 499, stock: 60, category: 'Diapers' },
  { name: 'Diaper Rash Cream 50g', sku: 'MB-DP-004', barcode: demoEan13(8), price: 799, stock: 28, category: 'Diapers' },
  { name: 'Organic Baby Cereal', sku: 'MB-BF-001', barcode: demoEan13(9), price: 899, stock: 30, category: 'Baby Food' },
  { name: 'Apple Banana Puree Jar', sku: 'MB-BF-002', barcode: demoEan13(10), price: 349, stock: 80, category: 'Baby Food' },
  { name: 'Rice Porridge Mix 400g', sku: 'MB-BF-003', barcode: demoEan13(11), price: 649, stock: 42, category: 'Baby Food' },
  { name: 'Teething Biscuits', sku: 'MB-BF-004', barcode: demoEan13(12), price: 449, stock: 36, category: 'Baby Food', salePrice: 399 },
  { name: 'Silicone Feeding Bottle', sku: 'MB-FD-001', barcode: demoEan13(13), price: 1599, stock: 20, category: 'Feeding' },
  { name: 'Anti-Colic Bottle 260ml', sku: 'MB-FD-002', barcode: demoEan13(14), price: 1299, stock: 24, category: 'Feeding' },
  { name: 'Silicone Bib Set 2pc', sku: 'MB-FD-003', barcode: demoEan13(15), price: 699, stock: 35, category: 'Feeding' },
  { name: 'Sippy Cup 200ml', sku: 'MB-FD-004', barcode: demoEan13(16), price: 899, stock: 22, category: 'Feeding' },
  { name: 'Soft Plush Rattle', sku: 'MB-TY-001', barcode: demoEan13(17), price: 699, stock: 50, category: 'Toys' },
  { name: 'Stacking Rings Toy', sku: 'MB-TY-002', barcode: demoEan13(18), price: 899, stock: 38, category: 'Toys' },
  { name: 'Musical Mobile', sku: 'MB-TY-003', barcode: demoEan13(19), price: 2199, stock: 12, category: 'Toys' },
  { name: 'Activity Play Mat', sku: 'MB-TY-004', barcode: demoEan13(20), price: 3499, stock: 8, category: 'Toys', salePrice: 2999 },
  { name: 'Baby Lotion 200ml', sku: 'MB-CR-001', barcode: demoEan13(21), price: 1099, stock: 35, category: 'Care' },
  { name: 'Baby Shampoo 250ml', sku: 'MB-CR-002', barcode: demoEan13(22), price: 999, stock: 32, category: 'Care' },
  { name: 'Moisturizing Body Wash', sku: 'MB-CR-003', barcode: demoEan13(23), price: 849, stock: 27, category: 'Care' },
  { name: 'Baby Powder 100g', sku: 'MB-CR-004', barcode: demoEan13(24), price: 449, stock: 40, category: 'Care' },
];

function ensureCategories(
  db: ReturnType<typeof getDb>,
  now: string,
  deviceId: string,
  branchId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const existing = db.select().from(categories).where(eq(categories.isDeleted, false)).all();
  for (const row of existing) map.set(row.name, row.id);

  for (const cat of DEMO_CATEGORIES) {
    if (!map.has(cat.name)) {
      const id = uuid();
      db.insert(categories).values({
        id,
        name: cat.name,
        color: cat.color,
        deviceId,
        branchId,
        createdAt: now,
        updatedAt: now,
      }).run();
      map.set(cat.name, id);
    }
  }
  return map;
}

function ensureBrandAndVendor(
  db: ReturnType<typeof getDb>,
  now: string,
  deviceId: string,
  branchId: string,
): { brandId: string; vendorId: string } {
  let brand = db.select().from(brands).limit(1).get();
  if (!brand) {
    const brandId = uuid();
    db.insert(brands).values({
      id: brandId,
      name: 'Mama Babi House Brand',
      country: 'PK',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();
    brand = db.select().from(brands).where(eq(brands.id, brandId)).get()!;
  }

  let vendor = db.select().from(vendors).limit(1).get();
  if (!vendor) {
    const vendorId = uuid();
    db.insert(vendors).values({
      id: vendorId,
      name: 'Default Supplier',
      contact: 'Supplier Contact',
      email: 'supplier@example.com',
      paymentTerms: 'Net 30',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();
    vendor = db.select().from(vendors).where(eq(vendors.id, vendorId)).get()!;
  }

  return { brandId: brand.id, vendorId: vendor.id };
}

export function seedDemoProducts(options?: { skipExisting?: boolean }): { added: number; skipped: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const deviceId = 'local-device';
  const branchId = 'main';
  const skipExisting = options?.skipExisting ?? true;

  const categoryMap = ensureCategories(db, now, deviceId, branchId);
  const { brandId, vendorId } = ensureBrandAndVendor(db, now, deviceId, branchId);

  let added = 0;
  let skipped = 0;

  for (const p of DEMO_PRODUCTS) {
    const existing = db.select().from(products).where(eq(products.sku, p.sku)).get();
    if (existing) {
      skipped++;
      continue;
    }

    db.insert(products).values({
      id: uuid(),
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryId: categoryMap.get(p.category) ?? null,
      brandId,
      vendorId,
      costPrice: Math.round(p.price * 0.6),
      retailPrice: p.price,
      salePrice: p.salePrice ?? null,
      taxRate: 17,
      stockQty: p.stock,
      reorderLevel: 10,
      reorderQty: 20,
      status: 'active',
      deviceId,
      branchId,
      createdAt: now,
      updatedAt: now,
    }).run();
    added++;
  }

  if (added > 0) {
    console.log(`[seed] Demo products: added ${added}, skipped ${skipped}`);
  }
  return { added, skipped };
}

export function seedDemoProductsIfEmpty(): void {
  const db = getDb();
  const count = db.select().from(products).where(eq(products.isDeleted, false)).all().length;
  if (count === 0) seedDemoProducts({ skipExisting: true });
}
