import { isCloudMode } from '../cloud/config';
import { hasCloudHandler, invokeCloud } from '../cloud/client';

export async function withCloud<T>(
  channel: string,
  local: () => T | Promise<T>,
  args: unknown[] = [],
): Promise<T> {
  if (isCloudMode() && hasCloudHandler(channel)) {
    return invokeCloud(channel, args) as Promise<T>;
  }
  return local();
}
