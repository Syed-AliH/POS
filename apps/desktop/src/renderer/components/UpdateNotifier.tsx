import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@mama-babi/ui';
import type { UpdateStatusPayload } from '@shared/update';

export function UpdateNotifier() {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron?.updater?.onStatus((next) => {
      setStatus(next);
      if (next.phase === 'not-available' || next.phase === 'idle') {
        setStatus(null);
      }
    });
    return unsubscribe;
  }, []);

  if (!status || status.phase === 'checking' || status.phase === 'error') {
    return null;
  }

  if (status.phase === 'available' || status.phase === 'downloading') {
    const percent = Math.round(status.percent ?? 0);
    return (
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-lg dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
        <Download className="h-4 w-4 shrink-0 animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {status.phase === 'available'
              ? `Downloading v${status.version ?? ''}…`
              : `Downloading update (${percent}%)`}
          </p>
          {status.phase === 'downloading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
              <div
                className="h-full rounded-full bg-blue-600 transition-all dark:bg-blue-400"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status.phase === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 shadow-lg dark:border-green-900 dark:bg-green-950 dark:text-green-100">
        <RefreshCw className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Update v{status.version} ready</p>
          <p className="text-xs opacity-80">Restart to finish installing.</p>
        </div>
        <Button
          size="sm"
          onClick={() => void window.electron?.updater?.installUpdate()}
        >
          Restart
        </Button>
      </div>
    );
  }

  return null;
}
