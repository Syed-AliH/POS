import type { ApiResult, LabelTemplateSummary, ReceiptTemplate, UserSession } from '@shared/types';
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

async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<ApiResult<T>> {
  const base = getCloudApiUrl();
  if (!base) return { success: false, error: 'CLOUD_API_URL not configured' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && getAuthToken()) headers.Authorization = `Bearer ${getAuthToken()}`;

  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json()) as ApiResult<T> & { data?: T & { token?: string } };
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
  [IPC_CHANNELS.SETTINGS_SET]: async (input: unknown) =>
    apiFetch<Record<string, string>>('PATCH', '/api/v1/settings', input),

  [IPC_CHANNELS.PRODUCT_SEARCH]: async (query: unknown) =>
    apiFetch('GET', `/api/v1/products/search?q=${encodeURIComponent(String(query))}`),
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
  [IPC_CHANNELS.PRODUCT_UPDATE]: async (id: unknown, input: unknown) =>
    apiFetch('PATCH', `/api/v1/products/${id}`, input),
  [IPC_CHANNELS.PRODUCT_BARCODE_LOOKUP]: async (barcode: unknown) =>
    apiFetch('GET', `/api/v1/products/barcode/${encodeURIComponent(String(barcode))}`),

  [IPC_CHANNELS.CATEGORY_LIST]: async () => apiFetch('GET', '/api/v1/categories'),
  [IPC_CHANNELS.CATEGORY_CREATE]: async (name: unknown, color?: unknown, skuPrefix?: unknown) =>
    apiFetch('POST', '/api/v1/categories', { name, color, skuPrefix }),

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
  [IPC_CHANNELS.SALE_DISCARD_HELD]: async (id: unknown) =>
    apiFetch('POST', `/api/v1/sales/${id}/discard-held`, {}),
  [IPC_CHANNELS.SALE_RESUME]: async (key: unknown) =>
    apiFetch('GET', `/api/v1/sales/resume/${encodeURIComponent(String(key))}`),

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
