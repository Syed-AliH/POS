import type { AdvancedProductSearchInput, ApiResult, LabelTemplateSummary, Product, ReceiptTemplate, UserSession } from '@shared/types';
import { filterProductsByAdvancedSearch } from '@shared/productSearch';
import { perfEnabled, timeAsync } from '@shared/perf';
import { setSession } from '../session';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { getCloudApiUrl } from './config';
import { getAuthToken, getCloudSession, setCloudSession } from './sessionStore';
import { syncDesignCacheFromCloud } from './syncDesigns';
import {
  applyLabelTemplatesToLocal,
  applyReceiptTemplatesToLocal,
  removeLabelTemplateLocal,
  upsertLabelTemplateLocal,
  upsertReceiptTemplateLocal,
} from './templateCache';

export { getCloudSession, getAuthToken } from './sessionStore';

/** Long enough for a slow Supabase round trip, short enough that a wedged call surfaces. */
const REQUEST_TIMEOUT_MS = 30_000;

export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<ApiResult<T>> {
  if (!perfEnabled()) return apiFetchInner(method, path, body, auth);
  // Strip ids from the path so timings aggregate per route, not per record.
  const route = path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:id').split('?')[0];
  return timeAsync(`api ${method} ${route}`, () => apiFetchInner<T>(method, path, body, auth));
}

async function apiFetchInner<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<ApiResult<T>> {
  const base = getCloudApiUrl();
  if (!base) return { success: false, error: 'Server not configured. Set API URL in config.json.' };

  // Connection reuse and gzip negotiation are handled by undici's global dispatcher
  // (keep-alive + accept-encoding are set automatically and cannot be overridden here).
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && getAuthToken()) headers.Authorization = `Bearer ${getAuthToken()}`;

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A hung request must not wedge the till; the caller surfaces the error.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { success: false, error: 'The server took too long to respond. Please try again.' };
    }
    const isNetworkErr =
      err instanceof TypeError &&
      (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('ECONNREFUSED'));
    if (isNetworkErr) {
      return { success: false, error: 'Cannot reach the server. Check your internet connection.' };
    }
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }

  // Handle 401 — expired or invalid token
  if (res.status === 401) {
    setCloudSession(null);
    return { success: false, error: 'Session expired. Please log in again.' };
  }

  let json: ApiResult<T>;
  try {
    json = (await res.json()) as ApiResult<T> & { data?: T & { token?: string } };
  } catch {
    return { success: false, error: `Server returned an unexpected response (HTTP ${res.status})` };
  }

  if (!res.ok && !json.success) {
    const details = (json as { details?: Array<{ field?: string; message: string }> }).details;
    const detailMsg = details?.map((d) => d.message).filter(Boolean).join('; ');
    if (res.status === 404) {
      return {
        success: false,
        error: json.error ?? detailMsg ?? 'API route not found — restart the app after running pnpm build:api',
      };
    }
    if (res.status === 422) {
      return {
        success: false,
        error: detailMsg || json.error || 'Validation failed',
      };
    }
    return { success: false, error: json.error ?? detailMsg ?? `Request failed (HTTP ${res.status})` };
  }

  if (!res.ok) {
    if (res.status === 404) {
      return { success: false, error: 'API route not found — restart the app after running pnpm build:api' };
    }
    return { success: false, error: `Request failed (HTTP ${res.status})` };
  }

  return json;
}

type CloudHandler = (...args: unknown[]) => Promise<unknown>;

const handlers: Partial<Record<string, CloudHandler>> = {
  [IPC_CHANNELS.AUTH_LOGIN]: async (username, password) => {
    const result = await apiFetch<UserSession & { token: string }>(
      'POST',
      '/api/v1/auth/login',
      { username, password },
      false,
    );
    if (!result.success || !result.data) return result;
    const { token, ...session } = result.data as UserSession & { token: string };
    setCloudSession(session, token);
    setSession(session);
    await syncDesignCacheFromCloud(token);
    return { success: true, data: session };
  },

  [IPC_CHANNELS.AUTH_LOGOUT]: async () => {
    await apiFetch('POST', '/api/v1/auth/logout');
    setCloudSession(null);
    setSession(null);
    return { success: true, data: undefined };
  },

  [IPC_CHANNELS.AUTH_GET_SESSION]: async () => ({
    success: true,
    data: getCloudSession(),
  }),

  [IPC_CHANNELS.AUTH_VERIFY_MANAGER_PIN]: async () =>
    apiFetch<boolean>('POST', '/api/v1/auth/verify-manager-pin', {}),

  [IPC_CHANNELS.SETTINGS_GET_ALL]: async () => apiFetch<Record<string, string>>('GET', '/api/v1/settings'),
  [IPC_CHANNELS.SETTINGS_GET]: async (key: unknown) =>
    apiFetch<string | null>('GET', `/api/v1/settings/${encodeURIComponent(String(key))}`),
  [IPC_CHANNELS.SETTINGS_SET]: async (input: unknown) => {
    const wrapped = input as { settings?: Record<string, string> };
    const body = wrapped.settings ?? (input as Record<string, string>);
    return apiFetch<Record<string, string>>('PATCH', '/api/v1/settings', body);
  },

  [IPC_CHANNELS.PRODUCT_SEARCH]: async (query: unknown) =>
    apiFetch('GET', `/api/v1/products/search?q=${encodeURIComponent(String(query))}`),
  [IPC_CHANNELS.PRODUCT_ADVANCED_SEARCH]: async (input: unknown) => {
    const filters = (input ?? {}) as AdvancedProductSearchInput;
    const remote = await apiFetch<Product[]>('POST', '/api/v1/products/search/advanced', filters);
    if (remote.success) return remote;
    // Fallback for older API builds without the advanced endpoint.
    const qs = new URLSearchParams({ status: 'active', limit: '500' });
    const list = await apiFetch<Product[]>('GET', `/api/v1/products?${qs}`);
    if (!list.success) return list;
    const active = (list.data ?? []).filter((p) => p.status === 'active');
    return { success: true as const, data: filterProductsByAdvancedSearch(active, filters) };
  },
  [IPC_CHANNELS.PRODUCT_LIST]: async (params: unknown) => {
    const p = (params ?? {}) as { status?: string; limit?: number };
    const qs = new URLSearchParams();
    if (p.status) qs.set('status', p.status);
    if (p.limit) qs.set('limit', String(p.limit));
    return apiFetch('GET', `/api/v1/products?${qs}`);
  },
  [IPC_CHANNELS.PRODUCT_GET]: async (id: unknown) =>
    apiFetch('GET', `/api/v1/products/${id}`),
  [IPC_CHANNELS.PRODUCT_CREATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/products', input),
  [IPC_CHANNELS.PRODUCT_IMPORT_ROWS]: async (rows: unknown) =>
    apiFetch('POST', '/api/v1/products/import', { rows }),
  [IPC_CHANNELS.PRODUCT_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/products/${id}`, input),
  [IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP]: async (barcode: unknown) =>
    apiFetch('GET', `/api/v1/products/barcode/${encodeURIComponent(String(barcode))}`),
  [IPC_CHANNELS.PRODUCT_BULK_PRICE_INCREASE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/products/bulk-price-increase', input),
  [IPC_CHANNELS.PRODUCT_BULK_PRICE_REVERT]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/products/bulk-price-revert', input),
  [IPC_CHANNELS.PRODUCT_HISTORY]: async (productId: unknown) =>
    apiFetch('GET', `/api/v1/products/${encodeURIComponent(String(productId))}/history`),

  [IPC_CHANNELS.CATEGORY_LIST]: async () => apiFetch('GET', '/api/v1/categories'),
  [IPC_CHANNELS.CATEGORY_CREATE]: async (name: unknown, color?: unknown, skuPrefix?: unknown) =>
    apiFetch('POST', '/api/v1/categories', { name: String(name ?? '').trim(), color, skuPrefix }),
  [IPC_CHANNELS.CATEGORY_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/categories/${id}`, input),

  [IPC_CHANNELS.VENDOR_LIST]: async () => apiFetch('GET', '/api/v1/vendors'),
  [IPC_CHANNELS.VENDOR_CREATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/vendors', input),
  [IPC_CHANNELS.VENDOR_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/vendors/${id}`, input),

  [IPC_CHANNELS.GRN_CREATE]: async (input: unknown) => apiFetch('POST', '/api/v1/grn', input),
  [IPC_CHANNELS.GRN_LIST]: async (params: unknown) => {
    const p = (params ?? {}) as Record<string, string | number | undefined>;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v != null && v !== '') qs.set(k, String(v));
    }
    return apiFetch('GET', `/api/v1/grn?${qs}`);
  },
  [IPC_CHANNELS.GRN_GET]: async (id: unknown) => apiFetch('GET', `/api/v1/grn/${id}`),
  [IPC_CHANNELS.GRN_FINALIZE]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/grn/${id}/finalize`, {}),
  [IPC_CHANNELS.GRN_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/grn/${id}`, input),
  [IPC_CHANNELS.GRN_CANCEL]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/grn/${id}/cancel`, {}),
  [IPC_CHANNELS.GRN_VOID]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/grn/${id}/void`, {}),

  [IPC_CHANNELS.SALE_CREATE]: async (input: unknown) => apiFetch('POST', '/api/v1/sales', input),
  [IPC_CHANNELS.SALE_LIST]: async (params: unknown) => {
    const p = (params ?? {}) as Record<string, string | number | undefined>;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v != null && v !== '') qs.set(k, String(v));
    }
    return apiFetch('GET', `/api/v1/sales?${qs}`);
  },
  [IPC_CHANNELS.SALE_GET]: async (id: unknown) => apiFetch('GET', `/api/v1/sales/${id}`),
  [IPC_CHANNELS.SALE_UPDATE]: async (input: unknown) => {
    const { saleId, ...body } = (input ?? {}) as { saleId: string };
    return apiFetch('PATCH', `/api/v1/sales/${saleId}`, body);
  },
  [IPC_CHANNELS.SALE_VOID]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/sales/${id}/void`, {}),
  [IPC_CHANNELS.SALE_DISCARD_HELD]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/sales/${id}/discard-held`, {}),
  [IPC_CHANNELS.SALE_RESUME]: async (key: unknown) =>
    apiFetch('GET', `/api/v1/sales/resume/${encodeURIComponent(String(key))}`),
  [IPC_CHANNELS.SALE_LOOKUP]: async (saleNumber: unknown) =>
    apiFetch('GET', `/api/v1/sales/lookup/${encodeURIComponent(String(saleNumber))}`),
  [IPC_CHANNELS.SALE_RECEIPT_PREVIEW]: async (saleId: unknown) =>
    apiFetch('GET', `/api/v1/sales/${saleId}/receipt-preview`),

  [IPC_CHANNELS.RETURN_LIST]: async (params: unknown) => {
    const p = (params ?? {}) as Record<string, string | number | undefined>;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v != null && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch('GET', `/api/v1/returns${suffix}`);
  },
  [IPC_CHANNELS.RETURN_CREATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/returns', input),

  [IPC_CHANNELS.REPORT_PROFIT]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    return apiFetch('GET', `/api/v1/reports/profit?${qs}`);
  },

  [IPC_CHANNELS.REPORT_DAILY_SALES]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    return apiFetch('GET', `/api/v1/reports/daily-sales?${qs}`);
  },

  [IPC_CHANNELS.REPORT_EOD]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    return apiFetch('GET', `/api/v1/reports/eod?${qs}`);
  },

  [IPC_CHANNELS.REPORT_SALES_BY_CATEGORY]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    return apiFetch('GET', `/api/v1/reports/sales-by-category?${qs}`);
  },

  [IPC_CHANNELS.REPORT_TOP_PRODUCTS]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string; limit?: number };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    if (p.limit != null) qs.set('limit', String(p.limit));
    return apiFetch('GET', `/api/v1/reports/top-products?${qs}`);
  },

  [IPC_CHANNELS.REPORT_PAYMENT_BREAKDOWN]: async (params: unknown) => {
    const p = (params ?? {}) as { startDate?: string; endDate?: string };
    const qs = new URLSearchParams();
    if (p.startDate) qs.set('startDate', p.startDate);
    if (p.endDate) qs.set('endDate', p.endDate);
    return apiFetch('GET', `/api/v1/reports/payment-breakdown?${qs}`);
  },

  [IPC_CHANNELS.REPORT_INVENTORY_VALUATION]: async () =>
    apiFetch('GET', '/api/v1/reports/inventory-valuation'),

  [IPC_CHANNELS.REPORT_INVENTORY]: async (params: unknown) => {
    const p = (params ?? {}) as { search?: string; categoryId?: string; stockFilter?: string };
    const qs = new URLSearchParams();
    if (p.search) qs.set('search', p.search);
    if (p.categoryId) qs.set('categoryId', p.categoryId);
    if (p.stockFilter) qs.set('stockFilter', p.stockFilter);
    return apiFetch('GET', `/api/v1/reports/inventory?${qs}`);
  },

  [IPC_CHANNELS.PROMO_CODE_LIST]: async () => apiFetch('GET', '/api/v1/promo-codes'),
  [IPC_CHANNELS.PROMO_CODE_CREATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/promo-codes', input),
  [IPC_CHANNELS.PROMO_CODE_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/promo-codes/${id}`, input),
  [IPC_CHANNELS.PROMO_CODE_DELETE]: async (id: unknown) =>
    apiFetch('DELETE', `/api/v1/promo-codes/${id}`),
  [IPC_CHANNELS.PROMO_CODE_VALIDATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/promo-codes/validate', input),
  [IPC_CHANNELS.PROMO_CODE_REDEEM]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/promo-codes/${id}/redeem`, {}),

  [IPC_CHANNELS.CUSTOMER_SEARCH]: async (query: unknown) =>
    apiFetch('GET', `/api/v1/customers/search?q=${encodeURIComponent(String(query))}`),
  [IPC_CHANNELS.CUSTOMER_LIST]: async (limit: unknown) => {
    const qs = new URLSearchParams();
    if (limit != null) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch('GET', `/api/v1/customers${suffix}`);
  },
  [IPC_CHANNELS.CUSTOMER_GET]: async (id: unknown) =>
    apiFetch('GET', `/api/v1/customers/${id}`),
  [IPC_CHANNELS.CUSTOMER_CREATE]: async (input: unknown) =>
    apiFetch('POST', '/api/v1/customers', input),
  [IPC_CHANNELS.CUSTOMER_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/customers/${id}`, input),
  [IPC_CHANNELS.LOYALTY_RULES]: async () => apiFetch('GET', '/api/v1/loyalty-rules'),
  [IPC_CHANNELS.LOYALTY_RULES_UPDATE]: async (input: unknown) =>
    apiFetch('PUT', '/api/v1/loyalty-rules', input),

  [IPC_CHANNELS.RECEIPT_TEMPLATES]: async () => {
    const result = await apiFetch<ReceiptTemplate[]>('GET', '/api/v1/receipt-templates');
    if (result.success && result.data) applyReceiptTemplatesToLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.RECEIPT_TEMPLATE_UPDATE]: async (id: unknown, input: unknown) => {
    const result = await apiFetch<ReceiptTemplate>(
      'PATCH',
      `/api/v1/receipt-templates/${id}`,
      input,
    );
    if (result.success && result.data) upsertReceiptTemplateLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATES]: async () => {
    const result = await apiFetch<LabelTemplateSummary[]>('GET', '/api/v1/label-templates');
    if (result.success && result.data) applyLabelTemplatesToLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATE_GET]: async (id: unknown) => {
    const result = await apiFetch<LabelTemplateSummary>('GET', `/api/v1/label-templates/${id}`);
    if (result.success && result.data) upsertLabelTemplateLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATE_UPDATE]: async (id: unknown, input: unknown) => {
    const result = await apiFetch<LabelTemplateSummary>(
      'PATCH',
      `/api/v1/label-templates/${id}`,
      input,
    );
    if (result.success && result.data) upsertLabelTemplateLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATE_CREATE]: async (input: unknown) => {
    const result = await apiFetch<LabelTemplateSummary>('POST', '/api/v1/label-templates', input);
    if (result.success && result.data) upsertLabelTemplateLocal(result.data);
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATE_DELETE]: async (id: unknown) => {
    const result = await apiFetch<void>('DELETE', `/api/v1/label-templates/${id}`);
    if (result.success) removeLabelTemplateLocal(String(id));
    return result;
  },

  [IPC_CHANNELS.LABEL_TEMPLATE_SET_DEFAULT]: async (id: unknown) => {
    const result = await apiFetch<LabelTemplateSummary>(
      'POST',
      `/api/v1/label-templates/${id}/set-default`,
      {},
    );
    if (result.success && result.data) {
      const all = await apiFetch<LabelTemplateSummary[]>('GET', '/api/v1/label-templates');
      if (all.success && all.data) applyLabelTemplatesToLocal(all.data);
    }
    return result;
  },

  // User management (cloud mode routes to API)
  [IPC_CHANNELS.STAFF_LIST]: async () => apiFetch('GET', '/api/v1/users'),
  [IPC_CHANNELS.STAFF_GET]: async (id: unknown) => apiFetch('GET', `/api/v1/users/${id}`),
  [IPC_CHANNELS.STAFF_CREATE]: async (input: unknown) => apiFetch('POST', '/api/v1/users', input),
  [IPC_CHANNELS.STAFF_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/users/${id}`, input),
  [IPC_CHANNELS.STAFF_DELETE]: async (id: unknown) =>
    apiFetch('DELETE', `/api/v1/users/${id}`),
  [IPC_CHANNELS.STAFF_RESET_PASSWORD]: async (id: unknown, input: unknown) =>
    apiFetch('POST', `/api/v1/users/${id}/reset-password`, input),
};

export function hasCloudHandler(channel: string): boolean {
  return !!handlers[channel];
}

export async function invokeCloud(channel: string, args: unknown[]): Promise<unknown> {
  const handler = handlers[channel];
  if (!handler) {
    return { success: false, error: `Cloud mode: ${channel} not available yet` };
  }
  return handler(...args);
}

export async function fetchCloudSale(saleId: string) {
  return apiFetch<import('@shared/types').SaleSummary>('GET', `/api/v1/sales/${saleId}`);
}
