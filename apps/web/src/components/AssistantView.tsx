import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  RotateCcw,
  Server,
  ShieldAlert,
} from 'lucide-react';
import {
  AI_PROVIDER_ORDER,
  AI_PROVIDERS,
  resolveActiveAiRoute,
  type AiConfig,
  type AiProviderId,
} from '../lib/aiProviders';
import type { AgentChatMessage, AgentStepTrace } from '../lib/geminiAgent';
import { MCP_TOOLS } from '../lib/mcpServer';
import type { PermissionDecision, ToolPermissionRequest } from '../lib/toolPermissions';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingProcessPanel } from './ThinkingProcessPanel';
import { Badge, Button, cx, Menu, type MenuItem } from './ui';

interface AssistantViewProps {
  messages: AgentChatMessage[];
  busy: boolean;
  config: AiConfig;
  liveSteps?: AgentStepTrace[];
  pendingPermission?: ToolPermissionRequest | null;
  onResolvePermission?: (decision: PermissionDecision) => void;
  onSelectProvider: (p: AiProviderId, model?: string) => void;
  onToggleWebSearch?: (enabled: boolean) => void;
  onSend: (prompt: string) => void;
  onClear: () => void;
  onOpenKeySettings: () => void;
  onOpenMcpServer?: () => void;
}

const OFFLINE_SUGGESTIONS = [
  'Explain the comparison metrics',
  'Which residues deviate most?',
  'Show active-site contacts',
  'Ramachandran outliers',
  'mutate H94A',
  'crispr codon 94',
];

const SUGGESTIONS = [
  'Create a new project, split 3HS4 chains/ligands, and open the 3D viewer',
  'Design an aspirin analog in RDKit, score MW/cLogP/TPSA, and add to project',
  'Search Europe PMC for 3HS4 carbonic anhydrase II acetazolamide',
  'Run superposition, apply H94A peptide mutation, and export an RUO report',
];

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
      title="Copy response markdown"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function AssistantView({
  messages,
  busy,
  config,
  liveSteps = [],
  pendingPermission,
  onResolvePermission,
  onSelectProvider,
  onToggleWebSearch,
  onSend,
  onClear,
  onOpenKeySettings,
  onOpenMcpServer,
}: AssistantViewProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const route = resolveActiveAiRoute(config);
  const provider = AI_PROVIDERS[route.provider];
  const activeCfg = config[route.provider] ?? { apiKey: '', model: '' };
  const modelLabel = provider.models.find((m) => m.id === activeCfg.model)?.label ?? activeCfg.model;
  const hasKey = Boolean(activeCfg.apiKey);
  const webEnabled = config.enableWebSearch !== false;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy, liveSteps.length, pendingPermission?.id]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`;
  }, [draft]);

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft('');
  };

  const userTurns = messages.filter((m) => m.role === 'user').length;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-4">
        <Menu
          align="left"
          trigger={(open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.05]"
            >
              <Bot className="h-4 w-4 text-sky-300" />
              <span className="font-medium text-slate-100">{hasKey ? modelLabel : 'Local Copilot'}</span>
              {hasKey && (
                <Badge tone={route.isByok ? 'good' : 'accent'} className="hidden @md:inline-flex">
                  {route.isByok ? 'BYOK · state.vscdb' : 'Synlexa Cloud'}
                </Badge>
              )}
              <ChevronDown className={cx('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          items={[
            ...AI_PROVIDER_ORDER.flatMap((p, i): MenuItem[] => {
              const ready = Boolean(config[p]?.apiKey);
              const heading = { heading: AI_PROVIDERS[p].label };
              const sep = i > 0 ? ['divider' as const] : [];
              if (!ready) {
                return [
                  ...sep,
                  heading,
                  {
                    key: `${p}:setup`,
                    label: p === 'synlexa' ? 'Sign in to use Synlexa Cloud…' : 'Add your BYOK key (state.vscdb)…',
                    icon: <KeyRound className="h-4 w-4" />,
                    onSelect: onOpenKeySettings,
                  },
                ];
              }
              return [
                ...sep,
                heading,
                ...AI_PROVIDERS[p].models.map((m) => {
                  const selected = route.provider === p && activeCfg.model === m.id;
                  return {
                    key: `${p}:${m.id}`,
                    label: m.label,
                    description: m.note,
                    selected,
                    hint: selected ? '✓' : undefined,
                    onSelect: () => onSelectProvider(p, m.id),
                  };
                }),
              ];
            }),
            'divider' as const,
            { label: 'AI routing, permissions & vault…', icon: <KeyRound className="h-4 w-4" />, onSelect: onOpenKeySettings },
          ]}
        />
        <div className="flex items-center gap-1.5">
          {onToggleWebSearch && (
            <button
              type="button"
              onClick={() => onToggleWebSearch(!webEnabled)}
              title="Allow AI agent to query Europe PMC & ClinicalTrials.gov via MCP"
              className={cx(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                webEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200',
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden @lg:inline">Web {webEnabled ? 'ON' : 'OFF'}</span>
            </button>
          )}
          {onOpenMcpServer && (
            <button
              type="button"
              onClick={onOpenMcpServer}
              title={`Open In-App MCP Server (${MCP_TOOLS.length} tools)`}
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20"
            >
              <Server className="h-3.5 w-3.5" />
              <span className="hidden @lg:inline">MCP ({MCP_TOOLS.length})</span>
            </button>
          )}
          {userTurns > 0 && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={onClear} disabled={busy}>
              New chat
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-5 py-5">
          {userTurns === 0 && (
            <div className="pt-4 pb-2">
              <h2 className="text-lg font-semibold text-slate-100">Autonomous AI Copilot ({MCP_TOOLS.length} MCP tools)</h2>
              <p className="mt-1 text-sm text-slate-400">
                Inspects loaded 3D structures, designs molecules in RDKit, creates projects, splits chains/ligands, stages binding, runs GPU pipelines, controls the Studio UI, and shows its step-by-step thinking trace.
              </p>
              {!hasKey && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                  <KeyRound className="h-4 w-4 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1 text-sm text-slate-300">
                    Add your own Anthropic, Gemini, or OpenAI/Codex BYOK key in <code className="text-sky-300">state.vscdb</code> (prioritized over Synlexa Cloud), or sign in to synlexa.com. Until then, the built-in deterministic Copilot handles workspace commands.
                  </div>
                  <Button size="sm" variant="primary" onClick={onOpenKeySettings}>
                    Set up AI
                  </Button>
                </div>
              )}
              <div className="mt-5 grid gap-2 @xl:grid-cols-2">
                {(hasKey ? SUGGESTIONS : OFFLINE_SUGGESTIONS).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    disabled={busy}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 text-left text-sm text-slate-300 transition-colors hover:border-sky-400/40 hover:bg-sky-400/[0.04] hover:text-slate-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, idx) => {
            if (m.role === 'assistant' && idx === 0 && userTurns === 0) return null;
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-sky-500/15 px-4 py-2.5 text-sm whitespace-pre-wrap text-slate-100">
                    {m.text}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-sky-300">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <ThinkingProcessPanel
                    thinkingTrace={m.thinkingTrace}
                    stepTrace={m.stepTrace}
                    executedTools={m.executedTools}
                    durationMs={m.durationMs}
                    defaultOpen={false}
                  />
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <MarkdownContent text={m.text} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-slate-500">
                    {m.mode === 'local-deterministic-fallback' ? (
                      <Badge>Built-in assistant</Badge>
                    ) : (
                      <Badge tone={m.mode === 'synlexa-cloud' ? 'accent' : 'good'}>
                        {m.providerLabel ?? (m.mode === 'synlexa-cloud' ? `Synlexa Cloud · ${m.model}` : `BYOK · ${m.model}`)}
                      </Badge>
                    )}
                    {m.usage && (m.usage.inputTokens > 0 || m.usage.outputTokens > 0) && (
                      <span className="tabular-nums">
                        {m.usage.inputTokens.toLocaleString()} in · {m.usage.outputTokens.toLocaleString()} out
                      </span>
                    )}
                    {typeof m.durationMs === 'number' && m.durationMs > 0 && (
                      <span className="tabular-nums">
                        · {m.durationMs < 1000 ? `${m.durationMs}ms` : `${(m.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    )}
                    {m.error && <Badge tone="warn">{m.error}</Badge>}
                    <span>Model output is provisional · RUO</span>
                    <CopyMessageButton text={m.text} />
                  </div>
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <ThinkingProcessPanel stepTrace={liveSteps} defaultOpen running />
              </div>
            </div>
          )}

          {pendingPermission && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/[0.08] p-4 shadow-lg">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-amber-100">{pendingPermission.title}</span>
                    <Badge tone="warn">{pendingPermission.category}</Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-200">{pendingPermission.detail}</p>
                  {Object.keys(pendingPermission.args).length > 0 && (
                    <pre className="overflow-x-auto rounded-lg bg-black/35 px-2.5 py-1.5 font-mono text-[0.7rem] text-slate-300">
                      {JSON.stringify(pendingPermission.args, null, 2)}
                    </pre>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="primary" onClick={() => onResolvePermission?.('allow_once')}>
                      Allow once
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onResolvePermission?.('allow_session')}>
                      Always allow this session
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => onResolvePermission?.('deny')}>
                      Deny
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 focus-within:border-sky-400/50">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the agent to inspect, design molecules, split chains, test docking, open tabs, or search literature…"
            className="max-h-44 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
          />
          <button
            type="button"
            onClick={() => submit()}
            disabled={!draft.trim() || busy}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-slate-950 transition hover:bg-sky-400 disabled:bg-white/[0.08] disabled:text-slate-500"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-auto mt-1.5 flex max-w-3xl items-center justify-between px-1 text-[0.6875rem] text-slate-500">
          <Fragment>Enter to send · Shift+Enter for a new line · Keys encrypted in state.vscdb · Research use only</Fragment>
        </div>
      </div>
    </div>
  );
}
