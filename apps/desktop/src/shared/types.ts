export type UserRole = 'super_admin' | 'manager' | 'cashier';

export interface UserSession {
  id: string;
  name: string;
  role: UserRole;
  permissions?: string[];
  token?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  categoryId: string | null;
  brandId: string | null;
  vendorId: string | null;
  costPrice: number;
  retailPrice: number;
  salePrice: number | null;
  taxRate: number;
  stockQty: number;
  reorderLevel: number;
  status: 'active' | 'archived' | 'discontinued';
  imagePath: string | null;
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CartItem {
  saleItemId?: string;
  productId: string;
  productName: string;
  productSku: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  /** Category of the product — used for category-based promotion matching at checkout. */
  categoryId?: string | null;
  /** Timestamp when this line was first added — controls cart row order (first scan stays on top). */
  scannedAt?: number;
}

export interface SaleSummary {
  id: string;
  saleNumber: string;
  cashierId: string;
  cashierName: string;
  customerId: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  subtotal: number;
  discountAmount: number;
  discountReason?: string | null;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'wallet' | 'online';
  amountTendered: number | null;
  changeGiven: number | null;
  status: 'completed' | 'held' | 'voided' | 'returned';
  heldKey: string | null;
  createdAt: string;
  items: CartItem[];
}

/** Minimal product shape the till caches for instant local search. */
export interface SearchProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  retailPrice: number;
  salePrice: number | null;
  taxRate: number;
  stockQty: number;
  categoryId: string | null;
}

export interface SearchPayload {
  /** Newest product updatedAt — changes when the catalogue changes. */
  version: string;
  count: number;
  products: SearchProduct[];
}

/** Pushed from main while a queued receipt moves through the printer. */
export interface PrintStatusPayload {
  jobId: string;
  saleNumber: string;
  state: 'queued' | 'printing' | 'printed' | 'failed';
  error?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  skuPrefix?: string | null;
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CreateSaleInput {
  items: Array<{
    productId: string;
    quantity: number;
    discountPercent?: number;
    /** Held-bill resume: the price the line was held at, so re-pricing a product doesn't change the saved bill. */
    unitPrice?: number;
  }>;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  discountAmount?: number;
  discountReason?: string;
  /** Manual bill adjustment: positive increases the total (surcharge), negative decreases it (extra discount). */
  adjustmentAmount?: number;
  loyaltyPointsRedeemed?: number;
  promotionIds?: string[];
  paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'wallet' | 'online';
  amountTendered?: number;
  giftCardCode?: string;
  notes?: string;
  status?: 'completed' | 'held';
  heldKey?: string;
  heldSaleId?: string;
}

export interface UpdateSaleInput {
  saleId: string;
  items: Array<{
    productId: string;
    quantity: number;
    discountPercent?: number;
    /** Price the line was sold at. Keeps an edited bill on its original prices even if the product has since been re-priced. */
    unitPrice?: number;
  }>;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  amountTendered?: number;
  /**
   * Explicit bill-level discount for the edited sale (already net of promos, loyalty and
   * manual adjustment). When omitted the original discount is pro-rated to the new subtotal.
   * A negative value raises the total (surcharge), matching CreateSaleInput semantics.
   */
  discountAmount?: number;
  discountReason?: string;
}

export interface BulkPriceIncreaseInput {
  /** Percentage to increase the selling price by (e.g. 5 for +5%). */
  percent: number;
  productIds?: string[];
  categoryIds?: string[];
  applyToAll?: boolean;
}

export interface BulkPriceRevertInput {
  /** 'original' = price at creation, 'last' = price before the most recent increase. */
  mode: 'original' | 'last';
  productIds?: string[];
  categoryIds?: string[];
  applyToAll?: boolean;
}

export interface ProductInput {
  name: string;
  sku?: string;
  barcode?: string;
  categoryId?: string;
  brandId?: string;
  vendorId?: string;
  costPrice: number;
  retailPrice: number;
  salePrice?: number;
  taxRate?: number;
  stockQty?: number;
  reorderLevel?: number;
  description?: string;
  status?: 'active' | 'archived' | 'discontinued';
}

export interface ReturnSummary {
  id: string;
  returnNumber: string;
  saleId: string;
  saleNumber: string;
  reason: string;
  refundMethod: string;
  totalRefund: number;
  status: string;
  processedBy: string;
  createdAt: string;
  items: Array<{
    productName: string;
    qtyReturned: number;
    unitRefund: number;
    restocked: boolean;
  }>;
}

export interface CreateReturnInput {
  saleNumber: string;
  reason: string;
  refundMethod: 'cash' | 'store_credit' | 'loyalty';
  items: Array<{ saleItemId: string; qtyReturned: number; restocked?: boolean }>;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  type: string;
  qtyChange: number;
  notes: string | null;
  createdAt: string;
}

export interface StockAdjustmentInput {
  productId: string;
  qtyAfter: number;
  reason: string;
  notes?: string;
}

export interface ShiftSummary {
  id: string;
  cashierId: string;
  cashierName: string;
  startTime: string;
  endTime: string | null;
  openingFloat: number;
  closingFloat: number | null;
  status: string;
  expectedCash?: number;
  difference?: number;
}

export interface EodReport {
  date: string;
  totalSales: number;
  transactionCount: number;
  cashSales: number;
  cardSales: number;
  walletSales: number;
  returnsTotal: number;
  expensesTotal: number;
  openingFloat: number;
  expectedCash: number;
  netClosing: number;
}

export interface EodClosingRecord {
  id: string;
  closingDate: string;
  totalSales: number;
  transactionCount: number;
  returnsTotal: number;
  expensesTotal: number;
  cashCollected: number;
  openingFloat: number;
  closingFloat: number | null;
  variance: number | null;
  paymentBreakdown: Record<string, number>;
  closedBy: string;
  closedAt: string;
}

export interface SaleListParams {
  limit?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface ReturnListParams {
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export interface ReceiptPreview {
  saleNumber: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  cashierName: string;
  createdAt: string;
  items: Array<{ name: string; qty: number; unitPrice: number; lineTotal: number }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  amountTendered: number | null;
  changeGiven: number | null;
  footerMessage: string;
}

export interface AdvancedProductSearchInput {
  sku?: string;
  master?: string;
  refine?: string;
}

export interface ProductHistoryEntry {
  date: string;
  type: 'purchase' | 'sale' | 'return' | 'adjustment';
  reference: string;
  vendorOrCustomer: string | null;
  qty: number;
  unitCostOrPrice: number;
  total: number;
}

export interface ProductHistory {
  productId: string;
  purchases: ProductHistoryEntry[];
  sales: ProductHistoryEntry[];
  returns: ProductHistoryEntry[];
}

export interface GrnLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  qty: number;
  unitCost: number;
  unitRetail: number;
  lineTotal: number;
}

export type GrnPaymentType = 'cash' | 'credit';

export interface GrnSummary {
  id: string;
  grnNumber: string;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string | null;
  invoiceTotal: number;
  linesTotal: number;
  receivedDate: string;
  status: 'draft' | 'finalized' | 'cancelled';
  paymentType: GrnPaymentType;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  items: GrnLine[];
}

export interface CreateGrnInput {
  vendorId: string;
  invoiceNumber?: string;
  receivedDate?: string;
  paymentType?: GrnPaymentType;
  notes?: string;
  items: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>;
}

export interface UpdateGrnInput {
  vendorId?: string;
  invoiceNumber?: string;
  paymentType?: GrnPaymentType;
  notes?: string;
  items?: Array<{ productId: string; qty: number; unitCost: number; unitRetail?: number }>;
}

export interface GrnListParams {
  vendorId?: string;
  startDate?: string;
  endDate?: string;
  grnNumber?: string;
  status?: string;
  limit?: number;
}

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  preferredPaymentType: GrnPaymentType | null;
  outstandingBalance: number;
}

export interface SupplierPaymentInput {
  vendorId: string;
  amount: number;
  paymentDate?: string;
  notes?: string;
}

export interface SupplierPaymentUpdateInput {
  amount?: number;
  paymentDate?: string;
  notes?: string;
}

export interface SupplierPaymentSummary {
  id: string;
  paymentNumber: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  paymentDate: string;
  notes: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface SupplierPaymentListParams {
  vendorId?: string;
  limit?: number;
}

export interface SupplierLedgerEntry {
  id: string;
  createdAt: string;
  transactionType: 'credit_grn' | 'payment';
  referenceNumber: string;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
  notes: string | null;
}

export interface VendorInput {
  name: string;
  contact?: string;
  email?: string;
  address?: string;
  paymentTerms?: string;
}

export interface PoItemSummary {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  status: 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
  totalCost: number;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: PoItemSummary[];
}

export interface CreatePoInput {
  vendorId: string;
  notes?: string;
  items: Array<{ productId: string; qtyOrdered: number; unitCost: number }>;
}

export interface ReceivePoInput {
  poId: string;
  items: Array<{ poItemId: string; qtyReceived: number }>;
}

export interface ReorderSuggestion {
  productId: string;
  productName: string;
  sku: string;
  stockQty: number;
  reorderLevel: number;
  reorderQty: number;
  vendorId: string | null;
  vendorName: string | null;
  costPrice: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
  segment: string | null;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  loyaltyPoints?: number;
}

export interface LoyaltyRule {
  id: string;
  spendThreshold: number;
  pointsAwarded: number;
  redemptionRate: number;
  isActive: boolean;
}

export interface LoyaltyRuleInput {
  spendThreshold: number;
  pointsAwarded: number;
  redemptionRate?: number;
}

export interface Promotion {
  id: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  startDate: string | null;
  endDate: string | null;
  minPurchase: number | null;
  productIds: string[];
  categoryIds: string[];
  isStackable: boolean;
  isActive: boolean;
}

export interface PromotionInput {
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  startDate?: string;
  endDate?: string;
  minPurchase?: number;
  productIds?: string[];
  categoryIds?: string[];
  isStackable?: boolean;
  isActive?: boolean;
}

export interface PromotionPreview {
  promotionId: string;
  promotionName: string;
  discountAmount: number;
}

export interface PromotionPreviewInput {
  items: Array<{ productId: string; quantity: number; unitPrice: number; categoryId?: string | null }>;
  subtotal: number;
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  type: 'percent' | 'fixed';
  value: number;
  startDate: string | null;
  endDate: string | null;
  minPurchase: number | null;
  productIds: string[];
  categoryIds: string[];
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
}

export interface PromoCodeInput {
  code: string;
  description?: string;
  type: 'percent' | 'fixed';
  value: number;
  startDate?: string;
  endDate?: string;
  minPurchase?: number;
  productIds?: string[];
  categoryIds?: string[];
  usageLimit?: number;
  isActive?: boolean;
}

export interface PromoCodeValidateInput {
  code: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number; categoryId?: string | null }>;
  subtotal: number;
}

export interface PromoCodeValidateResult {
  promoCodeId: string;
  code: string;
  discountAmount: number;
  /** Product ids the code applied to (empty = whole cart). */
  eligibleProductIds: string[];
}

export type {
  LabelElement,
  LabelFieldType,
  LabelLayout,
  ReceiptTemplateConfig,
  ReceiptTemplateFooter,
  ReceiptTemplateHeader,
  ReceiptTemplateSections,
} from '@mama-babi/printer';

export interface LabelTemplateSummary {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  layout: import('@mama-babi/printer').LabelLayout;
  rollConfig: import('@mama-babi/printer').LabelRollConfig;
  isDefault: boolean;
}

export interface PrintLabelsInput {
  templateId: string;
  items: Array<{ productId: string; copies: number }>;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export interface SettingsUpdateInput {
  settings: Record<string, string>;
}

export interface StaffUser {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateStaffInput {
  name: string;
  username: string;
  password: string;
  confirmPassword?: string;
  role: UserRole;
  email?: string;
  phone?: string;
  permissions?: string[];
}

export interface UpdateStaffInput {
  name?: string;
  username?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
  email?: string;
  phone?: string;
  permissions?: string[];
}

export interface ResetPasswordInput {
  password: string;
  confirmPassword?: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface GiftCard {
  id: string;
  code: string;
  initialBalance: number;
  currentBalance: number;
  customerId: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface IssueGiftCardInput {
  initialBalance: number;
  customerId?: string;
  expiresAt?: string;
}

export interface ReloadGiftCardInput {
  code: string;
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface ExpenseSummary {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  paidBy: string;
  paidByName: string;
  notes: string | null;
  status: string;
  createdAt: string;
}

export interface ExpenseListParams {
  limit?: number;
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  status?: string;
}

export interface CreateExpenseInput {
  categoryId: string;
  amount: number;
  notes?: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  module: string;
  action: string;
  recordId: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface StocktakeItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
}

export interface StocktakeSession {
  id: string;
  startedBy: string;
  startedByName: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  items: StocktakeItem[];
  totalVariance: number;
}

export interface ReceiptTemplate {
  id: string;
  name: string;
  widthMm: 58 | 80;
  sections: import('@mama-babi/printer').ReceiptTemplateSections;
  header: import('@mama-babi/printer').ReceiptTemplateHeader;
  footer: import('@mama-babi/printer').ReceiptTemplateFooter;
  isDefault: boolean;
}

export interface ReportDateRange {
  startDate?: string;
  endDate?: string;
}

export interface SalesByCategoryRow {
  categoryId: string | null;
  categoryName: string;
  totalSales: number;
  itemCount: number;
}

export interface TopProductRow {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface PaymentBreakdownRow {
  paymentMethod: string;
  total: number;
  count: number;
}

export interface InventoryValuation {
  totalUnits: number;
  totalCostValue: number;
  totalRetailValue: number;
  productCount: number;
  negativeStockCount: number;
  negativeStockItems: Array<{ id: string; name: string; sku: string; stockQty: number }>;
}

export type InventoryStockFilter = 'all' | 'negative' | 'zero' | 'low';

export interface InventoryReportParams {
  search?: string;
  categoryId?: string;
  stockFilter?: InventoryStockFilter;
}

export interface InventoryReportRow {
  id: string;
  productName: string;
  barcode: string;
  sku: string;
  categoryId: string | null;
  categoryName: string;
  stockQty: number;
  reorderLevel: number;
  costPrice: number;
  retailPrice: number;
  inventoryValue: number;
  lastGrnDate: string | null;
  updatedAt: string;
}

export interface InventoryReportSummary {
  rows: InventoryReportRow[];
  totalProducts: number;
  totalUnits: number;
  totalInventoryValue: number;
  negativeCount: number;
  zeroCount: number;
  lowCount: number;
}

export interface ProfitReport {
  revenue: number;
  estimatedCost: number;
  grossProfit: number;
  marginPercent: number;
  transactionCount: number;
  returnsTotal: number;
}

export interface SyncQueueItem {
  id: string;
  tableName: string;
  recordId: string;
  operation: string;
  status: string;
  createdAt: string;
}
