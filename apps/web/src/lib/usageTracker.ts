/**
 * Local AI usage ledger. Counts requests and tokens reported by the provider
 * APIs (Gemini `usageMetadata`, Anthropic `usage`) per provider per UTC day.
 * Stored only on this device; nothing is sent anywhere.
 */
export type UsageProvider = 'gemini' | 'anthropic' | 'openai' | 'synlexa' | 'local';

export interface UsageDay {
  date: string; // YYYY-MM-DD (UTC)
  provider: UsageProvider;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  errors: number;
}

const LS_KEY = 'synlexa.studio.usage.v1';
const MAX_DAYS = 120;
const listeners = new Set<() => void>();

export function subscribeUsage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadUsage(): UsageDay[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as UsageDay[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordUsage(entry: {
  provider: UsageProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
  error?: boolean;
}) {
  const date = new Date().toISOString().slice(0, 10);
  const rows = loadUsage();
  let row = rows.find((r) => r.date === date && r.provider === entry.provider && r.model === entry.model);
  if (!row) {
    row = {
      date,
      provider: entry.provider,
      model: entry.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      errors: 0,
    };
    rows.push(row);
  }
  row.requests += 1;
  row.inputTokens += entry.inputTokens ?? 0;
  row.outputTokens += entry.outputTokens ?? 0;
  row.toolCalls += entry.toolCalls ?? 0;
  if (entry.error) row.errors += 1;
  const cutoff = new Date(Date.now() - MAX_DAYS * 86400_000).toISOString().slice(0, 10);
  const pruned = rows.filter((r) => r.date >= cutoff);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pruned));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function clearUsage() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function summarizeUsage(rows: UsageDay[], sinceDays: number) {
  const cutoff = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const inRange = rows.filter((r) => r.date >= cutoff);
  const byProvider = new Map<string, { requests: number; inputTokens: number; outputTokens: number; errors: number; toolCalls: number }>();
  for (const r of inRange) {
    const key = `${r.provider}::${r.model}`;
    const agg = byProvider.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0, errors: 0, toolCalls: 0 };
    agg.requests += r.requests;
    agg.inputTokens += r.inputTokens;
    agg.outputTokens += r.outputTokens;
    agg.errors += r.errors;
    agg.toolCalls += r.toolCalls;
    byProvider.set(key, agg);
  }
  const totals = inRange.reduce(
    (a, r) => ({
      requests: a.requests + r.requests,
      inputTokens: a.inputTokens + r.inputTokens,
      outputTokens: a.outputTokens + r.outputTokens,
      toolCalls: a.toolCalls + r.toolCalls,
      errors: a.errors + r.errors,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, errors: 0 },
  );
  // Daily series for the last N days (oldest → newest)
  const days: { date: string; tokens: number; requests: number }[] = [];
  for (let i = sinceDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const dayRows = inRange.filter((r) => r.date === d);
    days.push({
      date: d,
      tokens: dayRows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
      requests: dayRows.reduce((s, r) => s + r.requests, 0),
    });
  }
  return { totals, byProvider: Array.from(byProvider.entries()), days };
}
