/**
 * Minimal timing harness shared by the main process and the renderer.
 *
 * Deliberately tiny: when disabled, every entry point is a single boolean read
 * with no allocation and no `performance.now()` call, so it can stay in the hot
 * path (cart add, product search, sale save) permanently.
 *
 * Enable with the POS_PERF env var in main, or `import.meta.env.DEV` in the renderer.
 */

export interface PerfMeta {
  [key: string]: string | number | boolean | undefined;
}

type PerfSink = (label: string, ms: number, meta?: PerfMeta) => void;

interface Agg {
  n: number;
  total: number;
  max: number;
}

let enabled = false;
/** Operations at or above this many ms are logged individually; everything is still aggregated. */
let slowThresholdMs = 0;
const aggregates = new Map<string, Agg>();
const marks = new Map<string, number>();
let prefix = '';

const defaultSink: PerfSink = (label, ms, meta) => {
  const extra = meta
    ? ' ' +
      Object.entries(meta)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  // eslint-disable-next-line no-console
  console.debug(`[perf${prefix}] ${label} ${ms.toFixed(1)}ms${extra}`);
};

let sink: PerfSink = defaultSink;

export function setPerfEnabled(on: boolean, options?: { slowThresholdMs?: number; label?: string }): void {
  enabled = on;
  if (options?.slowThresholdMs != null) slowThresholdMs = options.slowThresholdMs;
  if (options?.label) prefix = `:${options.label}`;
}

export function perfEnabled(): boolean {
  return enabled;
}

export function setPerfSink(fn: PerfSink | null): void {
  sink = fn ?? defaultSink;
}

function record(label: string, ms: number, meta?: PerfMeta): void {
  const agg = aggregates.get(label);
  if (agg) {
    agg.n += 1;
    agg.total += ms;
    if (ms > agg.max) agg.max = ms;
  } else {
    aggregates.set(label, { n: 1, total: ms, max: ms });
  }
  if (ms >= slowThresholdMs) sink(label, ms, meta);
}

export function time<T>(label: string, fn: () => T, meta?: PerfMeta): T {
  if (!enabled) return fn();
  const started = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - started, meta);
  }
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>, meta?: PerfMeta): Promise<T> {
  if (!enabled) return fn();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - started, meta);
  }
}

export function mark(label: string): void {
  if (!enabled) return;
  marks.set(label, performance.now());
}

/** Records the elapsed time since the matching mark() and returns it. */
export function measure(label: string, meta?: PerfMeta): number | undefined {
  if (!enabled) return undefined;
  const started = marks.get(label);
  if (started == null) return undefined;
  marks.delete(label);
  const ms = performance.now() - started;
  record(label, ms, meta);
  return ms;
}

export interface PerfRow {
  label: string;
  n: number;
  avg: number;
  max: number;
}

export function perfRows(): PerfRow[] {
  return [...aggregates.entries()]
    .map(([label, a]) => ({ label, n: a.n, avg: a.total / a.n, max: a.max }))
    .sort((a, b) => b.max - a.max);
}

/** Human-readable table for pasting into a perf baseline. */
export function perfReport(): string {
  const rows = perfRows();
  if (!rows.length) return `[perf${prefix}] no measurements`;
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = [`[perf${prefix}] ${pad('operation', 34)}${pad('n', 6)}${pad('avg ms', 10)}max ms`];
  for (const r of rows) {
    lines.push(
      `[perf${prefix}] ${pad(r.label, 34)}${pad(String(r.n), 6)}${pad(r.avg.toFixed(1), 10)}${r.max.toFixed(1)}`,
    );
  }
  return lines.join('\n');
}

export function resetPerf(): void {
  aggregates.clear();
  marks.clear();
}
