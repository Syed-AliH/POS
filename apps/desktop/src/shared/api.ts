import { IPC_CHANNELS } from './ipc-channels';
import type {
  AdvancedProductSearchInput,
  ApiResult,
  BackupInfo,
  Category,
  CreateGrnInput,
  UpdateGrnInput,
  CreateReturnInput,
  CreateSaleInput,
  UpdateSaleInput,
  Customer,
  CustomerInput,
  EodClosingRecord,
  EodReport,
  ExpenseCategory,
  ExpenseListParams,
  ExpenseSummary,
  CreateExpenseInput,
  GiftCard,
  GrnListParams,
  GrnSummary,
  InventoryMovement,
  IssueGiftCardInput,
  LabelTemplateSummary,
  LoginInput,
  LoyaltyRule,
  PrinterInfo,
  PrintLabelsInput,
  Product,
  ProductHistory,
  ProductInput,
  Promotion,
  PromotionInput,
  PromotionPreview,
  PromotionPreviewInput,
  ReceiptPreview,
  ReloadGiftCardInput,
  ReturnSummary,
  ReturnListParams,
  SaleListParams,
  SaleSummary,
  SettingsUpdateInput,
  ShiftSummary,
  StockAdjustmentInput,
  UserSession,
  Vendor,
  VendorInput,
  StaffUser,
  CreateStaffInput,
  UpdateStaffInput,
  AuditLogEntry,
  StocktakeSession,
  ReceiptTemplate,
  ReportDateRange,
  SalesByCategoryRow,
  TopProductRow,
  PaymentBreakdownRow,
  InventoryReportParams,
  InventoryReportSummary,
  InventoryValuation,
  ProfitReport,
  SupplierLedgerEntry,
  SupplierPaymentInput,
  SupplierPaymentListParams,
  SupplierPaymentSummary,
  SupplierPaymentUpdateInput,
  SyncQueueItem,
} from './types';

export interface MamaBabiAPI {
  auth: {
    login: (input: LoginInput) => Promise<ApiResult<UserSession>>;
    logout: () => Promise<ApiResult<void>>;
    getSession: () => Promise<ApiResult<UserSession | null>>;
    verifyManagerPin: (pin: string) => Promise<ApiResult<boolean>>;
  };
  products: {
    search: (query: string) => Promise<ApiResult<Product[]>>;
    advancedSearch: (input: AdvancedProductSearchInput) => Promise<ApiResult<Product[]>>;
    history: (productId: string) => Promise<ApiResult<ProductHistory>>;
    list: (params?: { status?: string; limit?: number }) => Promise<ApiResult<Product[]>>;
    get: (id: string) => Promise<ApiResult<Product>>;
    create: (input: ProductInput) => Promise<ApiResult<Product>>;
    update: (id: string, input: Partial<ProductInput>) => Promise<ApiResult<Product>>;
    archive: (id: string) => Promise<ApiResult<Product>>;
    barcodeLookup: (barcode: string) => Promise<ApiResult<Product | null>>;
    importCsv: (csvContent: string) => Promise<ApiResult<{ imported: number; errors: string[] }>>;
    seedDemo: () => Promise<ApiResult<{ added: number; skipped: number }>>;
  };
  categories: {
    list: () => Promise<ApiResult<Category[]>>;
    create: (name: string, color?: string, skuPrefix?: string) => Promise<ApiResult<Category>>;
    update: (id: string, input: { name?: string; color?: string; skuPrefix?: string }) => Promise<ApiResult<Category>>;
  };
  sales: {
    create: (input: CreateSaleInput) => Promise<ApiResult<SaleSummary>>;
    list: (params?: SaleListParams) => Promise<ApiResult<SaleSummary[]>>;
    get: (id: string) => Promise<ApiResult<SaleSummary>>;
    lookup: (saleNumber: string) => Promise<ApiResult<SaleSummary>>;
    receiptPreview: (saleId: string) => Promise<ApiResult<ReceiptPreview>>;
    update: (input: UpdateSaleInput) => Promise<ApiResult<SaleSummary>>;
    void: (id: string) => Promise<ApiResult<SaleSummary>>;
    resume: (heldKey: string) => Promise<ApiResult<SaleSummary>>;
    discardHeld: (id: string) => Promise<ApiResult<void>>;
  };
  returns: {
    create: (input: CreateReturnInput) => Promise<ApiResult<ReturnSummary>>;
    list: (params?: ReturnListParams) => Promise<ApiResult<ReturnSummary[]>>;
  };
  inventory: {
    adjust: (input: StockAdjustmentInput) => Promise<ApiResult<{ qtyBefore: number; qtyAfter: number }>>;
    lowStock: () => Promise<ApiResult<Array<{ id: string; name: string; sku: string; stockQty: number; reorderLevel: number }>>>;
    movements: (productId?: string) => Promise<ApiResult<InventoryMovement[]>>;
  };
  shifts: {
    start: (openingFloat: number) => Promise<ApiResult<ShiftSummary>>;
    end: (closingFloat: number) => Promise<ApiResult<ShiftSummary>>;
    current: () => Promise<ApiResult<ShiftSummary | null>>;
    list: (limit?: number) => Promise<ApiResult<ShiftSummary[]>>;
  };
  eod: {
    closeDay: (date?: string, closingFloat?: number) => Promise<ApiResult<EodClosingRecord>>;
    closingsList: (params?: { startDate?: string; endDate?: string; limit?: number }) => Promise<ApiResult<EodClosingRecord[]>>;
    closingGet: (id: string) => Promise<ApiResult<EodClosingRecord>>;
  };
  settings: {
    get: (key: string) => Promise<ApiResult<string | null>>;
    getAll: () => Promise<ApiResult<Record<string, string>>>;
    set: (input: SettingsUpdateInput) => Promise<ApiResult<Record<string, string>>>;
    listPrinters: () => Promise<ApiResult<PrinterInfo[]>>;
  };
  labels: {
    templates: () => Promise<ApiResult<LabelTemplateSummary[]>>;
    printBatch: (input: PrintLabelsInput) => Promise<ApiResult<{ printed: boolean; labelCount: number }>>;
  };
  sync: {
    status: () => Promise<ApiResult<{ enabled: boolean; pending: number; lastSync: string | null }>>;
    queueList: (limit?: number) => Promise<ApiResult<SyncQueueItem[]>>;
  };
  print: {
    receipt: (saleId: string) => Promise<ApiResult<{ printed: boolean }>>;
    testReceipt: (template: import('@mama-babi/printer').ReceiptTemplateConfig) => Promise<ApiResult<{ printed: boolean }>>;
    testLabel: (input: { layout: LabelTemplateSummary['layout']; widthMm: number; heightMm: number }) => Promise<ApiResult<{ printed: boolean }>>;
    zReport: (date?: string) => Promise<ApiResult<{ printed: boolean }>>;
  };
  reports: {
    dailySales: (params?: ReportDateRange) => Promise<ApiResult<{ totalSales: number; transactionCount: number }>>;
    eod: (params?: ReportDateRange) => Promise<ApiResult<EodReport>>;
    salesByCategory: (params?: ReportDateRange) => Promise<ApiResult<SalesByCategoryRow[]>>;
    topProducts: (params?: ReportDateRange & { limit?: number }) => Promise<ApiResult<TopProductRow[]>>;
    paymentBreakdown: (params?: ReportDateRange) => Promise<ApiResult<PaymentBreakdownRow[]>>;
    inventoryValuation: () => Promise<ApiResult<InventoryValuation>>;
    inventory: (params?: InventoryReportParams) => Promise<ApiResult<InventoryReportSummary>>;
    profit: (params?: ReportDateRange) => Promise<ApiResult<ProfitReport>>;
  };
  supplierPayments: {
    list: (params?: SupplierPaymentListParams) => Promise<ApiResult<SupplierPaymentSummary[]>>;
    create: (input: SupplierPaymentInput) => Promise<ApiResult<SupplierPaymentSummary>>;
    update: (id: string, input: SupplierPaymentUpdateInput) => Promise<ApiResult<SupplierPaymentSummary>>;
    delete: (id: string) => Promise<ApiResult<void>>;
    balance: (vendorId: string) => Promise<ApiResult<{ outstandingBalance: number }>>;
    ledger: (vendorId: string) => Promise<ApiResult<SupplierLedgerEntry[]>>;
  };
  backup: {
    create: () => Promise<ApiResult<BackupInfo>>;
    list: () => Promise<ApiResult<BackupInfo[]>>;
    restore: (filename: string) => Promise<ApiResult<void>>;
  };
  vendors: {
    list: () => Promise<ApiResult<Vendor[]>>;
    create: (input: VendorInput) => Promise<ApiResult<Vendor>>;
    update: (id: string, input: Partial<VendorInput>) => Promise<ApiResult<Vendor>>;
  };
  grn: {
    create: (input: CreateGrnInput) => Promise<ApiResult<GrnSummary>>;
    list: (params?: GrnListParams) => Promise<ApiResult<GrnSummary[]>>;
    get: (id: string) => Promise<ApiResult<GrnSummary>>;
    finalize: (id: string) => Promise<ApiResult<GrnSummary>>;
    update: (id: string, input: UpdateGrnInput) => Promise<ApiResult<GrnSummary>>;
    cancel: (id: string) => Promise<ApiResult<void>>;
    void: (id: string) => Promise<ApiResult<void>>;
  };
  customers: {
    search: (query: string) => Promise<ApiResult<Customer[]>>;
    list: (limit?: number) => Promise<ApiResult<Customer[]>>;
    get: (id: string) => Promise<ApiResult<Customer>>;
    create: (input: CustomerInput) => Promise<ApiResult<Customer>>;
    update: (id: string, input: Partial<CustomerInput>) => Promise<ApiResult<Customer>>;
    loyaltyRules: () => Promise<ApiResult<LoyaltyRule[]>>;
  };
  promotions: {
    list: () => Promise<ApiResult<Promotion[]>>;
    create: (input: PromotionInput) => Promise<ApiResult<Promotion>>;
    update: (id: string, input: Partial<PromotionInput>) => Promise<ApiResult<Promotion>>;
    preview: (input: PromotionPreviewInput) => Promise<ApiResult<PromotionPreview[]>>;
  };
  giftCards: {
    list: (limit?: number) => Promise<ApiResult<GiftCard[]>>;
    lookup: (code: string) => Promise<ApiResult<GiftCard>>;
    issue: (input: IssueGiftCardInput) => Promise<ApiResult<GiftCard>>;
    reload: (input: ReloadGiftCardInput) => Promise<ApiResult<GiftCard>>;
    deactivate: (id: string) => Promise<ApiResult<GiftCard>>;
  };
  expenses: {
    categories: () => Promise<ApiResult<ExpenseCategory[]>>;
    create: (input: CreateExpenseInput) => Promise<ApiResult<ExpenseSummary>>;
    list: (params?: ExpenseListParams) => Promise<ApiResult<ExpenseSummary[]>>;
    approve: (id: string) => Promise<ApiResult<ExpenseSummary>>;
  };
  audit: {
    list: (params?: { limit?: number; module?: string }) => Promise<ApiResult<AuditLogEntry[]>>;
  };
  stocktake: {
    start: (notes?: string) => Promise<ApiResult<StocktakeSession>>;
    current: () => Promise<ApiResult<StocktakeSession | null>>;
    count: (sessionId: string, productId: string, qty: number) => Promise<ApiResult<StocktakeSession>>;
    complete: (sessionId: string) => Promise<ApiResult<StocktakeSession>>;
    list: (limit?: number) => Promise<ApiResult<StocktakeSession[]>>;
    cancel: (sessionId: string) => Promise<ApiResult<StocktakeSession>>;
  };
  staff: {
    list: () => Promise<ApiResult<StaffUser[]>>;
    create: (input: CreateStaffInput) => Promise<ApiResult<StaffUser>>;
    update: (id: string, input: UpdateStaffInput) => Promise<ApiResult<StaffUser>>;
  };
  templates: {
    receiptList: () => Promise<ApiResult<ReceiptTemplate[]>>;
    receiptUpdate: (id: string, input: Partial<ReceiptTemplate>) => Promise<ApiResult<ReceiptTemplate>>;
    labelUpdate: (id: string, input: { name?: string; widthMm?: number; heightMm?: number; layout?: LabelTemplateSummary['layout'] }) => Promise<ApiResult<LabelTemplateSummary>>;
  };
}

function getInvoke() {
  const bridge = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  if (!bridge?.invoke) {
    throw new Error('Electron preload bridge is not available. Restart the app.');
  }
  return bridge.invoke.bind(bridge) as (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function createApi(): MamaBabiAPI {
  const invoke = getInvoke();

  return {
    auth: {
      login: (input) => invoke(IPC_CHANNELS.AUTH_LOGIN, input.username, input.password),
      logout: () => invoke(IPC_CHANNELS.AUTH_LOGOUT),
      getSession: () => invoke(IPC_CHANNELS.AUTH_GET_SESSION),
      verifyManagerPin: (pin) => invoke(IPC_CHANNELS.AUTH_VERIFY_MANAGER_PIN, pin),
    },
    products: {
      search: (query) => invoke(IPC_CHANNELS.PRODUCT_SEARCH, query),
      advancedSearch: (input) => invoke(IPC_CHANNELS.PRODUCT_ADVANCED_SEARCH, input),
      history: (productId) => invoke(IPC_CHANNELS.PRODUCT_HISTORY, productId),
      list: (params) => invoke(IPC_CHANNELS.PRODUCT_LIST, params),
      get: (id) => invoke(IPC_CHANNELS.PRODUCT_GET, id),
      create: (input) => invoke(IPC_CHANNELS.PRODUCT_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.PRODUCT_UPDATE, id, input),
      archive: (id) => invoke(IPC_CHANNELS.PRODUCT_ARCHIVE, id),
      barcodeLookup: (barcode) => invoke(IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP, barcode),
      importCsv: (csv) => invoke(IPC_CHANNELS.PRODUCT_IMPORT_CSV, csv),
      seedDemo: () => invoke(IPC_CHANNELS.PRODUCT_SEED_DEMO),
    },
    categories: {
      list: () => invoke(IPC_CHANNELS.CATEGORY_LIST),
      create: (name, color, skuPrefix) => invoke(IPC_CHANNELS.CATEGORY_CREATE, name, color, skuPrefix),
      update: (id, input) => invoke(IPC_CHANNELS.CATEGORY_UPDATE, id, input),
    },
    sales: {
      create: (input) => invoke(IPC_CHANNELS.SALE_CREATE, input),
      list: (params) => invoke(IPC_CHANNELS.SALE_LIST, params),
      get: (id) => invoke(IPC_CHANNELS.SALE_GET, id),
      lookup: (saleNumber) => invoke(IPC_CHANNELS.SALE_LOOKUP, saleNumber),
      receiptPreview: (saleId) => invoke(IPC_CHANNELS.SALE_RECEIPT_PREVIEW, saleId),
      update: (input) => invoke(IPC_CHANNELS.SALE_UPDATE, input),
      void: (id) => invoke(IPC_CHANNELS.SALE_VOID, id),
      resume: (heldKey) => invoke(IPC_CHANNELS.SALE_RESUME, heldKey),
      discardHeld: (id) => invoke(IPC_CHANNELS.SALE_DISCARD_HELD, id),
    },
    returns: {
      create: (input) => invoke(IPC_CHANNELS.RETURN_CREATE, input),
      list: (params) => invoke(IPC_CHANNELS.RETURN_LIST, params),
    },
    inventory: {
      adjust: (input) => invoke(IPC_CHANNELS.INVENTORY_ADJUST, input),
      lowStock: () => invoke(IPC_CHANNELS.INVENTORY_LOW_STOCK),
      movements: (productId) => invoke(IPC_CHANNELS.INVENTORY_MOVEMENTS, productId),
    },
    shifts: {
      start: (float) => invoke(IPC_CHANNELS.CASH_SHIFT_START, float),
      end: (float) => invoke(IPC_CHANNELS.CASH_SHIFT_END, float),
      current: () => invoke(IPC_CHANNELS.CASH_SHIFT_CURRENT),
      list: (limit) => invoke(IPC_CHANNELS.CASH_SHIFT_LIST, limit),
    },
    eod: {
      closeDay: (date, closingFloat) => invoke(IPC_CHANNELS.EOD_CLOSE_DAY, date, closingFloat),
      closingsList: (params) => invoke(IPC_CHANNELS.EOD_CLOSINGS_LIST, params),
      closingGet: (id) => invoke(IPC_CHANNELS.EOD_CLOSING_GET, id),
    },
    settings: {
      get: (key) => invoke(IPC_CHANNELS.SETTINGS_GET, key),
      getAll: () => invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
      set: (input) => invoke(IPC_CHANNELS.SETTINGS_SET, input),
      listPrinters: () => invoke(IPC_CHANNELS.SETTINGS_LIST_PRINTERS),
    },
    labels: {
      templates: () => invoke(IPC_CHANNELS.LABEL_TEMPLATES),
      printBatch: (input) => invoke(IPC_CHANNELS.LABEL_PRINT_BATCH, input),
    },
    sync: {
      status: () => invoke(IPC_CHANNELS.SYNC_STATUS),
      queueList: (limit) => invoke(IPC_CHANNELS.SYNC_QUEUE_LIST, limit),
    },
    print: {
      receipt: (saleId) => invoke(IPC_CHANNELS.PRINT_RECEIPT, saleId),
      testReceipt: (template) => invoke(IPC_CHANNELS.PRINT_TEST_RECEIPT, template),
      testLabel: (input) => invoke(IPC_CHANNELS.PRINT_TEST_LABEL, input),
      zReport: (date) => invoke(IPC_CHANNELS.PRINT_Z_REPORT, date),
    },
    reports: {
      dailySales: (params) => invoke(IPC_CHANNELS.REPORT_DAILY_SALES, params),
      eod: (params) => invoke(IPC_CHANNELS.REPORT_EOD, params),
      salesByCategory: (params) => invoke(IPC_CHANNELS.REPORT_SALES_BY_CATEGORY, params),
      topProducts: (params) => invoke(IPC_CHANNELS.REPORT_TOP_PRODUCTS, params),
      paymentBreakdown: (params) => invoke(IPC_CHANNELS.REPORT_PAYMENT_BREAKDOWN, params),
      inventoryValuation: () => invoke(IPC_CHANNELS.REPORT_INVENTORY_VALUATION),
      inventory: (params) => invoke(IPC_CHANNELS.REPORT_INVENTORY, params),
      profit: (params) => invoke(IPC_CHANNELS.REPORT_PROFIT, params),
    },
    supplierPayments: {
      list: (params) => invoke(IPC_CHANNELS.SUPPLIER_PAYMENT_LIST, params),
      create: (input) => invoke(IPC_CHANNELS.SUPPLIER_PAYMENT_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.SUPPLIER_PAYMENT_UPDATE, id, input),
      delete: (id) => invoke(IPC_CHANNELS.SUPPLIER_PAYMENT_DELETE, id),
      balance: (vendorId) => invoke(IPC_CHANNELS.SUPPLIER_BALANCE, vendorId),
      ledger: (vendorId) => invoke(IPC_CHANNELS.SUPPLIER_LEDGER, vendorId),
    },
    backup: {
      create: () => invoke(IPC_CHANNELS.BACKUP_CREATE),
      list: () => invoke(IPC_CHANNELS.BACKUP_LIST),
      restore: (filename) => invoke(IPC_CHANNELS.BACKUP_RESTORE, filename),
    },
    vendors: {
      list: () => invoke(IPC_CHANNELS.VENDOR_LIST),
      create: (input) => invoke(IPC_CHANNELS.VENDOR_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.VENDOR_UPDATE, id, input),
    },
    grn: {
      create: (input) => invoke(IPC_CHANNELS.GRN_CREATE, input),
      list: (params) => invoke(IPC_CHANNELS.GRN_LIST, params),
      get: (id) => invoke(IPC_CHANNELS.GRN_GET, id),
      finalize: (id) => invoke(IPC_CHANNELS.GRN_FINALIZE, id),
      update: (id, input) => invoke(IPC_CHANNELS.GRN_UPDATE, id, input),
      cancel: (id) => invoke(IPC_CHANNELS.GRN_CANCEL, id),
      void: (id) => invoke(IPC_CHANNELS.GRN_VOID, id),
    },
    customers: {
      search: (query) => invoke(IPC_CHANNELS.CUSTOMER_SEARCH, query),
      list: (limit) => invoke(IPC_CHANNELS.CUSTOMER_LIST, limit),
      get: (id) => invoke(IPC_CHANNELS.CUSTOMER_GET, id),
      create: (input) => invoke(IPC_CHANNELS.CUSTOMER_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.CUSTOMER_UPDATE, id, input),
      loyaltyRules: () => invoke(IPC_CHANNELS.LOYALTY_RULES),
    },
    promotions: {
      list: () => invoke(IPC_CHANNELS.PROMOTION_LIST),
      create: (input) => invoke(IPC_CHANNELS.PROMOTION_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.PROMOTION_UPDATE, id, input),
      preview: (input) => invoke(IPC_CHANNELS.PROMOTION_PREVIEW, input),
    },
    giftCards: {
      list: (limit) => invoke(IPC_CHANNELS.GIFT_CARD_LIST, limit),
      lookup: (code) => invoke(IPC_CHANNELS.GIFT_CARD_LOOKUP, code),
      issue: (input) => invoke(IPC_CHANNELS.GIFT_CARD_ISSUE, input),
      reload: (input) => invoke(IPC_CHANNELS.GIFT_CARD_RELOAD, input),
      deactivate: (id) => invoke(IPC_CHANNELS.GIFT_CARD_DEACTIVATE, id),
    },
    expenses: {
      categories: () => invoke(IPC_CHANNELS.EXPENSE_CATEGORIES),
      create: (input) => invoke(IPC_CHANNELS.EXPENSE_CREATE, input),
      list: (params) => invoke(IPC_CHANNELS.EXPENSE_LIST, params),
      approve: (id) => invoke(IPC_CHANNELS.EXPENSE_APPROVE, id),
    },
    audit: {
      list: (params) => invoke(IPC_CHANNELS.AUDIT_LIST, params),
    },
    stocktake: {
      start: (notes) => invoke(IPC_CHANNELS.STOCKTAKE_START, notes),
      current: () => invoke(IPC_CHANNELS.STOCKTAKE_CURRENT),
      count: (sessionId, productId, qty) => invoke(IPC_CHANNELS.STOCKTAKE_COUNT, sessionId, productId, qty),
      complete: (sessionId) => invoke(IPC_CHANNELS.STOCKTAKE_COMPLETE, sessionId),
      list: (limit) => invoke(IPC_CHANNELS.STOCKTAKE_LIST, limit),
      cancel: (sessionId) => invoke(IPC_CHANNELS.STOCKTAKE_CANCEL, sessionId),
    },
    staff: {
      list: () => invoke(IPC_CHANNELS.STAFF_LIST),
      create: (input) => invoke(IPC_CHANNELS.STAFF_CREATE, input),
      update: (id, input) => invoke(IPC_CHANNELS.STAFF_UPDATE, id, input),
    },
    templates: {
      receiptList: () => invoke(IPC_CHANNELS.RECEIPT_TEMPLATES),
      receiptUpdate: (id, input) => invoke(IPC_CHANNELS.RECEIPT_TEMPLATE_UPDATE, id, input),
      labelUpdate: (id, input) => invoke(IPC_CHANNELS.LABEL_TEMPLATE_UPDATE, id, input),
    },
  };
}
