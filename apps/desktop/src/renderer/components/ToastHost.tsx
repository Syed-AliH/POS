import { useToastStore } from '../stores/toastStore';

const styles: Record<string, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-800 text-white',
  warning: 'bg-amber-500 text-white',
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg shadow-lg text-sm flex justify-between gap-3 items-start animate-in ${styles[t.type]}`}
        >
          <span>{t.message}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100 shrink-0">×</button>
        </div>
      ))}
    </div>
  );
}
