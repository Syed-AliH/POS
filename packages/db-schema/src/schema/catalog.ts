import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { syncColumns, timestamps } from './base';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  color: text('color'),
  skuPrefix: text('sku_prefix'),
  ...syncColumns,
  ...timestamps,
});

export const brands = sqliteTable('brands', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoPath: text('logo_path'),
  country: text('country'),
  ...syncColumns,
  ...timestamps,
});

export const vendors = sqliteTable('vendors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  email: text('email'),
  address: text('address'),
  paymentTerms: text('payment_terms'),
  preferredPaymentType: text('preferred_payment_type', { enum: ['cash', 'credit'] }).default('cash'),
  outstandingBalance: real('outstanding_balance').notNull().default(0),
  ...syncColumns,
  ...timestamps,
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  address: text('address'),
  notes: text('notes'),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  totalSpent: real('total_spent').notNull().default(0),
  visitCount: integer('visit_count').notNull().default(0),
  birthday: text('birthday'),
  segment: text('segment').default('new'),
  ...syncColumns,
  ...timestamps,
});

export const loyaltyRules = sqliteTable('loyalty_rules', {
  id: text('id').primaryKey(),
  spendThreshold: real('spend_threshold').notNull(),
  pointsAwarded: integer('points_awarded').notNull(),
  redemptionRate: real('redemption_rate').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...syncColumns,
  ...timestamps,
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode').notNull().unique(),
  categoryId: text('category_id'),
  brandId: text('brand_id'),
  vendorId: text('vendor_id'),
  parentId: text('parent_id'),
  costPrice: real('cost_price').notNull().default(0),
  retailPrice: real('retail_price').notNull().default(0),
  salePrice: real('sale_price'),
  // Original selling price captured at creation — used by "reset to original price".
  baseRetailPrice: real('base_retail_price'),
  baseSalePrice: real('base_sale_price'),
  // Selling price just before the last bulk price change — used by "undo last increase".
  prevRetailPrice: real('prev_retail_price'),
  prevSalePrice: real('prev_sale_price'),
  taxRate: real('tax_rate').notNull().default(0),
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

export const promotions = sqliteTable('promotions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  value: real('value').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  minPurchase: real('min_purchase'),
  productIds: text('product_ids'),
  categoryIds: text('category_ids'),
  isStackable: integer('is_stackable', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...syncColumns,
  ...timestamps,
});

export const promoCodes = sqliteTable('promo_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description'),
  type: text('type').notNull(),
  value: real('value').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  minPurchase: real('min_purchase'),
  productIds: text('product_ids'),
  categoryIds: text('category_ids'),
  usageLimit: integer('usage_limit'),
  usageCount: integer('usage_count').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...syncColumns,
  ...timestamps,
});

export const labelTemplates = sqliteTable('label_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  widthMm: real('width_mm').notNull(),
  heightMm: real('height_mm').notNull(),
  layoutJson: text('layout_json').notNull(),
  rollConfigJson: text('roll_config_json'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  ...syncColumns,
  ...timestamps,
});

export const receiptTemplates = sqliteTable('receipt_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  headerJson: text('header_json').notNull(),
  footerJson: text('footer_json').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  ...syncColumns,
  ...timestamps,
});
