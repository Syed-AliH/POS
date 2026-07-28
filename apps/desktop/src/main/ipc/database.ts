import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { validatePasswordInput, type DatabaseConnectionInfo } from '@shared/databaseUrl';
import {
  describeConnection,
  savePassword,
  testConnection,
} from '../services/dbCredentials';
import { getBaseDatabaseUrl, restartBundledApi } from '../localApi/server';
import { isBundledDeployment } from '../cloud/config';

type Result<T> = { success: true; data: T } | { success: false; error: string };

const NO_CONFIG_ERROR =
  'No database connection is configured on this machine. Reinstall the app or contact support.';

function baseUrlOrNull(): string | null {
  try {
    return getBaseDatabaseUrl();
  } catch {
    // loadApiSecrets throws when secrets.json and .env are both missing.
    return null;
  }
}

function handleGetConfig(): Result<DatabaseConnectionInfo & { editable: boolean }> {
  const baseUrl = baseUrlOrNull();
  if (!baseUrl) return { success: false, error: NO_CONFIG_ERROR };

  const info = describeConnection(baseUrl);
  if (!info) {
    return { success: false, error: 'The configured connection URL is malformed. Contact support.' };
  }

  // Only the bundled deployment spawns its own API, so only it can apply a new
  // password locally. In remote mode the server owns its own credentials.
  return { success: true, data: { ...info, editable: isBundledDeployment() } };
}

async function handleTestConnection(password: string): Promise<Result<{ ok: true }>> {
  const validationError = validatePasswordInput(password);
  if (validationError) return { success: false, error: validationError };

  const baseUrl = baseUrlOrNull();
  if (!baseUrl) return { success: false, error: NO_CONFIG_ERROR };

  const result = await testConnection(baseUrl, password);
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, data: { ok: true } };
}

/**
 * Validate first, persist only on success, then restart the API so the new
 * password is live. A failure at any step leaves the previous config untouched.
 */
async function handleSavePassword(password: string): Promise<Result<{ restarted: boolean }>> {
  const validationError = validatePasswordInput(password);
  if (validationError) return { success: false, error: validationError };

  if (!isBundledDeployment()) {
    return {
      success: false,
      error:
        'This machine connects to a remote server, so the database password is managed there, not here.',
    };
  }

  const baseUrl = baseUrlOrNull();
  if (!baseUrl) return { success: false, error: NO_CONFIG_ERROR };

  const verified = await testConnection(baseUrl, password);
  if (!verified.ok) return { success: false, error: verified.error };

  const saved = savePassword(password);
  if (!saved.ok) return { success: false, error: saved.error };

  try {
    await restartBundledApi();
    return { success: true, data: { restarted: true } };
  } catch (err) {
    // The password is stored and verified; only the restart failed, so a manual
    // restart will pick it up. Say so plainly instead of implying data loss.
    console.error('[database] API restart after password change failed:', err);
    return {
      success: true,
      data: { restarted: false },
    };
  }
}

export function registerDatabaseHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DB_GET_CONFIG, () => handleGetConfig());
  ipcMain.handle(IPC_CHANNELS.DB_TEST_CONNECTION, (_e, password: string) =>
    handleTestConnection(password),
  );
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_PASSWORD, (_e, password: string) =>
    handleSavePassword(password),
  );
}
