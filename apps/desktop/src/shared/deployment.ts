/** Fixed local API URL when the installer bundles and auto-starts the API. */
export const BUNDLED_API_URL = 'http://127.0.0.1:3001';

export const BUNDLED_API_PORT = 3001;

export type DeploymentMode = 'bundled' | 'remote';

export function isBundledMode(mode: string | undefined): boolean {
  return mode === 'bundled';
}
