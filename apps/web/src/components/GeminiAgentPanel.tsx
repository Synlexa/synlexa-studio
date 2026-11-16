import { useState } from 'react';
import {
  Bot,
  Cpu,
  KeyRound,
  Loader2,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  GEMINI_MODELS,
  type AgentChatMessage,
  type GeminiConfig,
  type GeminiModelId,
} from '../lib/geminiAgent';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingProcessPanel } from './ThinkingProcessPanel';

interface GeminiAgentPanelProps {
  messages: AgentChatMessage[];
  busy: boolean;
  config: GeminiConfig;
  onUpdateConfig: (update: { apiKey?: string; model?: GeminiModelId }) => void;
  onSendPrompt: (prompt: string) => void;
  simpleMode?: boolean;
}

const QUICK_PROMPTS_SIMPLE = [
  'Explain what these metrics mean in plain English',
  'Focus the active-site histidine 94',
  'Try H94A mutation and compare stability',
  'Show Ramachandran geometry summary',
];

const QUICK_PROMPTS_PRO = [
  'explain_result',
  'focus_residues 94, 96, 119',
  'mutate H94A',
  'list_artifacts',
];

export function GeminiAgentPanel({
  messages,
  busy,
  config,
  onUpdateConfig,
  onSendPrompt,
  simpleMode = false,
}: GeminiAgentPanelProps) {
  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(config.keySource === 'localStorage' ? config.apiKey : '');
  const [modelInput, setModelInput] = useState<GeminiModelId>(config.model);

  const hasKey = config.apiKey.length > 0;
  const chips = hasKey || simpleMode ? QUICK_PROMPTS_SIMPLE : QUICK_PROMPTS_PRO;

  const submit = () => {
    const clean = draft.trim();
    if (!clean || busy) return;
    onSendPrompt(clean);
    setDraft('');
  };

  const saveSettings = () => {
    onUpdateConfig({
      apiKey: keyInput,
      model: modelInput,
    });
    setSettingsOpen(false);
  };

  const clearLocalKey = () => {
    setKeyInput('');
    onUpdateConfig({ apiKey: '', model: modelInput });
  };

  return (
    <section className="flex flex-col rounded-lg border border-slate-800/90 bg-slate-900/50 p-2.5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {hasKey ? (
            <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          ) : (
            <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
          )}
          <span className="truncate font-mono text-[0.75rem] font-semibold text-slate-100">
            {hasKey ? 'GEMINI AI AGENT' : 'STUDIO COPILOT'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[0.6875rem] ${
              hasKey
                ? 'border border-cyan-500/35 bg-cyan-500/10 text-cyan-200'
                : 'border border-slate-700 bg-slate-950 text-slate-400'
            }`}
          >
            {hasKey ? config.model : 'offline deterministic'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setModelInput(config.model);
            setKeyInput(config.keySource === 'localStorage' ? config.apiKey : '');
            setSettingsOpen((v) => !v);
          }}
          className="flex items-center gap-1 rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 font-mono text-[0.6875rem] text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-200"
          title="Configure Gemini API Key & Model"
        >
          <KeyRound className="h-2.5 w-2.5" />
          <span>{hasKey ? 'Settings' : 'Add Key'}</span>
        </button>
      </div>

      {/* Inline API Key & Model Settings Popover */}
      {settingsOpen && (
        <div className="mb-2 space-y-2 rounded border border-cyan-500/35 bg-[#070b12] p-2.5 text-[0.8125rem]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.75rem] font-semibold text-cyan-200">
              GEMINI API SETTINGS
            </span>
            <span className="font-mono text-[0.6875rem] text-slate-500">
              {config.keySource === 'env'
                ? 'Using build VITE_GEMINI_API_KEY'
                : config.keySource === 'localStorage'
                  ? 'Saved locally'
                  : 'No key configured'}
            </span>
          </div>

          <div className="space-y-1">
            <label className="block font-mono text-[0.6875rem] text-slate-400">Model</label>
            <select
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value as GeminiModelId)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.75rem] text-slate-100 outline-none focus:border-cyan-500"
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block font-mono text-[0.6875rem] text-slate-400">
              Gemini API Key (stored in browser localStorage only)
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={config.keySource === 'env' ? 'Env key active (override optional)' : 'AIza…'}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[0.75rem] text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={clearLocalKey}
              className="rounded border border-slate-700 px-2 py-1 font-mono text-[0.6875rem] text-slate-400 hover:text-rose-200"
            >
              Clear Local Key
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded border border-slate-700 px-2 py-1 font-mono text-[0.6875rem] text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1 font-mono text-[0.6875rem] font-medium text-cyan-100 hover:bg-cyan-500/30"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Prompt Chips */}
      <div className="mb-2 flex flex-wrap gap-1">
        {chips.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={busy}
            onClick={() => onSendPrompt(prompt)}
            className="rounded border border-slate-700/80 bg-slate-950/90 px-1.5 py-0.5 text-left text-[0.6875rem] text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-200 disabled:opacity-40"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Stream */}
      <div className="mb-2 max-h-56 space-y-2 overflow-y-auto rounded border border-slate-800/80 bg-[#070a10] p-2 text-[0.8125rem]">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded p-2 ${
              m.role === 'user'
                ? 'ml-4 border border-cyan-500/20 bg-cyan-500/10 text-cyan-100'
                : 'border border-slate-800/80 bg-slate-900/75 text-slate-200'
            }`}
          >
            {m.role === 'assistant' ? (
              <div className="space-y-1.5">
                <ThinkingProcessPanel
                  thinkingTrace={m.thinkingTrace}
                  stepTrace={m.stepTrace}
                  executedTools={m.executedTools}
                  durationMs={m.durationMs}
                  compact
                />
                <MarkdownContent text={m.text} compact />
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</div>
            )}

            {m.citations && m.citations.length > 0 && (
              <div className="mt-1 truncate font-mono text-[0.625rem] text-slate-500">
                Grounded refs: {m.citations.join(' · ')}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/60 p-2 font-mono text-[0.75rem] text-cyan-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Executing grounded tools &amp; reasoning…</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={
            hasKey
              ? 'Ask Gemini to inspect, mutate, edit, or fetch…'
              : 'Ask Copilot (or add Gemini API key)…'
          }
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[0.8125rem] text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={submit}
          className="rounded border border-cyan-500/40 bg-cyan-500/15 p-1.5 text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1 font-mono text-[0.6875rem] text-amber-300/80">
        <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
        <span>RUO assistant · Deterministic Wasm owns all calculations</span>
      </div>
    </section>
  );
}
