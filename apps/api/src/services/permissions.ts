// Shared permission constants for the API layer.
// Keep in sync with apps/desktop/src/shared/permissions.ts

export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  SALES_CREATE: 'sales.create',
  SALES_EDIT: 'sales.edit',
  SALES_CANCEL: 'sales.cancel',
  SALES_RETURN: 'sales.return',
  SALES_HISTORY: 'sales.history',
  SALES_PRINT_RECEIPT: 'sales.print_receipt',
  SALES_REPRINT_RECEIPT: 'sales.reprint_receipt',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',
  PRODUCTS_IMPORT: 'products.import',
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_CREATE: 'categories.create',
  CATEGORIES_EDIT: 'categories.edit',
  CATEGORIES_DELETE: 'categories.delete',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_STOCK_IN: 'inventory.stock_in',
  INVENTORY_STOCK_OUT: 'inventory.stock_out',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_STOCKTAKE: 'inventory.stocktake',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',
  VENDORS_VIEW: 'vendors.view',
  VENDORS_CREATE: 'vendors.create',
  VENDORS_EDIT: 'vendors.edit',
  VENDORS_DELETE: 'vendors.delete',
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_EDIT: 'purchases.edit',
  PURCHASES_DELETE: 'purchases.delete',
  REPORTS_SALES: 'reports.sales',
  REPORTS_PROFIT: 'reports.profit',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_CUSTOMERS: 'reports.customers',
  PRINT_RECEIPT: 'print.receipt',
  PRINT_LABELS: 'print.labels',
  PRINT_REPRINT: 'print.reprint',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_MANAGE_PERMISSIONS: 'users.manage_permissions',
  ADMIN_BACKUP: 'admin.backup',
  ADMIN_RESTORE: 'admin.restore',
  ADMIN_SYSTEM_CONFIG: 'admin.system_config',
} as const;

type PermissionKey = keyof typeof PERMISSIONS;
export type Permission = (typeof PERMISSIONS)[PermissionKey];

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const MANAGER_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_EDIT, PERMISSIONS.SALES_CANCEL,
  PERMISSIONS.SALES_RETURN, PERMISSIONS.SALES_HISTORY,
  PERMISSIONS.SALES_PRINT_RECEIPT, PERMISSIONS.SALES_REPRINT_RECEIPT,
  PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_EDIT,
  PERMISSIONS.PRODUCTS_IMPORT,
  PERMISSIONS.CATEGORIES_VIEW, PERMISSIONS.CATEGORIES_CREATE, PERMISSIONS.CATEGORIES_EDIT,
  PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_STOCK_IN, PERMISSIONS.INVENTORY_STOCK_OUT,
  PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_STOCKTAKE,
  PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT,
  PERMISSIONS.VENDORS_VIEW, PERMISSIONS.VENDORS_CREATE, PERMISSIONS.VENDORS_EDIT,
  PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_CREATE, PERMISSIONS.PURCHASES_EDIT,
  PERMISSIONS.REPORTS_SALES, PERMISSIONS.REPORTS_PROFIT,
  PERMISSIONS.REPORTS_INVENTORY, PERMISSIONS.REPORTS_CUSTOMERS,
  PERMISSIONS.PRINT_RECEIPT, PERMISSIONS.PRINT_LABELS, PERMISSIONS.PRINT_REPRINT,
  PERMISSIONS.SETTINGS_VIEW,
  PERMISSIONS.ADMIN_BACKUP,
];

const CASHIER_PERMISSIONS: Permission[] = [
  PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_PRINT_RECEIPT,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_CREATE,
  PERMISSIONS.PRINT_RECEIPT,
];

const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  cashier: CASHIER_PERMISSIONS,
};

export function getDefaultPermissions(role: string): Permission[] {
  return ROLE_DEFAULT_PERMISSIONS[role] ?? CASHIER_PERMISSIONS;
}

export function hasPermission(permissions: string[], key: Permission): boolean {
  return permissions.includes(key);
}
