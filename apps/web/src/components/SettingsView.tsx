import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import {
  BarChart3,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Keyboard,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import {
  AI_PROVIDER_ORDER,
  AI_PROVIDERS,
  maskKey,
  resolveActiveAiRoute,
  type AiConfig,
  type AiProviderId,
  type AiRoutingPreference,
} from '../lib/aiProviders';
import { GEMINI_API_BASE } from '../lib/geminiAgent';
import {
  PERMISSION_CATEGORY_LABELS,
  loadPermissionPolicies,
  savePermissionPolicies,
  type PermissionPolicyMode,
  type ToolPermissionCategory,
  type ToolPermissionPolicyMap,
} from '../lib/toolPermissions';
import {
  resetSettings,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  useAppSettings,
} from '../lib/appSettings';
import { clearLibrary, exportLibrary, formatBytes, listLibrary, subscribeLibrary } from '../lib/moleculeLibrary';
import { RUO_DISCLAIMER } from '../lib/reportGenerator';
import { clearRunHistory } from '../lib/runHistory';
import {
  clearStudioSession,
  type StudioSession,
} from '../lib/studioAuth';
import { getVaultStatus, subscribeVault } from '../lib/secureKeyVault';
import { clearUsage, loadUsage, subscribeUsage, summarizeUsage } from '../lib/usageTracker';
import { Badge, Button, Card, cx, FieldRow, IconButton, Input, Kbd, Select, Toggle, useFeedback } from './ui';

export type SettingsSection = 'account' | 'ai' | 'usage' | 'viewer' | 'workspace' | 'data' | 'about';

interface SettingsViewProps {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  aiConfig: AiConfig;
  onUpdateAiConfig: (update: {
    provider?: AiProviderId;
    routingPreference?: AiRoutingPreference;
    enableWebSearch?: boolean;
    synlexa?: { model?: string };
    gemini?: { apiKey?: string; model?: string };
    anthropic?: { apiKey?: string; model?: string };
    openai?: { apiKey?: string; model?: string };
  }) => void;
  onPermissionsChange?: (next: ToolPermissionPolicyMap) => void;
  session: StudioSession | null;
  onSessionChange: (s: StudioSession | null) => void;
  /** Starts the synlexa.com sign-in (popup on web, system browser on desktop). */
  onSignIn: (mode: 'signin' | 'signup') => void;
  onCancelSignIn: () => void;
  signInPending: boolean;
  onResetLayout: () => void;
  onClearedHistory: () => void;
}

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  keywords: string;
}

const NAV_GROUPS: NavItem[][] = [
  [
    { id: 'account', label: 'Account', icon: <User className="h-4 w-4" />, keywords: 'sign in sign out profile email synlexa.com login' },
    { id: 'usage', label: 'Usage', icon: <BarChart3 className="h-4 w-4" />, keywords: 'tokens requests cost history' },
  ],
  [
    { id: 'ai', label: 'AI & API keys', icon: <KeyRound className="h-4 w-4" />, keywords: 'assistant claude anthropic gemini google model byok key synlexa cloud' },
  ],
  [
    { id: 'viewer', label: '3D viewer', icon: <Monitor className="h-4 w-4" />, keywords: 'render style color cartoon surface layout png report' },
    { id: 'workspace', label: 'Workspace', icon: <LayoutGrid className="h-4 w-4" />, keywords: 'interface size scale zoom text tabs layout auto-save guided demo' },
  ],
  [
    { id: 'data', label: 'Data & storage', icon: <Database className="h-4 w-4" />, keywords: 'library export import backup clear history storage' },
  ],
];

const ABOUT_ITEM: NavItem = {
  id: 'about',
  label: 'About',
  icon: <Info className="h-4 w-4" />,
  keywords: 'version license engine keyboard shortcuts research use only',
};

const ALL_NAV = [...NAV_GROUPS.flat(), ABOUT_ITEM];

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[0.4375rem] text-left text-sm transition-colors',
        active ? 'bg-white/[0.08] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
      )}
    >
      <span className={active ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
      {item.label}
    </button>
  );
}

/** Settings as a centered dialog (sidebar navigation + scrolling content), like a desktop app preferences window. */
export function SettingsDialog(props: SettingsViewProps & { open: boolean; onClose: () => void }) {
  const { open, onClose, section, onSectionChange } = props;
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);

  const q = query.trim().toLowerCase();
  const matches = (n: NavItem) => !q || `${n.label} ${n.keywords}`.toLowerCase().includes(q);
  const groups = NAV_GROUPS.map((g) => g.filter(matches)).filter((g) => g.length > 0);
  const aboutVisible = matches(ABOUT_ITEM);
  const anyMatch = groups.length > 0 || aboutVisible;

  if (!open) return null;
  const current = ALL_NAV.find((n) => n.id === section) ?? ALL_NAV[0];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[min(46rem,100%)] w-[min(64rem,100%)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#161a22] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7)]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] pr-2 pl-5">
          <h2 className="text-[0.9375rem] font-semibold text-slate-100">Settings</h2>
          <IconButton label="Close settings" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Sidebar (md+) */}
          <aside className="hidden w-60 shrink-0 flex-col border-r border-white/[0.07] md:flex">
            <div className="p-3 pb-2">
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-sky-400/50">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const first = [...groups.flat(), ...(aboutVisible ? [ABOUT_ITEM] : [])][0];
                      if (first) onSectionChange(first.id);
                    }
                  }}
                  placeholder="Search"
                  aria-label="Search settings"
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {groups.map((g, i) => (
                <div key={g[0].id} className={cx('space-y-0.5 py-1.5', i > 0 && 'border-t border-white/[0.06]')}>
                  {g.map((n) => (
                    <NavButton key={n.id} item={n} active={section === n.id} onSelect={() => onSectionChange(n.id)} />
                  ))}
                </div>
              ))}
              {!anyMatch && <p className="px-2.5 py-2 text-sm text-slate-500">No settings match “{query}”.</p>}
            </nav>
            {aboutVisible && (
              <div className="border-t border-white/[0.06] p-3">
                <NavButton item={ABOUT_ITEM} active={section === 'about'} onSelect={() => onSectionChange('about')} />
              </div>
            )}
          </aside>

          {/* Section tabs (small screens) */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.07] px-3 py-2 [scrollbar-width:none] md:hidden">
            {ALL_NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSectionChange(n.id)}
                className={cx(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap',
                  section === n.id ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04]',
                )}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </div>

          <div ref={contentRef} className="@container min-w-0 flex-1 overflow-y-auto" aria-label={current.label}>
            <div className="mx-auto max-w-3xl space-y-5 px-5 py-6 @2xl:px-8">
              {section === 'account' && <AccountSection {...props} />}
              {section === 'ai' && <AiSection {...props} />}
              {section === 'usage' && <UsageSection />}
              {section === 'viewer' && <ViewerSection />}
              {section === 'workspace' && <WorkspaceSection onResetLayout={props.onResetLayout} />}
              {section === 'data' && <DataSection onClearedHistory={props.onClearedHistory} />}
              {section === 'about' && <AboutSection />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pb-1">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
    </div>
  );
}

// ---------------- Account ----------------

function AccountSection({
  session,
  onSessionChange,
  onSignIn,
  onCancelSignIn,
  signInPending,
  aiConfig,
}: SettingsViewProps) {
  const { confirm, toast } = useFeedback();
  const initials = (session?.displayName ?? session?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return (
    <>
      <SectionTitle title="Account" description="Your synlexa.com connection and how Studio uses it." />
      <Card>
        {session ? (
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-base font-semibold text-white">
              {initials || <User className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-slate-100">
                {session.displayName ?? session.email ?? 'Signed in'}
              </div>
              <div className="truncate text-sm text-slate-400">{session.email ?? 'Email not shared'}</div>
              <div className="mt-1.5 flex gap-1.5">
                {session.serverVerified ? (
                  <Badge tone="good">Verified by synlexa.com</Badge>
                ) : (
                  <Badge tone="warn">Not confirmed by synlexa.com</Badge>
                )}
                <Badge>Since {new Date(session.establishedAtUtc).toLocaleDateString()}</Badge>
              </div>
            </div>
            {!session.serverVerified && (
              <Button variant="primary" disabled={signInPending} onClick={() => onSignIn('signin')}>
                {signInPending ? 'Waiting…' : 'Reconnect'}
              </Button>
            )}
            <Button
              variant="ghost"
              icon={<LogOut className="h-4 w-4" />}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Sign out?',
                  message: 'Your local library, settings, and API keys stay on this device.',
                  confirmLabel: 'Sign out',
                });
                if (!ok) return;
                clearStudioSession();
                onSessionChange(null);
                toast('Signed out', 'success');
              }}
            >
              Sign out
            </Button>
          </div>
        ) : signInPending ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-400/10 text-sky-300">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <div className="text-base font-medium text-slate-100">Waiting for synlexa.com…</div>
                <div className="text-sm text-slate-400">
                  Finish signing in in the window that opened. Studio connects automatically.
                </div>
              </div>
            </div>
            <Button variant="ghost" onClick={onCancelSignIn}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-slate-400">
                <User className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-medium text-slate-100">Not signed in</div>
                <div className="text-sm text-slate-400">
                  Studio works fully offline. Sign in to use Synlexa Cloud and connect your organization.
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onSignIn('signup')}>
                Create account
              </Button>
              <Button variant="primary" onClick={() => onSignIn('signin')}>
                Sign in
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card title="Where your data lives">
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Structures, compounds, and your library are stored in this browser (IndexedDB) and never uploaded.
          </li>
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Calculations run locally in the WebAssembly engine.
          </li>
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            {!aiConfig[aiConfig.provider]?.apiKey ? (
              <>
                Nothing is sent to an AI provider until you sign in for Synlexa Cloud or add your own key. The
                built-in assistant runs locally.
              </>
            ) : aiConfig.provider === 'synlexa' ? (
              <>
                AI requests go through synlexa.com to Google Gemini, with a summary of the loaded workspace. Synlexa
                does not store prompts or replies.
              </>
            ) : (
              <>
                AI requests go directly from this browser to{' '}
                {aiConfig.provider === 'anthropic' ? 'Anthropic' : 'Google'} using your own key, with a summary of the
                loaded workspace.
              </>
            )}
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------- AI ----------------

function KeyField({
  provider,
  value,
  onSave,
}: {
  provider: AiProviderId;
  value: string;
  onSave: (key: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const editing = draft.length > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          type={reveal ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={value ? maskKey(value) : AI_PROVIDERS[provider].keyHint}
          autoComplete="off"
          spellCheck={false}
          className="pr-9 font-mono text-[0.8125rem]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onSave(draft.trim());
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide key' : 'Show key'}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {editing ? (
        <Button
          variant="primary"
          onClick={() => {
            onSave(draft.trim());
            setDraft('');
          }}
        >
          Save
        </Button>
      ) : value ? (
        <Button variant="ghost" onClick={() => onSave('')}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}

async function testProvider(provider: AiProviderId, apiKey: string, model: string): Promise<string> {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    try {
      const m = await client.models.retrieve(model);
      return `Connected · ${m.display_name ?? m.id}`;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('Invalid API key');
      if (err instanceof Anthropic.NotFoundError) throw new Error(`Model "${model}" not available for this key`);
      if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach api.anthropic.com');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  if (provider === 'openai') {
    const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    return `Connected · ${body.id ?? model}`;
  }
  const res = await fetch(`${GEMINI_API_BASE}/${encodeURIComponent(model)}`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  const body = (await res.json().catch(() => ({}))) as { displayName?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return `Connected · ${body.displayName ?? model}`;
}

function AiSection({
  aiConfig,
  onUpdateAiConfig,
  onPermissionsChange,
  session,
  onSignIn,
  signInPending,
}: SettingsViewProps) {
  const [testing, setTesting] = useState<AiProviderId | null>(null);
  const [results, setResults] = useState<Partial<Record<AiProviderId, { ok: boolean; msg: string }>>>({});
  const [vault, setVault] = useState(() => getVaultStatus());
  const [policies, setPolicies] = useState<ToolPermissionPolicyMap>(() => loadPermissionPolicies());

  useEffect(() => subscribeVault(() => setVault(getVaultStatus())), []);

  const route = resolveActiveAiRoute(aiConfig);
  const routingPref: AiRoutingPreference = aiConfig.routingPreference ?? 'byok-first';

  const updatePolicy = (category: ToolPermissionCategory, mode: PermissionPolicyMode) => {
    const next = savePermissionPolicies({ ...policies, [category]: mode });
    setPolicies(next);
    onPermissionsChange?.(next);
  };

  const runTest = async (p: AiProviderId) => {
    setTesting(p);
    try {
      const cfg = aiConfig[p] ?? { apiKey: '', model: '' };
      const msg = await testProvider(p, cfg.apiKey, cfg.model);
      setResults((r) => ({ ...r, [p]: { ok: true, msg } }));
    } catch (err) {
      setResults((r) => ({ ...r, [p]: { ok: false, msg: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <SectionTitle
        title="AI & API keys"
        description="Bring your own Anthropic, Gemini, or OpenAI/Codex key (BYOK), or choose Synlexa Cloud. When a BYOK key is entered in default mode, Studio routes directly to your provider instead of Synlexa Cloud."
      />
      <Card
        title="Active AI routing & key priority"
        description="Control whether your local BYOK keys always override Synlexa Cloud or whether you switch manually."
        actions={
          <Badge tone={route.isByok ? 'good' : route.hasCloudToken ? 'accent' : 'neutral'}>
            {route.isByok
              ? `Using BYOK (${AI_PROVIDERS[route.provider].label})`
              : route.provider === 'synlexa' && route.hasCloudToken
                ? 'Using Synlexa Cloud'
                : 'Local Deterministic Copilot'}
          </Badge>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-slate-200">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              {route.isByok ? (
                <span>
                  Requests go directly to <strong>{AI_PROVIDERS[route.provider].label}</strong> using your encrypted BYOK key — Synlexa Cloud is bypassed.
                </span>
              ) : route.provider === 'synlexa' && route.hasCloudToken ? (
                <span>
                  Requests route through <strong>Synlexa Cloud</strong> (`synlexa.com` account).
                  {route.hasByok ? ' (Manual override active; your BYOK keys are saved for instant switch.)' : ''}
                </span>
              ) : (
                <span>No BYOK key or Cloud token active — using offline deterministic Copilot.</span>
              )}
            </div>
          </div>
          <FieldRow
            label="Key routing priority"
            hint="Prefer BYOK guarantees your personal API key is used instead of Synlexa Cloud whenever any key is saved."
          >
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={routingPref === 'byok-first' ? 'primary' : 'secondary'}
                onClick={() => {
                  const nextByok = (['anthropic', 'gemini', 'openai'] as AiProviderId[]).find(
                    (id) => Boolean(aiConfig[id]?.apiKey?.trim()),
                  );
                  onUpdateAiConfig({
                    routingPreference: 'byok-first',
                    ...(nextByok && aiConfig.provider === 'synlexa' ? { provider: nextByok } : {}),
                  });
                }}
              >
                Prefer BYOK keys
              </Button>
              <Button
                size="sm"
                variant={routingPref === 'manual' ? 'primary' : 'secondary'}
                onClick={() => onUpdateAiConfig({ routingPreference: 'manual' })}
              >
                Choose manually (BYOK / Cloud)
              </Button>
            </div>
          </FieldRow>
        </div>
      </Card>
      <Card
        title="Encrypted Local Key Vault (state.vscdb)"
        description="BYOK keys are stored in the local ItemTable store and encrypted with a non-extractable key."
        actions={<Badge tone="good">{vault.cipher}</Badge>}
      >
        <div className="divide-y divide-white/[0.05] text-sm">
          <FieldRow label="Storage backend" hint="Never saved inside project files or plain-text localStorage.">
            <span className="font-mono text-xs text-sky-300">{vault.dbPath}</span>
          </FieldRow>
          <FieldRow label="Allow AI scientific web search" hint="Lets the assistant query Europe PMC & ClinicalTrials.gov via MCP.">
            <Toggle
              checked={aiConfig.enableWebSearch !== false}
              onChange={(v) => onUpdateAiConfig({ enableWebSearch: v })}
              label="Allow AI scientific web search"
            />
          </FieldRow>
        </div>
      </Card>
      <Card title="Default assistant" description="Choose between your BYOK providers or Synlexa Cloud.">
        <div className="grid gap-3 @lg:grid-cols-2">
          {AI_PROVIDER_ORDER.map((p) => {
            const active = route.provider === p;
            const cfg = aiConfig[p] ?? { apiKey: '', model: AI_PROVIDERS[p].models[0]?.id ?? '' };
            const ready = Boolean(cfg.apiKey);
            const modelName = AI_PROVIDERS[p].models.find((m) => m.id === cfg.model)?.label ?? cfg.model;
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  onUpdateAiConfig({
                    provider: p,
                    ...(p === 'synlexa' && route.hasByok ? { routingPreference: 'manual' } : {}),
                  })
                }
                className={cx(
                  'rounded-xl border p-4 text-left transition-colors',
                  active ? 'border-sky-400/60 bg-sky-500/[0.07]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-100">{AI_PROVIDERS[p].label}</span>
                  <span
                    className={cx(
                      'h-4 w-4 rounded-full border-2',
                      active ? 'border-sky-400 bg-sky-400 shadow-[inset_0_0_0_2px_#121722]' : 'border-slate-600',
                    )}
                  />
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {p === 'synlexa'
                    ? ready
                      ? `Signed in · ${modelName}`
                      : 'Sign in required'
                    : ready
                      ? `BYOK key encrypted · ${modelName}`
                      : 'No key yet'}
                </div>
              </button>
            );
          })}
        </div>
        {!aiConfig[route.provider]?.apiKey && (
          <p className="mt-3 text-xs text-slate-400">
            Until you add a BYOK key or sign in to Synlexa Cloud, the assistant answers with the built-in deterministic helper.
          </p>
        )}
      </Card>

      <Card
        title="Synlexa Cloud"
        description="Gemini through your synlexa.com account. Used only when selected and no BYOK override is active."
      >
        <div className="divide-y divide-white/[0.05]">
          <FieldRow label="Account" hint={aiConfig.synlexa.apiKey ? 'Connected' : 'Not connected'}>
            {aiConfig.synlexa.apiKey ? (
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {session?.email ?? session?.displayName ?? 'Signed in'}
              </div>
            ) : (
              <Button size="sm" variant="primary" disabled={signInPending} onClick={() => onSignIn('signin')}>
                {signInPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {signInPending ? 'Waiting for synlexa.com…' : session ? 'Reconnect to synlexa.com' : 'Sign in to synlexa.com'}
              </Button>
            )}
          </FieldRow>
          <FieldRow label="Model">
            <div className="w-full @xl:w-80">
              <Select
                value={aiConfig.synlexa.model}
                onChange={(e) => onUpdateAiConfig({ synlexa: { model: e.target.value } })}
              >
                {AI_PROVIDERS.synlexa.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </Select>
            </div>
          </FieldRow>
        </div>
        {session && !aiConfig.synlexa.apiKey && (
          <p className="mt-3 text-xs text-slate-400">
            Your current sign-in was not confirmed by synlexa.com, so Studio has no account token. Sign in again to
            connect.
          </p>
        )}
      </Card>

      {(['anthropic', 'gemini', 'openai'] as AiProviderId[]).map((p) => {
        const meta = AI_PROVIDERS[p];
        const cfg = aiConfig[p] ?? { apiKey: '', model: meta.models[0]?.id ?? '' };
        const knownModel = meta.models.some((m) => m.id === cfg.model);
        const res = results[p];
        return (
          <Card
            key={p}
            title={meta.label}
            description={
              <>
                Get a key at{' '}
                <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  {new URL(meta.keyUrl).host}
                </a>
              </>
            }
            actions={
              <Button size="sm" disabled={!cfg.apiKey || testing !== null} onClick={() => void runTest(p)}>
                {testing === p ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Test connection
              </Button>
            }
          >
            <div className="divide-y divide-white/[0.05]">
              <FieldRow label="API key" hint={cfg.apiKey ? 'Encrypted in state.vscdb · Active when saved' : 'Not set'}>
                <div className="w-full @xl:w-80">
                  <KeyField
                    provider={p}
                    value={cfg.apiKey}
                    onSave={(k) => {
                      const trimmed = k.trim();
                      onUpdateAiConfig({
                        [p]: { apiKey: trimmed },
                        ...(trimmed ? { provider: p } : {}),
                      });
                      setResults((r) => ({ ...r, [p]: undefined }));
                    }}
                  />
                </div>
              </FieldRow>
              <FieldRow label="Model">
                <div className="w-full space-y-2 @xl:w-80">
                  <Select
                    value={knownModel ? cfg.model : '__custom'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom') onUpdateAiConfig({ [p]: { model: e.target.value } });
                      else onUpdateAiConfig({ [p]: { model: '' } });
                    }}
                  >
                    {meta.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.note}
                      </option>
                    ))}
                    <option value="__custom">Custom model ID…</option>
                  </Select>
                  {!knownModel && (
                    <Input
                      defaultValue={cfg.model}
                      placeholder="exact model ID"
                      className="font-mono text-[0.8125rem]"
                      onBlur={(e) => e.target.value.trim() && onUpdateAiConfig({ [p]: { model: e.target.value.trim() } })}
                    />
                  )}
                </div>
              </FieldRow>
            </div>
            {res && (
              <div
                className={cx(
                  'mt-3 rounded-lg px-3 py-2 text-sm',
                  res.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200',
                )}
              >
                {res.msg}
              </div>
            )}
            {p === 'anthropic' && (cfg.model === 'claude-opus-5-5' || cfg.model === 'claude-sonnet-5-5') && (
              <p className="mt-3 text-xs text-slate-500">
                If the selected model declines a request, the API automatically retries it on a fallback model
                (server-side fallback).
              </p>
            )}
          </Card>
        );
      })}

      <Card
        title="Agent Tool Permissions"
        description="Control when the AI Assistant asks for interactive confirmation before acting across Studio tools."
      >
        <div className="divide-y divide-white/[0.05]">
          {(Object.keys(PERMISSION_CATEGORY_LABELS) as ToolPermissionCategory[]).map((cat) => {
            const info = PERMISSION_CATEGORY_LABELS[cat];
            return (
              <FieldRow key={cat} label={info.label} hint={info.description}>
                <Select
                  value={policies[cat]}
                  onChange={(e) => updatePolicy(cat, e.target.value as PermissionPolicyMode)}
                  className="w-44"
                >
                  <option value="ask">Ask before running</option>
                  <option value="always-allow">Always allow</option>
                  <option value="deny">Block (deny)</option>
                </Select>
              </FieldRow>
            );
          })}
        </div>
      </Card>
    </>
  );
}

// ---------------- Usage ----------------

function UsageSection() {
  const [rows, setRows] = useState(loadUsage);
  const [range, setRange] = useState<7 | 30>(30);
  const { confirm } = useFeedback();
  useEffect(() => subscribeUsage(() => setRows(loadUsage())), []);
  const sum = useMemo(() => summarizeUsage(rows, range), [rows, range]);
  const maxTokens = Math.max(1, ...sum.days.map((d) => d.tokens));
  const nf = new Intl.NumberFormat();

  return (
    <>
      <SectionTitle
        title="Usage"
        description="AI requests and tokens made from this browser, as reported by each provider. Billing happens on your provider account."
      />
      <div className="flex gap-1">
        {([7, 30] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm',
              range === r ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:bg-white/[0.05]',
            )}
          >
            Last {r} days
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        {[
          ['Requests', sum.totals.requests],
          ['Input tokens', sum.totals.inputTokens],
          ['Output tokens', sum.totals.outputTokens],
          ['Tool calls', sum.totals.toolCalls],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">{nf.format(v as number)}</div>
          </div>
        ))}
      </div>
      <Card title="Tokens per day">
        <div className="flex h-32 items-end gap-[3px]">
          {sum.days.map((d) => (
            <div key={d.date} className="group relative flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t-sm bg-sky-400/70 transition-colors group-hover:bg-sky-300"
                style={{ height: `${d.tokens ? Math.max(3, (d.tokens / maxTokens) * 100) : 0}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-black/90 px-2 py-1 text-xs whitespace-nowrap text-slate-200 group-hover:block">
                {d.date}: {nf.format(d.tokens)} tokens · {d.requests} req
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{sum.days[0]?.date}</span>
          <span>Today</span>
        </div>
      </Card>
      <Card
        title="By model"
        actions={
          <Button
            size="sm"
            variant="ghost"
            disabled={!rows.length}
            onClick={async () => {
              if (await confirm({ title: 'Clear usage history?', message: 'This only resets the local counters.', confirmLabel: 'Clear' }))
                clearUsage();
            }}
          >
            Reset counters
          </Button>
        }
      >
        {sum.byProvider.length === 0 ? (
          <div className="text-sm text-slate-400">No AI requests in this period.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 text-right font-medium">Requests</th>
                <th className="pb-2 text-right font-medium">Input</th>
                <th className="pb-2 text-right font-medium">Output</th>
                <th className="pb-2 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {sum.byProvider.map(([key, v]) => {
                const [prov, model] = key.split('::');
                return (
                  <tr key={key} className="border-t border-white/[0.05]">
                    <td className="py-2">
                      <span className="text-slate-200">{model}</span>{' '}
                      <span className="text-xs text-slate-500">{prov === 'local' ? 'built-in' : prov}</span>
                    </td>
                    <td className="py-2 text-right text-slate-300">{nf.format(v.requests)}</td>
                    <td className="py-2 text-right text-slate-300">{nf.format(v.inputTokens)}</td>
                    <td className="py-2 text-right text-slate-300">{nf.format(v.outputTokens)}</td>
                    <td className={cx('py-2 text-right', v.errors ? 'text-rose-300' : 'text-slate-500')}>{v.errors}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// ---------------- Viewer ----------------

function ViewerSection() {
  const [settings, update] = useAppSettings();
  const v = settings.viewer;
  const setV = (patch: Partial<typeof v>) => update((s) => ({ ...s, viewer: { ...s.viewer, ...patch } }));
  return (
    <>
      <SectionTitle title="3D viewer" description="Defaults applied when Studio opens." />
      <Card>
        <div className="divide-y divide-white/[0.05]">
          <FieldRow label="Representation">
            <Select className="w-full @xl:w-56" value={v.defaultStyle} onChange={(e) => setV({ defaultStyle: e.target.value as typeof v.defaultStyle })}>
              <option value="ribbon">Ribbon</option>
              <option value="trace">Cα trace</option>
              <option value="pocket">Active pocket</option>
            </Select>
          </FieldRow>
          <FieldRow label="Color by">
            <Select className="w-full @xl:w-56" value={v.defaultColorMode} onChange={(e) => setV({ defaultColorMode: e.target.value as typeof v.defaultColorMode })}>
              <option value="identity">Structure identity</option>
              <option value="plddt">pLDDT (predictions)</option>
              <option value="bfactor">B-factor (experimental)</option>
              <option value="deviation">Per-residue deviation Δd</option>
            </Select>
          </FieldRow>
          <FieldRow label="Layout">
            <Select className="w-full @xl:w-56" value={v.defaultLayout} onChange={(e) => setV({ defaultLayout: e.target.value as typeof v.defaultLayout })}>
              <option value="overlay">Overlay</option>
              <option value="split">Side by side</option>
              <option value="reference">Reference only</option>
              <option value="mobile">Comparison only</option>
            </Select>
          </FieldRow>
          <FieldRow label="Embed viewport image in HTML reports">
            <Toggle checked={v.embedPngInReports} onChange={(x) => setV({ embedPngInReports: x })} />
          </FieldRow>
        </div>
      </Card>
      <Card title="Controls">
        <dl className="grid grid-cols-[11rem_1fr] gap-y-2.5 text-sm">
          <dt className="text-slate-400">Rotate</dt>
          <dd className="text-slate-200">Drag · one-finger drag</dd>
          <dt className="text-slate-400">Zoom</dt>
          <dd className="text-slate-200">Scroll · trackpad pinch · two-finger pinch</dd>
          <dt className="text-slate-400">Pan</dt>
          <dd className="text-slate-200">Shift + drag · right-drag · two-finger drag</dd>
          <dt className="text-slate-400">Select residue</dt>
          <dd className="text-slate-200">Click</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Pinch and ctrl-scroll only zoom the 3D scene; the rest of the interface stays fixed.
        </p>
      </Card>
    </>
  );
}

// ---------------- Workspace ----------------

function WorkspaceSection({ onResetLayout }: { onResetLayout: () => void }) {
  const [s, update] = useAppSettings();
  const { toast } = useFeedback();
  return (
    <>
      <SectionTitle title="Workspace" description="Interface size, tabs, and behavior." />
      <Card>
        <div className="divide-y divide-white/[0.05]">
          <FieldRow
            label="Interface size"
            hint={
              <>
                Also <Kbd>⌘</Kbd> <Kbd>+</Kbd> / <Kbd>⌘</Kbd> <Kbd>−</Kbd> / <Kbd>⌘</Kbd> <Kbd>0</Kbd>
              </>
            }
          >
            <div className="flex w-full items-center gap-3 @xl:w-64">
              <input
                type="range"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={UI_SCALE_STEP}
                value={s.uiScale}
                onChange={(e) => update({ uiScale: Number(e.target.value) })}
                className="flex-1 accent-sky-400"
                aria-label="Interface size"
              />
              <span className="w-12 text-right text-sm text-slate-300 tabular-nums">{Math.round(s.uiScale * 100)}%</span>
            </div>
          </FieldRow>
          <FieldRow label="Guided explanations" hint="Plain-language notes next to metrics and in tools.">
            <Toggle checked={s.guidedMode} onChange={(v) => update({ guidedMode: v })} />
          </FieldRow>
          <FieldRow label="Reopen tabs on launch">
            <Toggle checked={s.restoreTabs} onChange={(v) => update({ restoreTabs: v })} />
          </FieldRow>
          <FieldRow label="Load example comparison on launch" hint="Carbonic anhydrase II: crystal vs AlphaFold.">
            <Toggle checked={s.loadDemoOnStart} onChange={(v) => update({ loadDemoOnStart: v })} />
          </FieldRow>
          <FieldRow label="Save imports to library automatically">
            <Toggle checked={s.autoSaveImports} onChange={(v) => update({ autoSaveImports: v })} />
          </FieldRow>
          <FieldRow label="Confirm before deleting">
            <Toggle checked={s.confirmDeletes} onChange={(v) => update({ confirmDeletes: v })} />
          </FieldRow>
          <FieldRow label="Tab layout">
            <Button
              size="sm"
              onClick={() => {
                onResetLayout();
                toast('Tab layout reset', 'success');
              }}
            >
              Reset layout
            </Button>
          </FieldRow>
        </div>
      </Card>
      <Card title="Keyboard shortcuts" actions={<Keyboard className="h-4 w-4 text-slate-500" />}>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2.5 text-sm">
          {[
            ['Command palette', ['⌘', 'K']],
            ['Open file', ['⌘', 'O']],
            ['Search databases', ['⌘', 'Shift', 'F']],
            ['Close tab', ['Alt', 'W']],
            ['Toggle sidebar', ['⌘', 'B']],
            ['Settings', ['⌘', ',']],
            ['Interface size', ['⌘', '+ / −']],
          ].map(([label, keys]) => (
            <div key={label as string} className="contents">
              <dt className="text-slate-300">{label}</dt>
              <dd className="flex gap-1">
                {(keys as string[]).map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}

// ---------------- Data ----------------

function DataSection({ onClearedHistory }: { onClearedHistory: () => void }) {
  const { confirm, toast } = useFeedback();
  const [libStats, setLibStats] = useState({ count: 0, bytes: 0 });
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);

  useEffect(() => {
    const load = () =>
      listLibrary().then((items) =>
        setLibStats({ count: items.length, bytes: items.reduce((s, i) => s + i.sizeBytes, 0) }),
      );
    void load();
    navigator.storage?.estimate?.().then(setEstimate).catch(() => {});
    return subscribeLibrary(() => void load());
  }, []);

  return (
    <>
      <SectionTitle title="Data & storage" description="Everything here is stored on this device only." />
      <Card>
        <div className="divide-y divide-white/[0.05]">
          <FieldRow label="Library" hint={`${libStats.count} items · ${formatBytes(libStats.bytes)}`}>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!libStats.count}
                onClick={async () => {
                  const data = await exportLibrary(RUO_DISCLAIMER);
                  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `synlexa-library-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Export
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!libStats.count}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete all ${libStats.count} library items?`,
                    message: 'This permanently removes every stored structure, compound, and sequence from this device. Export first if you want a backup.',
                    confirmLabel: 'Delete all',
                    danger: true,
                  });
                  if (!ok) return;
                  await clearLibrary();
                  toast('Library cleared', 'success');
                }}
              >
                Delete all
              </Button>
            </div>
          </FieldRow>
          <FieldRow label="Comparison run history">
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!(await confirm({ title: 'Clear run history?', message: 'Removes the list of past comparisons.', confirmLabel: 'Clear', danger: true }))) return;
                await clearRunHistory();
                onClearedHistory();
                toast('Run history cleared', 'success');
              }}
            >
              Clear
            </Button>
          </FieldRow>
          <FieldRow label="Settings" hint="Restore every preference to its default.">
            <Button
              size="sm"
              onClick={async () => {
                if (!(await confirm({ title: 'Reset all settings?', message: 'API keys and your library are not affected.', confirmLabel: 'Reset' }))) return;
                resetSettings();
                toast('Settings reset', 'success');
              }}
            >
              Reset
            </Button>
          </FieldRow>
          {estimate?.usage !== undefined && (
            <FieldRow label="Browser storage used by Studio">
              <span className="text-sm text-slate-300 tabular-nums">
                {formatBytes(estimate.usage ?? 0)}
                {estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ''}
              </span>
            </FieldRow>
          )}
        </div>
      </Card>
    </>
  );
}

// ---------------- About ----------------

const STUDIO_APP_VERSION =
  typeof __SYNLEXA_APP_VERSION__ !== 'undefined' ? __SYNLEXA_APP_VERSION__ : '0.4.0';

function AboutSection() {
  return (
    <>
      <SectionTitle title="About Synlexa Studio" />
      <Card>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2.5 text-sm">
          <dt className="text-slate-400">Version</dt>
          <dd className="text-slate-200">{STUDIO_APP_VERSION}</dd>
          <dt className="text-slate-400">Compute engine</dt>
          <dd className="text-slate-200">synlexa-bio-core (Rust → WebAssembly), runs locally</dd>
          <dt className="text-slate-400">Storage</dt>
          <dd className="text-slate-200">On this device (IndexedDB + localStorage)</dd>
        </dl>
      </Card>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-relaxed text-amber-100/90">
        {RUO_DISCLAIMER} Computational outputs are exploratory and have not been clinically validated.
      </div>
    </>
  );
}
