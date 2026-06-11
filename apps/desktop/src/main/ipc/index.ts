import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import {
  handleGetSession,
  handleLogin,
  handleLogout,
  handleVerifyManagerPin,
} from './auth';
import {
  handleBarcodeLookup,
  handleCategoryList,
  handleCategoryUpdate,
  handleProductAdvancedSearch,
  handleProductCreate,
  handleProductGet,
  handleProductArchive,
  handleProductHistory,
  handleProductImportCsv,
  handleProductSeedDemo,
  handleProductList,
  handleProductSearch,
  handleProductUpdate,
  handleCategoryCreate,
} from './products';
import {
  handleSaleCreate,
  handleSaleGet,
  handleSaleList,
  handleDiscardHeld,
  handleSaleReceiptPreview,
  handleSaleResume,
  handleSaleUpdate,
  handleSaleVoid,
} from './sales';
import {
  handleGrnCancel,
  handleGrnCreate,
  handleGrnFinalize,
  handleGrnGet,
  handleGrnList,
  handleGrnUpdate,
} from './grn';
import { handleListPrinters, handleSettingsGet, handleSettingsGetAll, handleSettingsSet } from './settings';
import { handleLabelPrintBatch, handleLabelTemplates } from './labels';
import { handlePrintReceipt, handlePrintZReport } from './print';
import {
  handleDailySales,
  handleInventoryValuation,
  handlePaymentBreakdown,
  handleProfitReport,
  handleSalesByCategory,
  handleTopProducts,
} from './reports';
import { handleSyncQueueList, handleSyncStatus } from './sync';
import {
  handleGiftCardIssue,
  handleGiftCardList,
  handleGiftCardLookup,
  handleGiftCardReload,
  handleGiftCardDeactivate,
} from './giftCards';
import {
  handleExpenseApprove,
  handleExpenseCategories,
  handleExpenseCreate,
  handleExpenseList,
} from './expenses';
import { handleAuditList } from './auditLogs';
import {
  handleStocktakeComplete,
  handleStocktakeCount,
  handleStocktakeCurrent,
  handleStocktakeList,
  handleStocktakeStart,
  handleStocktakeCancel,
} from './stocktake';
import { handleStaffCreate, handleStaffList, handleStaffUpdate } from './users';
import {
  handleLabelTemplateUpdate,
  handleReceiptTemplateUpdate,
  handleReceiptTemplates,
} from './templates';
import { handleReturnCreate, handleReturnList, handleSaleLookupForReturn } from './returns';
import { handleInventoryAdjust, handleLowStock, handleMovementHistory } from './inventory';
import {
  handleShiftStart,
  handleShiftEnd,
  handleShiftCurrent,
  handleShiftList,
  handleEodReport,
  handleEodCloseDay,
  handleEodClosingsList,
  handleEodClosingGet,
} from './cash';
import { handleBackupCreate, handleBackupList, handleBackupRestore } from './backup';
import { handleVendorCreate, handleVendorList, handleVendorUpdate } from './vendors';
import {
  handlePoCreate,
  handlePoGet,
  handlePoList,
  handlePoReceive,
  handlePoUpdateStatus,
  handleReorderSuggestions,
} from './purchaseOrders';
import {
  handleCustomerCreate,
  handleCustomerGet,
  handleCustomerList,
  handleCustomerSearch,
  handleCustomerUpdate,
  handleLoyaltyRules,
} from './customers';
import { handlePromotionCreate, handlePromotionList, handlePromotionPreview, handlePromotionUpdate } from './promotions';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (_e, username: string, password: string) => handleLogin(username, password));
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => handleLogout());
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_SESSION, () => handleGetSession());
  ipcMain.handle(IPC_CHANNELS.AUTH_VERIFY_MANAGER_PIN, (_e, pin: string) => handleVerifyManagerPin(pin));

  ipcMain.handle(IPC_CHANNELS.PRODUCT_SEARCH, (_e, query: string) => handleProductSearch(query));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_LIST, (_e, params) => handleProductList(params));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_GET, (_e, id: string) => handleProductGet(id));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_CREATE, (_e, input) => handleProductCreate(input));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_UPDATE, (_e, id: string, input) => handleProductUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP, (_e, barcode: string) => handleBarcodeLookup(barcode));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_IMPORT_CSV, (_e, csv: string) => handleProductImportCsv(csv));
  ipcMain.handle(IPC_CHANNELS.CATEGORY_LIST, () => handleCategoryList());
  ipcMain.handle(IPC_CHANNELS.CATEGORY_CREATE, (_e, name: string, color?: string, skuPrefix?: string) => handleCategoryCreate(name, color, skuPrefix));
  ipcMain.handle(IPC_CHANNELS.CATEGORY_UPDATE, (_e, id: string, input) => handleCategoryUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ADVANCED_SEARCH, (_e, input) => handleProductAdvancedSearch(input));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_HISTORY, (_e, productId: string) => handleProductHistory(productId));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ARCHIVE, (_e, id: string) => handleProductArchive(id));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_SEED_DEMO, () => handleProductSeedDemo());

  ipcMain.handle(IPC_CHANNELS.SALE_CREATE, (_e, input) => handleSaleCreate(input));
  ipcMain.handle(IPC_CHANNELS.SALE_LIST, (_e, params) => handleSaleList(params));
  ipcMain.handle(IPC_CHANNELS.SALE_GET, (_e, id: string) => handleSaleGet(id));
  ipcMain.handle(IPC_CHANNELS.SALE_RECEIPT_PREVIEW, (_e, saleId: string) => handleSaleReceiptPreview(saleId));
  ipcMain.handle(IPC_CHANNELS.SALE_VOID, (_e, id: string) => handleSaleVoid(id));
  ipcMain.handle(IPC_CHANNELS.SALE_RESUME, (_e, key: string) => handleSaleResume(key));
  ipcMain.handle(IPC_CHANNELS.SALE_DISCARD_HELD, (_e, id: string) => handleDiscardHeld(id));
  ipcMain.handle(IPC_CHANNELS.SALE_LOOKUP, (_e, saleNumber: string) => handleSaleLookupForReturn(saleNumber));
  ipcMain.handle(IPC_CHANNELS.SALE_UPDATE, (_e, input) => handleSaleUpdate(input));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_e, key: string) => handleSettingsGet(key));
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => handleSettingsGetAll());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, input) => handleSettingsSet(input));
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_PRINTERS, () => handleListPrinters());

  ipcMain.handle(IPC_CHANNELS.SYNC_STATUS, () => handleSyncStatus());
  ipcMain.handle(IPC_CHANNELS.SYNC_QUEUE_LIST, (_e, limit?: number) => handleSyncQueueList(limit));

  ipcMain.handle(IPC_CHANNELS.PRINT_RECEIPT, (_e, saleId: string) => handlePrintReceipt(saleId));
  ipcMain.handle(IPC_CHANNELS.PRINT_Z_REPORT, (_e, date?: string) => handlePrintZReport(date));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATES, () => handleLabelTemplates());
  ipcMain.handle(IPC_CHANNELS.LABEL_PRINT_BATCH, (_e, input) => handleLabelPrintBatch(input));
  ipcMain.handle(IPC_CHANNELS.REPORT_DAILY_SALES, (_e, params) => handleDailySales(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_EOD, (_e, params) => handleEodReport(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_SALES_BY_CATEGORY, (_e, params) => handleSalesByCategory(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_TOP_PRODUCTS, (_e, params) => handleTopProducts(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_PAYMENT_BREAKDOWN, (_e, params) => handlePaymentBreakdown(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_INVENTORY_VALUATION, () => handleInventoryValuation());
  ipcMain.handle(IPC_CHANNELS.REPORT_PROFIT, (_e, params) => handleProfitReport(params));

  ipcMain.handle(IPC_CHANNELS.RETURN_CREATE, (_e, input) => handleReturnCreate(input));
  ipcMain.handle(IPC_CHANNELS.RETURN_LIST, (_e, params?) => handleReturnList(params));

  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADJUST, (_e, input) => handleInventoryAdjust(input));
  ipcMain.handle(IPC_CHANNELS.INVENTORY_LOW_STOCK, () => handleLowStock());
  ipcMain.handle(IPC_CHANNELS.INVENTORY_MOVEMENTS, (_e, productId?: string) => handleMovementHistory(productId));

  ipcMain.handle(IPC_CHANNELS.CASH_SHIFT_START, (_e, float: number) => handleShiftStart(float));
  ipcMain.handle(IPC_CHANNELS.CASH_SHIFT_END, (_e, float: number) => handleShiftEnd(float));
  ipcMain.handle(IPC_CHANNELS.CASH_SHIFT_CURRENT, () => handleShiftCurrent());
  ipcMain.handle(IPC_CHANNELS.CASH_SHIFT_LIST, (_e, limit?: number) => handleShiftList(limit));
  ipcMain.handle(IPC_CHANNELS.EOD_CLOSE_DAY, (_e, date?: string, closingFloat?: number) => handleEodCloseDay(date, closingFloat));
  ipcMain.handle(IPC_CHANNELS.EOD_CLOSINGS_LIST, (_e, params) => handleEodClosingsList(params));
  ipcMain.handle(IPC_CHANNELS.EOD_CLOSING_GET, (_e, id: string) => handleEodClosingGet(id));

  ipcMain.handle(IPC_CHANNELS.BACKUP_CREATE, () => handleBackupCreate());
  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, () => handleBackupList());
  ipcMain.handle(IPC_CHANNELS.BACKUP_RESTORE, (_e, filename: string) => handleBackupRestore(filename));

  ipcMain.handle(IPC_CHANNELS.VENDOR_LIST, () => handleVendorList());
  ipcMain.handle(IPC_CHANNELS.VENDOR_CREATE, (_e, input) => handleVendorCreate(input));
  ipcMain.handle(IPC_CHANNELS.VENDOR_UPDATE, (_e, id: string, input) => handleVendorUpdate(id, input));

  ipcMain.handle(IPC_CHANNELS.PO_CREATE, (_e, input) => handlePoCreate(input));
  ipcMain.handle(IPC_CHANNELS.PO_LIST, (_e, limit?: number) => handlePoList(limit));
  ipcMain.handle(IPC_CHANNELS.PO_GET, (_e, id: string) => handlePoGet(id));
  ipcMain.handle(IPC_CHANNELS.PO_UPDATE_STATUS, (_e, id: string, status) => handlePoUpdateStatus(id, status));
  ipcMain.handle(IPC_CHANNELS.PO_RECEIVE, (_e, input) => handlePoReceive(input));
  ipcMain.handle(IPC_CHANNELS.PO_REORDER_SUGGESTIONS, () => handleReorderSuggestions());

  ipcMain.handle(IPC_CHANNELS.GRN_CREATE, (_e, input) => handleGrnCreate(input));
  ipcMain.handle(IPC_CHANNELS.GRN_LIST, (_e, params) => handleGrnList(params));
  ipcMain.handle(IPC_CHANNELS.GRN_GET, (_e, id: string) => handleGrnGet(id));
  ipcMain.handle(IPC_CHANNELS.GRN_FINALIZE, (_e, id: string) => handleGrnFinalize(id));
  ipcMain.handle(IPC_CHANNELS.GRN_UPDATE, (_e, id: string, input) => handleGrnUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.GRN_CANCEL, (_e, id: string) => handleGrnCancel(id));

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_SEARCH, (_e, query: string) => handleCustomerSearch(query));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_LIST, (_e, limit?: number) => handleCustomerList(limit));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_CREATE, (_e, input) => handleCustomerCreate(input));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_UPDATE, (_e, id: string, input) => handleCustomerUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_GET, (_e, id: string) => handleCustomerGet(id));
  ipcMain.handle(IPC_CHANNELS.LOYALTY_RULES, () => handleLoyaltyRules());

  ipcMain.handle(IPC_CHANNELS.PROMOTION_LIST, () => handlePromotionList());
  ipcMain.handle(IPC_CHANNELS.PROMOTION_CREATE, (_e, input) => handlePromotionCreate(input));
  ipcMain.handle(IPC_CHANNELS.PROMOTION_UPDATE, (_e, id: string, input) => handlePromotionUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.PROMOTION_PREVIEW, (_e, input) => handlePromotionPreview(input));

  ipcMain.handle(IPC_CHANNELS.GIFT_CARD_LIST, (_e, limit?: number) => handleGiftCardList(limit));
  ipcMain.handle(IPC_CHANNELS.GIFT_CARD_LOOKUP, (_e, code: string) => handleGiftCardLookup(code));
  ipcMain.handle(IPC_CHANNELS.GIFT_CARD_ISSUE, (_e, input) => handleGiftCardIssue(input));
  ipcMain.handle(IPC_CHANNELS.GIFT_CARD_RELOAD, (_e, input) => handleGiftCardReload(input));
  ipcMain.handle(IPC_CHANNELS.GIFT_CARD_DEACTIVATE, (_e, id: string) => handleGiftCardDeactivate(id));

  ipcMain.handle(IPC_CHANNELS.EXPENSE_CATEGORIES, () => handleExpenseCategories());
  ipcMain.handle(IPC_CHANNELS.EXPENSE_CREATE, (_e, input) => handleExpenseCreate(input));
  ipcMain.handle(IPC_CHANNELS.EXPENSE_LIST, (_e, params) => handleExpenseList(params));
  ipcMain.handle(IPC_CHANNELS.EXPENSE_APPROVE, (_e, id: string) => handleExpenseApprove(id));

  ipcMain.handle(IPC_CHANNELS.AUDIT_LIST, (_e, params) => handleAuditList(params));

  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_START, (_e, notes?: string) => handleStocktakeStart(notes));
  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_CURRENT, () => handleStocktakeCurrent());
  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_COUNT, (_e, sessionId: string, productId: string, qty: number) =>
    handleStocktakeCount(sessionId, productId, qty),
  );
  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_COMPLETE, (_e, sessionId: string) => handleStocktakeComplete(sessionId));
  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_LIST, (_e, limit?: number) => handleStocktakeList(limit));
  ipcMain.handle(IPC_CHANNELS.STOCKTAKE_CANCEL, (_e, sessionId: string) => handleStocktakeCancel(sessionId));

  ipcMain.handle(IPC_CHANNELS.STAFF_LIST, () => handleStaffList());
  ipcMain.handle(IPC_CHANNELS.STAFF_CREATE, (_e, input) => handleStaffCreate(input));
  ipcMain.handle(IPC_CHANNELS.STAFF_UPDATE, (_e, id: string, input) => handleStaffUpdate(id, input));

  ipcMain.handle(IPC_CHANNELS.RECEIPT_TEMPLATES, () => handleReceiptTemplates());
  ipcMain.handle(IPC_CHANNELS.RECEIPT_TEMPLATE_UPDATE, (_e, id: string, input) => handleReceiptTemplateUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_UPDATE, (_e, id: string, input) => handleLabelTemplateUpdate(id, input));
}
