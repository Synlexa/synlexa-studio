import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  installCustomPlugin,
  listAllPlugins,
  removeCustomPlugin,
  subscribePlugins,
  togglePlugin,
  type PluginTier,
} from '../lib/pluginRegistry';
import { Badge, Button, Card, Input, Textarea, Toggle } from './ui';

interface PluginsViewProps {
  onOpenComputeNodes: () => void;
  onOpenMcpServer: () => void;
}

const TIER_LABELS: Record<PluginTier | 'all', string> = {
  all: 'All Tiers',
  'tier0-core': 'Tier 0 · Instant Wasm/Rust',
  'tier1-wasm': 'Tier 1 · Browser Engine',
  'tier2-compute': 'Tier 2 · External GPU/HPC',
  database: 'Public Databases',
};

const SAMPLE_CUSTOM_MANIFEST = JSON.stringify(
  {
    schemaVersion: '1.0.0',
    id: 'org.lab.custom-scorer',
    name: 'Custom Scoring Adapter',
    version: '0.1.0',
    category: 'Cheminformatics ML',
    tier: 'tier2-compute',
    license: 'MIT',
    commercialSafe: true,
    ruoRequired: true,
    description: 'Example user add-on wrapping a custom scoring script on a connected Compute Node.',
    computeAdapterId: 'ml_property',
    mcpTools: [
      {
        name: 'run_custom_ml_scorer',
        description: 'Score candidate SMILES with custom Chemprop/DeepChem checkpoint.',
        computeToolId: 'ml_property',
        inputSchema: {
          type: 'object',
          properties: {
            smiles: { type: 'string', description: 'Input SMILES' },
          },
          required: ['smiles'],
        },
      },
    ],
  },
  null,
  2,
);

export function PluginsView({ onOpenComputeNodes, onOpenMcpServer }: PluginsViewProps) {
  const [plugins, setPlugins] = useState(() => listAllPlugins());
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<PluginTier | 'all'>('all');
  const [customOpen, setCustomOpen] = useState(false);
  const [customJson, setCustomJson] = useState(SAMPLE_CUSTOM_MANIFEST);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    setPlugins(listAllPlugins());
    return subscribePlugins(() => setPlugins(listAllPlugins()));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins.filter((p) => {
      if (tierFilter !== 'all' && p.tier !== tierFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.category} ${p.license} ${p.description}`.toLowerCase().includes(q);
    });
  }, [plugins, query, tierFilter]);

  const handleInstallCustom = () => {
    setCustomError(null);
    try {
      installCustomPlugin(customJson);
      setCustomOpen(false);
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-xs">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Puzzle className="h-4 w-4 text-sky-400" />
              Biochemistry Plugins & Add-ons
            </h2>
            <p className="mt-1 text-slate-400">
              Manage built-in open-source engines, external GPU adapters, database connectors, and custom{' '}
              <code className="text-sky-300">synlexa-plugin.v1</code> add-ons. Enabled plugin tools auto-wire into MCP
              and the AI Assistant.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onOpenComputeNodes}>
              Configure GPU Nodes
            </Button>
            <Button size="sm" variant="secondary" onClick={onOpenMcpServer}>
              View Exposed MCP Tools
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setCustomOpen((v) => !v)}
            >
              Install Custom Manifest
            </Button>
          </div>
        </div>

        {customOpen && (
          <Card className="space-y-2.5 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Install Custom Plugin (`synlexa-plugin.v1`)</span>
              <Button size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>
                Close
              </Button>
            </div>
            <Textarea
              rows={10}
              value={customJson}
              onChange={(e) => setCustomJson(e.target.value)}
              className="font-mono text-[0.6875rem]"
            />
            {customError && (
              <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-rose-200">
                {customError}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[0.6875rem] text-slate-500">
                Enforces <code className="text-slate-300">ruoRequired: true</code> and declarative schema validation.
              </span>
              <Button size="sm" variant="primary" onClick={handleInstallCustom}>
                Validate & Install
              </Button>
            </div>
          </Card>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter tools, categories, licenses…"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'tier0-core', 'tier1-wasm', 'tier2-compute', 'database'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  tierFilter === tier
                    ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20'
                }`}
              >
                {TIER_LABELS[tier]}
              </button>
            ))}
          </div>
        </div>

        {/* Plugin Grid */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="flex flex-col justify-between gap-3 p-3.5">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-100">{p.name}</span>
                      {p.topPick && (
                        <Badge tone="accent">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Top 8
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[0.6875rem] text-slate-400">
                      {p.category} · v{p.version}
                    </div>
                  </div>
                  <Toggle
                    checked={p.enabled}
                    onChange={(next) => togglePlugin(p.id, next)}
                    label={`Toggle ${p.name}`}
                  />
                </div>

                <p className="text-slate-300 leading-relaxed">{p.description}</p>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={p.commercialSafe ? 'good' : 'warn'}>
                    {p.commercialSafe ? (
                      <ShieldCheck className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {p.license}
                  </Badge>
                  <Badge tone="neutral">{p.tier}</Badge>
                  {p.requiresGpu && <Badge tone="warn">GPU recommended</Badge>}
                  {p.mcpTools && p.mcpTools.length > 0 && (
                    <Badge tone="accent">{p.mcpTools.length} MCP tool</Badge>
                  )}
                </div>

                {p.installHint && (
                  <div className="rounded border border-white/[0.06] bg-[#070b12] px-2 py-1 font-mono text-[0.6875rem] text-slate-400">
                    {p.installHint}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-2 text-[0.6875rem] text-slate-500">
                <span className="truncate font-mono">{p.id}</span>
                <div className="flex items-center gap-2">
                  {p.homepage && (
                    <a
                      href={p.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-sky-300 hover:text-sky-200"
                    >
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {!p.builtin && (
                    <button
                      type="button"
                      onClick={() => removeCustomPlugin(p.id)}
                      className="text-rose-300 hover:text-rose-200"
                      title="Uninstall custom plugin"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
