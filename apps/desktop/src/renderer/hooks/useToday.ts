import { useEffect, useState } from 'react';
import { localCalendarDate } from '@shared/datetime';

/**
 * Today's local date (YYYY-MM-DD) that changes by itself at midnight. A till is often
 * left open overnight; screens built on "today" — the Expenses tab, Day Close — must
 * start a fresh day on their own rather than keep adding to yesterday.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localCalendarDate());
  useEffect(() => {
    // Checked each minute rather than timed to midnight: a sleeping PC or a clock
    // change would make a one-shot timer fire late or never.
    const id = window.setInterval(() => {
      const now = localCalendarDate();
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}
