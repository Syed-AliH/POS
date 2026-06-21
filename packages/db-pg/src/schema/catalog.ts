import { boolean, doublePrecision, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { syncColumns, timestamps } from './base';

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  color: text('color'),
  skuPrefix: text('sku_prefix'),
  ...syncColumns,
  ...timestamps,
});

export const brands = pgTable('brands', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoPath: text('logo_path'),
  country: text('country'),
  ...syncColumns,
  ...timestamps,
});

export const vendors = pgTable('vendors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  email: text('email'),
  address: text('address'),
  paymentTerms: text('payment_terms'),
  preferredPaymentType: text('preferred_payment_type', { enum: ['cash', 'credit'] }).default('cash'),
  outstandingBalance: doublePrecision('outstanding_balance').notNull().default(0),
  ...syncColumns,
  ...timestamps,
});

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  address: text('address'),
  notes: text('notes'),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  totalSpent: doublePrecision('total_spent').notNull().default(0),
  visitCount: integer('visit_count').notNull().default(0),
  birthday: text('birthday'),
  segment: text('segment').default('new'),
  ...syncColumns,
  ...timestamps,
});

export const loyaltyRules = pgTable('loyalty_rules', {
  id: text('id').primaryKey(),
  spendThreshold: doublePrecision('spend_threshold').notNull(),
  pointsAwarded: integer('points_awarded').notNull(),
  redemptionRate: doublePrecision('redemption_rate').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...syncColumns,
  ...timestamps,
});

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode').notNull().unique(),
  categoryId: text('category_id'),
  brandId: text('brand_id'),
  vendorId: text('vendor_id'),
  parentId: text('parent_id'),
  costPrice: doublePrecision('cost_price').notNull().default(0),
  retailPrice: doublePrecision('retail_price').notNull().default(0),
  salePrice: doublePrecision('sale_price'),
  taxRate: doublePrecision('tax_rate').notNull().default(0),
  stockQty: integer('stock_qty').notNull().default(0),
  reorderLevel: integer('reorder_level').notNull().default(0),
  reorderQty: integer('reorder_qty').notNull().default(0),
  expiryDate: text('expiry_date'),
  weightGrams: integer('weight_grams'),
  imagePath: text('image_path'),
  description: text('description'),
  status: text('status', { enum: ['active', 'archived', 'discontinued'] })
    .notNull()
    .default('active'),
  ...syncColumns,
  ...timestamps,
});

export const promotions = pgTable('promotions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  value: doublePrecision('value').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  minPurchase: doublePrecision('min_purchase'),
  productIds: text('product_ids'),
  categoryIds: text('category_ids'),
  isStackable: boolean('is_stackable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...syncColumns,
  ...timestamps,
});

export const labelTemplates = pgTable('label_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  widthMm: doublePrecision('width_mm').notNull(),
  heightMm: doublePrecision('height_mm').notNull(),
  layoutJson: text('layout_json').notNull(),
  rollConfigJson: text('roll_config_json'),
  isDefault: boolean('is_default').notNull().default(false),
  ...syncColumns,
  ...timestamps,
});

export const receiptTemplates = pgTable('receipt_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  headerJson: text('header_json').notNull(),
  footerJson: text('footer_json').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  ...syncColumns,
  ...timestamps,
});
