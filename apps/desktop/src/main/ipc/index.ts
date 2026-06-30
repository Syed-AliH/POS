import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type { ApiResult, SettingsUpdateInput } from '@shared/types';
import {
  DEVICE_LOCAL_SETTING_KEYS,
  mergeDeviceLocalSettings,
  omitDeviceLocalSettings,
  pickDeviceLocalSettings,
} from '@shared/deviceSettings';
import { hasCloudHandler, invokeCloud } from '../cloud/client';
import { isCloudMode } from '../cloud/config';
import { withCloud } from './cloud-proxy';
import { registerAppConfigHandlers } from './appConfig';
import { registerUpdaterHandlers } from './updater';
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
  handleProductImportRows,
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
  handleGrnVoid,
} from './grn';
import { handleListPrinters, handleSettingsGet, handleSettingsGetAll, handleSettingsSet } from './settings';
import { handleLabelPrintBatch, handleLabelTemplateGet, handleLabelTemplates } from './labels';
import {
  handleLabelCalibrate,
  handleLabelFeed,
  handlePrintReceipt,
  handlePrintTestLabel,
  handlePrintTestReceipt,
  handlePrintZReport,
} from './print';
import {
  handleDailySales,
  handleInventoryReport,
  handleInventoryValuation,
  handlePaymentBreakdown,
  handleProfitReport,
  handleSalesByCategory,
  handleTopProducts,
} from './reports';
import {
  handleSupplierBalance,
  handleSupplierLedger,
  handleSupplierPaymentCreate,
  handleSupplierPaymentDelete,
  handleSupplierPaymentList,
  handleSupplierPaymentUpdate,
} from './supplierPayments';
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
import {
  handleStaffCreate,
  handleStaffDelete,
  handleStaffGet,
  handleStaffList,
  handleStaffResetPassword,
  handleStaffUpdate,
} from './users';
import {
  handleLabelTemplateCreate,
  handleLabelTemplateDelete,
  handleLabelTemplateSetDefault,
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
  handleLoyaltyRuleSave,
} from './customers';
import { handlePromotionCreate, handlePromotionList, handlePromotionPreview, handlePromotionUpdate } from './promotions';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (_e, username: string, password: string) =>
    withCloud(IPC_CHANNELS.AUTH_LOGIN, () => handleLogin(username, password), [username, password]));
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () =>
    withCloud(IPC_CHANNELS.AUTH_LOGOUT, () => handleLogout()));
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_SESSION, () =>
    withCloud(IPC_CHANNELS.AUTH_GET_SESSION, () => handleGetSession()));
  ipcMain.handle(IPC_CHANNELS.AUTH_VERIFY_MANAGER_PIN, (_e, pin: string) =>
    withCloud(IPC_CHANNELS.AUTH_VERIFY_MANAGER_PIN, () => handleVerifyManagerPin(pin), [pin]));

  ipcMain.handle(IPC_CHANNELS.PRODUCT_SEARCH, (_e, query: string) =>
    withCloud(IPC_CHANNELS.PRODUCT_SEARCH, () => handleProductSearch(query), [query]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_LIST, (_e, params) =>
    withCloud(IPC_CHANNELS.PRODUCT_LIST, () => handleProductList(params), [params]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.PRODUCT_GET, () => handleProductGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.PRODUCT_CREATE, () => handleProductCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.PRODUCT_UPDATE, () => handleProductUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP, (_e, barcode: string) =>
    withCloud(IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP, () => handleBarcodeLookup(barcode), [barcode]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_IMPORT_CSV, (_e, csv: string) => handleProductImportCsv(csv));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_IMPORT_ROWS, (_e, rows: unknown[]) =>
    withCloud(IPC_CHANNELS.PRODUCT_IMPORT_ROWS, () => handleProductImportRows(rows as never), [rows]));
  ipcMain.handle(IPC_CHANNELS.CATEGORY_LIST, () =>
    withCloud(IPC_CHANNELS.CATEGORY_LIST, () => handleCategoryList()));
  ipcMain.handle(IPC_CHANNELS.CATEGORY_CREATE, (_e, name: string, color?: string, skuPrefix?: string) =>
    withCloud(IPC_CHANNELS.CATEGORY_CREATE, () => handleCategoryCreate(name, color, skuPrefix), [name, color, skuPrefix]));
  ipcMain.handle(IPC_CHANNELS.CATEGORY_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.CATEGORY_UPDATE, () => handleCategoryUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ADVANCED_SEARCH, (_e, input) =>
    withCloud(IPC_CHANNELS.PRODUCT_ADVANCED_SEARCH, () => handleProductAdvancedSearch(input), [input]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_HISTORY, (_e, productId: string) =>
    withCloud(IPC_CHANNELS.PRODUCT_HISTORY, () => handleProductHistory(productId), [productId]));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_ARCHIVE, (_e, id: string) => handleProductArchive(id));
  ipcMain.handle(IPC_CHANNELS.PRODUCT_SEED_DEMO, () => handleProductSeedDemo());

  ipcMain.handle(IPC_CHANNELS.SALE_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.SALE_CREATE, () => handleSaleCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.SALE_LIST, (_e, params) =>
    withCloud(IPC_CHANNELS.SALE_LIST, () => handleSaleList(params), [params]));
  ipcMain.handle(IPC_CHANNELS.SALE_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.SALE_GET, () => handleSaleGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.SALE_RECEIPT_PREVIEW, (_e, saleId: string) =>
    withCloud(IPC_CHANNELS.SALE_RECEIPT_PREVIEW, () => handleSaleReceiptPreview(saleId), [saleId]));
  ipcMain.handle(IPC_CHANNELS.SALE_VOID, (_e, id: string) => handleSaleVoid(id));
  ipcMain.handle(IPC_CHANNELS.SALE_RESUME, (_e, key: string) =>
    withCloud(IPC_CHANNELS.SALE_RESUME, () => handleSaleResume(key), [key]));
  ipcMain.handle(IPC_CHANNELS.SALE_DISCARD_HELD, (_e, id: string) =>
    withCloud(IPC_CHANNELS.SALE_DISCARD_HELD, () => handleDiscardHeld(id), [id]));
  ipcMain.handle(IPC_CHANNELS.SALE_LOOKUP, (_e, saleNumber: string) =>
    withCloud(IPC_CHANNELS.SALE_LOOKUP, () => handleSaleLookupForReturn(saleNumber), [saleNumber]));
  ipcMain.handle(IPC_CHANNELS.SALE_UPDATE, (_e, input) => handleSaleUpdate(input));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_e, key: string) => {
    if (DEVICE_LOCAL_SETTING_KEYS.has(key)) {
      return handleSettingsGet(key);
    }
    return withCloud(IPC_CHANNELS.SETTINGS_GET, () => handleSettingsGet(key), [key]);
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const local = handleSettingsGetAll();
    const cloud = await withCloud(
      IPC_CHANNELS.SETTINGS_GET_ALL,
      () => local,
    );
    if (!cloud.success) return cloud;
    if (local.success && local.data) {
      return {
        success: true as const,
        data: mergeDeviceLocalSettings(cloud.data ?? {}, local.data),
      };
    }
    return cloud;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_e, input: SettingsUpdateInput) => {
    const localPart = pickDeviceLocalSettings(input.settings);
    const cloudPart = omitDeviceLocalSettings(input.settings);

    if (Object.keys(localPart).length > 0) {
      const localResult = handleSettingsSet({ settings: localPart });
      if (!localResult.success) return localResult;
    }

    if (Object.keys(cloudPart).length === 0) {
      return handleSettingsGetAll();
    }

    if (isCloudMode() && hasCloudHandler(IPC_CHANNELS.SETTINGS_SET)) {
      const cloudResult = (await invokeCloud(IPC_CHANNELS.SETTINGS_SET, [
        { settings: cloudPart },
      ])) as ApiResult<Record<string, string>>;
      if (!cloudResult.success) return cloudResult;
      const allLocal = handleSettingsGetAll();
      return {
        success: true as const,
        data: mergeDeviceLocalSettings(cloudResult.data ?? {}, allLocal.data ?? {}),
      };
    }

    return handleSettingsSet({ settings: cloudPart });
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_PRINTERS, () => handleListPrinters());

  ipcMain.handle(IPC_CHANNELS.SYNC_STATUS, () => handleSyncStatus());
  ipcMain.handle(IPC_CHANNELS.SYNC_QUEUE_LIST, (_e, limit?: number) => handleSyncQueueList(limit));

  ipcMain.handle(IPC_CHANNELS.PRINT_RECEIPT, (_e, saleId: string) => handlePrintReceipt(saleId));
  ipcMain.handle(IPC_CHANNELS.PRINT_TEST_RECEIPT, (_e, template) => handlePrintTestReceipt(template));
  ipcMain.handle(IPC_CHANNELS.PRINT_TEST_LABEL, (_e, input) => handlePrintTestLabel(input));
  ipcMain.handle(IPC_CHANNELS.LABEL_FEED, (_e, input) => handleLabelFeed(input));
  ipcMain.handle(IPC_CHANNELS.LABEL_CALIBRATE, (_e, input) => handleLabelCalibrate(input));
  ipcMain.handle(IPC_CHANNELS.PRINT_Z_REPORT, (_e, date?: string) => handlePrintZReport(date));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATES, () =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATES, () => handleLabelTemplates()));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATE_GET, () => handleLabelTemplateGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.LABEL_PRINT_BATCH, (_e, input) => handleLabelPrintBatch(input));
  ipcMain.handle(IPC_CHANNELS.REPORT_DAILY_SALES, (_e, params) => handleDailySales(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_EOD, (_e, params) => handleEodReport(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_SALES_BY_CATEGORY, (_e, params) => handleSalesByCategory(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_TOP_PRODUCTS, (_e, params) => handleTopProducts(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_PAYMENT_BREAKDOWN, (_e, params) => handlePaymentBreakdown(params));
  ipcMain.handle(IPC_CHANNELS.REPORT_INVENTORY_VALUATION, () => handleInventoryValuation());
  ipcMain.handle(IPC_CHANNELS.REPORT_INVENTORY, (_e, params) =>
    withCloud(IPC_CHANNELS.REPORT_INVENTORY, () => handleInventoryReport(params), [params]));
  ipcMain.handle(IPC_CHANNELS.REPORT_PROFIT, (_e, params) =>
    withCloud(IPC_CHANNELS.REPORT_PROFIT, () => handleProfitReport(params), [params]));

  ipcMain.handle(IPC_CHANNELS.RETURN_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.RETURN_CREATE, () => handleReturnCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.RETURN_LIST, (_e, params?) =>
    withCloud(IPC_CHANNELS.RETURN_LIST, () => handleReturnList(params), [params]));

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

  ipcMain.handle(IPC_CHANNELS.VENDOR_LIST, () =>
    withCloud(IPC_CHANNELS.VENDOR_LIST, () => handleVendorList()));
  ipcMain.handle(IPC_CHANNELS.VENDOR_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.VENDOR_CREATE, () => handleVendorCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.VENDOR_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.VENDOR_UPDATE, () => handleVendorUpdate(id, input), [id, input]));

  ipcMain.handle(IPC_CHANNELS.PO_CREATE, (_e, input) => handlePoCreate(input));
  ipcMain.handle(IPC_CHANNELS.PO_LIST, (_e, limit?: number) => handlePoList(limit));
  ipcMain.handle(IPC_CHANNELS.PO_GET, (_e, id: string) => handlePoGet(id));
  ipcMain.handle(IPC_CHANNELS.PO_UPDATE_STATUS, (_e, id: string, status) => handlePoUpdateStatus(id, status));
  ipcMain.handle(IPC_CHANNELS.PO_RECEIVE, (_e, input) => handlePoReceive(input));
  ipcMain.handle(IPC_CHANNELS.PO_REORDER_SUGGESTIONS, () => handleReorderSuggestions());

  ipcMain.handle(IPC_CHANNELS.GRN_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.GRN_CREATE, () => handleGrnCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.GRN_LIST, (_e, params) =>
    withCloud(IPC_CHANNELS.GRN_LIST, () => handleGrnList(params), [params]));
  ipcMain.handle(IPC_CHANNELS.GRN_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.GRN_GET, () => handleGrnGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.GRN_FINALIZE, (_e, id: string) =>
    withCloud(IPC_CHANNELS.GRN_FINALIZE, () => handleGrnFinalize(id), [id]));
  ipcMain.handle(IPC_CHANNELS.GRN_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.GRN_UPDATE, () => handleGrnUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.GRN_CANCEL, (_e, id: string) =>
    withCloud(IPC_CHANNELS.GRN_CANCEL, () => handleGrnCancel(id), [id]));
  ipcMain.handle(IPC_CHANNELS.GRN_VOID, (_e, id: string) =>
    withCloud(IPC_CHANNELS.GRN_VOID, () => handleGrnVoid(id), [id]));

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_PAYMENT_LIST, (_e, params) => handleSupplierPaymentList(params));
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_PAYMENT_CREATE, (_e, input) => handleSupplierPaymentCreate(input));
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_PAYMENT_UPDATE, (_e, id: string, input) => handleSupplierPaymentUpdate(id, input));
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_PAYMENT_DELETE, (_e, id: string) => handleSupplierPaymentDelete(id));
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_BALANCE, (_e, vendorId: string) => handleSupplierBalance(vendorId));
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_LEDGER, (_e, vendorId: string) => handleSupplierLedger(vendorId));

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_SEARCH, (_e, query: string) =>
    withCloud(IPC_CHANNELS.CUSTOMER_SEARCH, () => handleCustomerSearch(query), [query]));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_LIST, (_e, limit?: number) =>
    withCloud(IPC_CHANNELS.CUSTOMER_LIST, () => handleCustomerList(limit), [limit]));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.CUSTOMER_CREATE, () => handleCustomerCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.CUSTOMER_UPDATE, () => handleCustomerUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.CUSTOMER_GET, () => handleCustomerGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.LOYALTY_RULES, () =>
    withCloud(IPC_CHANNELS.LOYALTY_RULES, () => handleLoyaltyRules()));
  ipcMain.handle(IPC_CHANNELS.LOYALTY_RULES_UPDATE, (_e, input) =>
    withCloud(IPC_CHANNELS.LOYALTY_RULES_UPDATE, () => handleLoyaltyRuleSave(input), [input]));

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

  ipcMain.handle(IPC_CHANNELS.STAFF_LIST, () =>
    withCloud(IPC_CHANNELS.STAFF_LIST, () => handleStaffList()));
  ipcMain.handle(IPC_CHANNELS.STAFF_GET, (_e, id: string) =>
    withCloud(IPC_CHANNELS.STAFF_GET, () => handleStaffGet(id), [id]));
  ipcMain.handle(IPC_CHANNELS.STAFF_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.STAFF_CREATE, () => handleStaffCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.STAFF_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.STAFF_UPDATE, () => handleStaffUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.STAFF_DELETE, (_e, id: string) =>
    withCloud(IPC_CHANNELS.STAFF_DELETE, () => handleStaffDelete(id), [id]));
  ipcMain.handle(IPC_CHANNELS.STAFF_RESET_PASSWORD, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.STAFF_RESET_PASSWORD, () => handleStaffResetPassword(id, input), [id, input]));

  ipcMain.handle(IPC_CHANNELS.RECEIPT_TEMPLATES, () =>
    withCloud(IPC_CHANNELS.RECEIPT_TEMPLATES, () => handleReceiptTemplates()));
  ipcMain.handle(IPC_CHANNELS.RECEIPT_TEMPLATE_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.RECEIPT_TEMPLATE_UPDATE, () => handleReceiptTemplateUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_UPDATE, (_e, id: string, input) =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATE_UPDATE, () => handleLabelTemplateUpdate(id, input), [id, input]));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_CREATE, (_e, input) =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATE_CREATE, () => handleLabelTemplateCreate(input), [input]));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_DELETE, (_e, id: string) =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATE_DELETE, () => handleLabelTemplateDelete(id), [id]));
  ipcMain.handle(IPC_CHANNELS.LABEL_TEMPLATE_SET_DEFAULT, (_e, id: string) =>
    withCloud(IPC_CHANNELS.LABEL_TEMPLATE_SET_DEFAULT, () => handleLabelTemplateSetDefault(id), [id]));

  registerAppConfigHandlers();
  registerUpdaterHandlers();
}
