// All permission keys in the system.
// Each key is namespaced as "module.action".
// These are stored in users.permissionsJson as a string[].

export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard.view',

  // Sales / Checkout
  SALES_CREATE: 'sales.create',
  SALES_EDIT: 'sales.edit',
  SALES_CANCEL: 'sales.cancel',
  SALES_RETURN: 'sales.return',
  SALES_HISTORY: 'sales.history',
  SALES_PRINT_RECEIPT: 'sales.print_receipt',
  SALES_REPRINT_RECEIPT: 'sales.reprint_receipt',

  // Products
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',
  PRODUCTS_IMPORT: 'products.import',

  // Categories
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_CREATE: 'categories.create',
  CATEGORIES_EDIT: 'categories.edit',
  CATEGORIES_DELETE: 'categories.delete',

  // Inventory / GRN
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_STOCK_IN: 'inventory.stock_in',
  INVENTORY_STOCK_OUT: 'inventory.stock_out',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_STOCKTAKE: 'inventory.stocktake',

  // Customers
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',

  // Vendors / Suppliers
  VENDORS_VIEW: 'vendors.view',
  VENDORS_CREATE: 'vendors.create',
  VENDORS_EDIT: 'vendors.edit',
  VENDORS_DELETE: 'vendors.delete',

  // Purchases / Purchase Orders
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_EDIT: 'purchases.edit',
  PURCHASES_DELETE: 'purchases.delete',

  // Reports
  REPORTS_SALES: 'reports.sales',
  REPORTS_PROFIT: 'reports.profit',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_CUSTOMERS: 'reports.customers',

  // Printing
  PRINT_RECEIPT: 'print.receipt',
  PRINT_LABELS: 'print.labels',
  PRINT_REPRINT: 'print.reprint',

  // Settings
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',

  // User Management
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_MANAGE_PERMISSIONS: 'users.manage_permissions',

  // Administration
  ADMIN_BACKUP: 'admin.backup',
  ADMIN_RESTORE: 'admin.restore',
  ADMIN_SYSTEM_CONFIG: 'admin.system_config',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// All permissions grouped for the UI permission matrix
export const PERMISSION_GROUPS: Array<{
  label: string;
  permissions: Array<{ key: Permission; label: string }>;
}> = [
  {
    label: 'Dashboard',
    permissions: [{ key: PERMISSIONS.DASHBOARD_VIEW, label: 'View Dashboard' }],
  },
  {
    label: 'Sales',
    permissions: [
      { key: PERMISSIONS.SALES_CREATE, label: 'Create Sale' },
      { key: PERMISSIONS.SALES_EDIT, label: 'Edit Sale' },
      { key: PERMISSIONS.SALES_CANCEL, label: 'Cancel Sale' },
      { key: PERMISSIONS.SALES_RETURN, label: 'Return Sale' },
      { key: PERMISSIONS.SALES_HISTORY, label: 'View Sales History' },
      { key: PERMISSIONS.SALES_PRINT_RECEIPT, label: 'Print Receipt' },
      { key: PERMISSIONS.SALES_REPRINT_RECEIPT, label: 'Reprint Receipt' },
    ],
  },
  {
    label: 'Products',
    permissions: [
      { key: PERMISSIONS.PRODUCTS_VIEW, label: 'View Products' },
      { key: PERMISSIONS.PRODUCTS_CREATE, label: 'Add Product' },
      { key: PERMISSIONS.PRODUCTS_EDIT, label: 'Edit Product' },
      { key: PERMISSIONS.PRODUCTS_DELETE, label: 'Delete Product' },
      { key: PERMISSIONS.PRODUCTS_IMPORT, label: 'Import Products' },
    ],
  },
  {
    label: 'Categories',
    permissions: [
      { key: PERMISSIONS.CATEGORIES_VIEW, label: 'View' },
      { key: PERMISSIONS.CATEGORIES_CREATE, label: 'Create' },
      { key: PERMISSIONS.CATEGORIES_EDIT, label: 'Edit' },
      { key: PERMISSIONS.CATEGORIES_DELETE, label: 'Delete' },
    ],
  },
  {
    label: 'Inventory',
    permissions: [
      { key: PERMISSIONS.INVENTORY_VIEW, label: 'View Inventory' },
      { key: PERMISSIONS.INVENTORY_STOCK_IN, label: 'Stock In (GRN)' },
      { key: PERMISSIONS.INVENTORY_STOCK_OUT, label: 'Stock Out' },
      { key: PERMISSIONS.INVENTORY_ADJUST, label: 'Adjustments' },
      { key: PERMISSIONS.INVENTORY_STOCKTAKE, label: 'Stocktake' },
    ],
  },
  {
    label: 'Customers',
    permissions: [
      { key: PERMISSIONS.CUSTOMERS_VIEW, label: 'View' },
      { key: PERMISSIONS.CUSTOMERS_CREATE, label: 'Add' },
      { key: PERMISSIONS.CUSTOMERS_EDIT, label: 'Edit' },
      { key: PERMISSIONS.CUSTOMERS_DELETE, label: 'Delete' },
    ],
  },
  {
    label: 'Vendors / Suppliers',
    permissions: [
      { key: PERMISSIONS.VENDORS_VIEW, label: 'View' },
      { key: PERMISSIONS.VENDORS_CREATE, label: 'Add' },
      { key: PERMISSIONS.VENDORS_EDIT, label: 'Edit' },
      { key: PERMISSIONS.VENDORS_DELETE, label: 'Delete' },
    ],
  },
  {
    label: 'Purchases',
    permissions: [
      { key: PERMISSIONS.PURCHASES_VIEW, label: 'View' },
      { key: PERMISSIONS.PURCHASES_CREATE, label: 'Create' },
      { key: PERMISSIONS.PURCHASES_EDIT, label: 'Edit' },
      { key: PERMISSIONS.PURCHASES_DELETE, label: 'Delete' },
    ],
  },
  {
    label: 'Reports',
    permissions: [
      { key: PERMISSIONS.REPORTS_SALES, label: 'Sales Reports' },
      { key: PERMISSIONS.REPORTS_PROFIT, label: 'Profit Reports' },
      { key: PERMISSIONS.REPORTS_INVENTORY, label: 'Inventory Reports' },
      { key: PERMISSIONS.REPORTS_CUSTOMERS, label: 'Customer Reports' },
    ],
  },
  {
    label: 'Printing',
    permissions: [
      { key: PERMISSIONS.PRINT_RECEIPT, label: 'Print Receipt' },
      { key: PERMISSIONS.PRINT_LABELS, label: 'Print Labels' },
      { key: PERMISSIONS.PRINT_REPRINT, label: 'Reprint Receipt' },
    ],
  },
  {
    label: 'Settings',
    permissions: [
      { key: PERMISSIONS.SETTINGS_VIEW, label: 'View Settings' },
      { key: PERMISSIONS.SETTINGS_EDIT, label: 'Edit Settings' },
    ],
  },
  {
    label: 'User Management',
    permissions: [
      { key: PERMISSIONS.USERS_VIEW, label: 'View Users' },
      { key: PERMISSIONS.USERS_CREATE, label: 'Create Users' },
      { key: PERMISSIONS.USERS_EDIT, label: 'Edit Users' },
      { key: PERMISSIONS.USERS_DELETE, label: 'Delete Users' },
      { key: PERMISSIONS.USERS_RESET_PASSWORD, label: 'Reset Passwords' },
      { key: PERMISSIONS.USERS_MANAGE_PERMISSIONS, label: 'Manage Permissions' },
    ],
  },
  {
    label: 'Administration',
    permissions: [
      { key: PERMISSIONS.ADMIN_BACKUP, label: 'Backup Database' },
      { key: PERMISSIONS.ADMIN_RESTORE, label: 'Restore Database' },
      { key: PERMISSIONS.ADMIN_SYSTEM_CONFIG, label: 'System Configuration' },
    ],
  },
];

// Default permissions for each role
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

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  cashier: CASHIER_PERMISSIONS,
};

export function getDefaultPermissions(role: string): Permission[] {
  return ROLE_DEFAULT_PERMISSIONS[role] ?? CASHIER_PERMISSIONS;
}

export function hasPermission(permissions: Permission[] | string[] | null | undefined, key: Permission): boolean {
  if (!permissions) return false;
  return (permissions as string[]).includes(key);
}
