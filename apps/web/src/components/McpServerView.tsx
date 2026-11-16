import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Lock,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  clearMcpLogs,
  getEffectiveMcpTools,
  getExternalMcpSnippets,
  getMcpLogs,
  handleMcpJsonRpc,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  subscribeMcpLogs,
  type McpLogEntry,
  type McpServerRuntime,
} from '../lib/mcpServer';
import { getVaultStatus, subscribeVault } from '../lib/secureKeyVault';
import { RUO_DISCLAIMER } from '../lib/reportGenerator';
import { Badge, Button, Card, cx, Select, Textarea } from './ui';

interface McpServerViewProps {
  runtime: McpServerRuntime;
  onOpenAiAssistant: () => void;
  onOpenVaultSettings: () => void;
}

type ClientPresetId = 'claude-desktop' | 'claude-code' | 'codex' | 'http-local';

const CLIENT_PRESETS: Array<{ id: ClientPresetId; label: string; desc: string }> = [
  { id: 'claude-desktop', label: 'Claude Desktop', desc: 'claude_desktop_config.json (stdio)' },
  { id: 'claude-code', label: 'Claude Code CLI', desc: 'One-line terminal setup' },
  { id: 'codex', label: 'OpenAI Codex CLI', desc: 'Codex CLI & config.toml' },
  { id: 'http-local', label: 'Cursor / HTTP Bridge', desc: 'http://127.0.0.1:4179/mcp' },
];

export function McpServerView({
  runtime,
  onOpenAiAssistant,
  onOpenVaultSettings,
}: McpServerViewProps) {
  const [logs, setLogs] = useState<McpLogEntry[]>(() => getMcpLogs());
  const [vault, setVault] = useState(() => getVaultStatus());
  const [clientTab, setClientTab] = useState<ClientPresetId>('claude-desktop');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [selectedTool, setSelectedTool] = useState<string>(MCP_TOOLS[0].name);
  const [toolArgsJson, setToolArgsJson] = useState<string>('{\n  "section": "all",\n  "topN": 6\n}');
  const [selectedResource, setSelectedResource] = useState<string>(MCP_RESOURCES[0].uri);
  const [playgroundOutput, setPlaygroundOutput] = useState<string>('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const offLogs = subscribeMcpLogs(() => setLogs(getMcpLogs()));
    const offVault = subscribeVault(() => setVault(getVaultStatus()));
    return () => {
      offLogs();
      offVault();
    };
  }, []);

  const snippets = getExternalMcpSnippets(4179);

  const copyText = (id: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleSelectTool = (name: string) => {
    setSelectedTool(name);
    if (name === 'get_workspace_state') {
      setToolArgsJson('{\n  "section": "all",\n  "topN": 6\n}');
    } else if (name === 'search_scientific_web') {
      setToolArgsJson('{\n  "query": "carbonic anhydrase II acetazolamide 3HS4",\n  "scope": "all",\n  "limit": 4\n}');
    } else if (name === 'focus_3d_residues') {
      setToolArgsJson('{\n  "seqIds": [94, 96, 119]\n}');
    } else if (name === 'inspect_chemical_smiles') {
      setToolArgsJson('{\n  "name": "Acetazolamide",\n  "smiles": "CC(=O)Nc1nnc(S(N)(=O)=O)s1"\n}');
    } else if (name === 'engineer_peptide_mutation') {
      setToolArgsJson('{\n  "mutations": ["H94A"],\n  "focusSeqId": 94\n}');
    } else if (name === 'design_crispr_edit') {
      setToolArgsJson('{\n  "transcriptId": "NM_000067.3",\n  "targetCodonIndex": 94,\n  "nuclease": "SpCas9"\n}');
    } else if (name === 'fetch_from_database') {
      setToolArgsJson('{\n  "source": "rcsb",\n  "query": "1UBQ",\n  "autoImport": false\n}');
    } else {
      setToolArgsJson('{}');
    }
  };

  const runPlaygroundTool = async () => {
    setRunning(true);
    try {
      const parsedArgs = JSON.parse(toolArgsJson || '{}') as Record<string, unknown>;
      const res = await handleMcpJsonRpc(
        {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: selectedTool, arguments: parsedArgs },
        },
        runtime,
        'mcp-playground',
      );
      setPlaygroundOutput(JSON.stringify(res, null, 2));
    } catch (err) {
      setPlaygroundOutput(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
      );
    } finally {
      setRunning(false);
    }
  };

  const readPlaygroundResource = async () => {
    setRunning(true);
    try {
      const res = await handleMcpJsonRpc(
        {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'resources/read',
          params: { uri: selectedResource },
        },
        runtime,
        'mcp-playground',
      );
      setPlaygroundOutput(JSON.stringify(res, null, 2));
    } finally {
      setRunning(false);
    }
  };

  const activeSnippet =
    clientTab === 'claude-desktop'
      ? snippets.claudeDesktopJson
      : clientTab === 'claude-code'
        ? snippets.claudeCodeCmd
        : clientTab === 'codex'
          ? `${snippets.codexCliCmd}\n\n# Or add to ~/.codex/config.toml:\n${snippets.codexConfigToml}`
          : snippets.httpEndpointJson;

  const effectiveTools = getEffectiveMcpTools();

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-sky-400 uppercase">
              <Server className="h-3.5 w-3.5" />
              <span>In-App &amp; External MCP Server</span>
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">
              {MCP_SERVER_INFO.name}{' '}
              <span className="font-mono text-sm font-normal text-slate-400">v{MCP_SERVER_INFO.version}</span>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Model Context Protocol (JSON-RPC 2.0) server exposing all deterministic Wasm/Rust kernels, live workspace
              resources, and scientific web search to both Studio&apos;s internal AI Assistant and external agents
              (Claude, OpenAI Codex, Cursor).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Lock className="h-3.5 w-3.5" />} onClick={onOpenVaultSettings}>
              BYOK Vault ({vault.storedProviders.length})
            </Button>
            <Button size="sm" variant="primary" icon={<Bot className="h-3.5 w-3.5" />} onClick={onOpenAiAssistant}>
              Open AI Assistant
            </Button>
          </div>
        </div>

        {/* Status overview cards */}
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="text-xs text-slate-400">MCP Tools</div>
            <div className="mt-1 text-2xl font-semibold text-sky-300 tabular-nums">{effectiveTools.length}</div>
            <div className="mt-0.5 text-xs text-slate-500">Shared by AI &amp; external clients</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="text-xs text-slate-400">Live Resources</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">{MCP_RESOURCES.length}</div>
            <div className="mt-0.5 text-xs text-slate-500">synlexa:// URIs</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="text-xs text-slate-400">Local Key Vault</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>state.vscdb</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{vault.cipher}</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="text-xs text-slate-400">Recent MCP Calls</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums">{logs.length}</div>
            <div className="mt-0.5 text-xs text-slate-500">JSON-RPC 2.0 trace</div>
          </div>
        </div>

        {/* Connect external clients */}
        <Card
          title="Connect Claude, OpenAI Codex, or Cursor"
          description="Attach any MCP-compatible coding or research agent to Studio's deterministic engines via stdio (`synlexa-studio mcp --stdio`) or local HTTP (`http://127.0.0.1:4179/mcp`)."
        >
          <div className="flex flex-wrap gap-1.5 pb-3">
            {CLIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setClientTab(preset.id)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-left text-xs transition-colors',
                  clientTab === preset.id
                    ? 'border-sky-400/60 bg-sky-500/10 text-sky-200'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200',
                )}
              >
                <div className="font-semibold">{preset.label}</div>
                <div className="text-[0.6875rem] text-slate-500">{preset.desc}</div>
              </button>
            ))}
          </div>
          <div className="relative rounded-xl border border-white/10 bg-black/40 p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-mono">
                <Terminal className="h-3.5 w-3.5 text-sky-400" />
                {CLIENT_PRESETS.find((c) => c.id === clientTab)?.desc}
              </span>
              <Button
                size="sm"
                variant="secondary"
                icon={copiedId === clientTab ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={() => copyText(clientTab, activeSnippet)}
              >
                {copiedId === clientTab ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-sky-100">{activeSnippet}</pre>
          </div>
        </Card>

        {/* Interactive MCP Tool & Resource Playground */}
        <div className="grid gap-5 @3xl:grid-cols-2">
          <Card title="MCP Tool Runner (tools/call)" description="Execute any in-app MCP tool directly against live workspace data.">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Tool name</label>
                <Select value={selectedTool} onChange={(e) => handleSelectTool(e.target.value)}>
                  {effectiveTools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-slate-500">
                  {MCP_TOOLS.find((t) => t.name === selectedTool)?.description}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Arguments (JSON)</label>
                <Textarea
                  rows={5}
                  value={toolArgsJson}
                  onChange={(e) => setToolArgsJson(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={running}
                icon={running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                onClick={() => void runPlaygroundTool()}
              >
                Execute MCP Tool
              </Button>
            </div>
          </Card>

          <Card title="MCP Resource Inspector (resources/read)" description="Inspect live structured resources including state.vscdb vault status.">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Resource URI</label>
                <Select value={selectedResource} onChange={(e) => setSelectedResource(e.target.value)}>
                  {MCP_RESOURCES.map((r) => (
                    <option key={r.uri} value={r.uri}>
                      {r.uri} — {r.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-slate-500">
                  {MCP_RESOURCES.find((r) => r.uri === selectedResource)?.description}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/25 p-3 text-xs text-slate-400">
                <div className="flex items-center gap-1.5 font-medium text-slate-200">
                  <Database className="h-3.5 w-3.5 text-sky-400" />
                  <span>Vault: {vault.dbPath}</span>
                </div>
                <div className="mt-1 text-slate-500">
                  Stored BYOK providers: {vault.storedProviders.length > 0 ? vault.storedProviders.join(', ') : 'none yet'}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={running}
                icon={<Database className="h-3.5 w-3.5" />}
                onClick={() => void readPlaygroundResource()}
              >
                Read Resource
              </Button>
            </div>
          </Card>
        </div>

        {playgroundOutput && (
          <Card title="JSON-RPC 2.0 Output">
            <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-200">
              {playgroundOutput}
            </pre>
          </Card>
        )}

        {/* Live MCP Transaction Log */}
        <Card
          title="Live MCP Activity Log"
          description="Calls dispatched by Studio's internal AI Assistant or the MCP playground."
          actions={
            <Button size="sm" variant="ghost" disabled={logs.length === 0} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={clearMcpLogs}>
              Clear
            </Button>
          }
        >
          {logs.length === 0 ? (
            <div className="text-xs text-slate-500">
              No MCP calls recorded yet. Ask the AI Assistant a question or execute a tool above.
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.slice(0, 15).map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs"
                >
                  {entry.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                  )}
                  <Badge tone={entry.caller === 'internal-ai-agent' ? 'accent' : 'neutral'}>{entry.caller}</Badge>
                  <span className="flex items-center gap-1 font-mono text-slate-200">
                    <Wrench className="h-3 w-3 text-slate-500" />
                    {entry.target}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-400">{entry.summary}</span>
                  <span className="font-mono text-slate-500 tabular-nums">{entry.durationMs} ms</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <p className="text-xs text-slate-500">{RUO_DISCLAIMER}</p>
      </div>
    </div>
  );
}
