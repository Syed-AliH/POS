import { cn } from './cn';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400', className)} role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600 dark:border-slate-600 dark:border-t-primary-400" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
