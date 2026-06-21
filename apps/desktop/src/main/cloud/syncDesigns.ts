import type { LabelTemplateSummary, ReceiptTemplate } from '@shared/types';
import { getCloudApiUrl } from './config';
import { getAuthToken } from './sessionStore';
import {
  applyLabelTemplatesToLocal,
  applyReceiptTemplatesToLocal,
} from './templateCache';

/** Pull receipt + label designs from cloud into local SQLite (for printing). */
export async function syncDesignCacheFromCloud(authToken?: string | null): Promise<void> {
  const base = getCloudApiUrl();
  const token = authToken ?? getAuthToken();
  if (!base || !token) return;

  const headers = { Authorization: `Bearer ${token}` };

  const [receiptRes, labelRes] = await Promise.all([
    fetch(`${base.replace(/\/$/, '')}/api/v1/receipt-templates`, { headers }),
    fetch(`${base.replace(/\/$/, '')}/api/v1/label-templates`, { headers }),
  ]);

  const receiptJson = (await receiptRes.json()) as { success: boolean; data?: ReceiptTemplate[] };
  const labelJson = (await labelRes.json()) as { success: boolean; data?: LabelTemplateSummary[] };

  if (receiptJson.success && receiptJson.data?.length) {
    applyReceiptTemplatesToLocal(receiptJson.data);
  }
  if (labelJson.success && labelJson.data?.length) {
    applyLabelTemplatesToLocal(labelJson.data);
  }
}
