/**
 * Reads the signed-in user's Synlexa plan, allowed cloud models and remaining
 * Synlexa Cloud usage from synlexa.com (Research-Use-Only). Plan rules live on
 * the server; Studio only displays them. BYOK and local tools are unaffected.
 */
import { STUDIO_ASSISTANT_ENDPOINT, type StorageLike } from './studioAuth';
import { getFreshStudioAccessToken, withStudioTokenRetry } from './studioTokens';

export const STUDIO_ENTITLEMENTS_ENDPOINT = STUDIO_ASSISTANT_ENDPOINT.replace(/\/assistant$/u, '/entitlements');

export type StudioUsageWindowKind = 'five_hour' | 'daily' | 'weekly';

export interface StudioUsageWindow {
  kind: StudioUsageWindowKind;
  /** Null when the plan has no cap for this window (Enterprise is metered instead). */
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string | null;
}

export interface StudioEntitlements {
  plan: 'free' | 'starter' | 'pro' | 'team' | 'enterprise';
  features: string[];
  allowedModels: string[];
  metered: boolean;
  usage: StudioUsageWindow[];
}

const PLAN_NAMES: Record<StudioEntitlements['plan'], string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export function planDisplayName(plan: StudioEntitlements['plan']): string {
  return PLAN_NAMES[plan];
}

const WINDOW_NAMES: Record<StudioUsageWindowKind, string> = {
  five_hour: 'Current 5-hour session',
  daily: 'Last 24 hours',
  weekly: 'This week',
};

export function usageWindowLabel(kind: StudioUsageWindowKind): string {
  return WINDOW_NAMES[kind];
}

/** Share of the window used, 0–100; null when uncapped. */
export function usagePercent(window: StudioUsageWindow): number | null {
  if (window.limit === null || window.limit <= 0) return null;
  return Math.min(100, Math.round((window.used / window.limit) * 100));
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseWindow(raw: unknown): StudioUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (w.kind !== 'five_hour' && w.kind !== 'daily' && w.kind !== 'weekly') return null;
  if (!isNum(w.used) || !(w.limit === null || isNum(w.limit)) || !(w.remaining === null || isNum(w.remaining))) return null;
  if (!(w.resetsAt === null || typeof w.resetsAt === 'string')) return null;
  return { kind: w.kind, limit: w.limit, used: w.used, remaining: w.remaining, resetsAt: w.resetsAt };
}

/** Validates the server payload; null when it is not a recognisable entitlements object. */
export function parseStudioEntitlements(raw: unknown): StudioEntitlements | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.plan !== 'string' || !(e.plan in PLAN_NAMES)) return null;
  if (!isStringArray(e.features) || !isStringArray(e.allowedModels) || typeof e.metered !== 'boolean') return null;
  if (!Array.isArray(e.usage)) return null;
  const usage = e.usage.map(parseWindow);
  if (usage.some((w) => w === null)) return null;
  return {
    plan: e.plan as StudioEntitlements['plan'],
    features: e.features,
    allowedModels: e.allowedModels,
    metered: e.metered,
    usage: usage as StudioUsageWindow[],
  };
}

/** Fetches entitlements with a fresh access token. Null when signed out, offline or rejected. */
export async function fetchStudioEntitlements(
  opts: { fetchImpl?: typeof fetch; store?: StorageLike } = {},
): Promise<StudioEntitlements | null> {
  const f = opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== 'function') return null;
  const token = await getFreshStudioAccessToken({ fetchImpl: f, store: opts.store });
  if (!token) return null;
  try {
    const res = await withStudioTokenRetry(f, { store: opts.store })(STUDIO_ENTITLEMENTS_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { entitlements?: unknown } | null;
    return parseStudioEntitlements(body?.entitlements);
  } catch {
    return null;
  }
}
