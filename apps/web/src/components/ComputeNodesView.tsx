import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Eye,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  addOrUpdateComputeNode,
  cancelComputeJob,
  downloadAndVerifyArtifact,
  getComputeSnapshot,
  probeComputeNode,
  removeComputeNode,
  setActiveComputeNode,
  submitComputeJob,
  subscribeComputeState,
  waitForComputeJob,
  type ComputeArtifact,
  type ComputeJobRecord,
} from '../lib/computeBridge';
import type { DockingBoxSpec } from '../lib/dockingBox';
import { Badge, Button, Card, cx, Input } from './ui';

interface ComputeNodesViewProps {
  activeSmiles: string;
  activeSmilesName: string;
  activeRefPdbOrCif: string;
  activeRefLabel: string;
  pocketBox: DockingBoxSpec | null;
  stagedComputeTarget?: { tool: 'vina' | 'pyscf'; nonce: number } | null;
  onImportArtifactToViewer: (payload: {
    label: string;
    content: string;
    format: 'pdb' | 'mmcif' | 'sdf' | 'pdbqt' | 'mol';
  }) => void;
}

type RunnerPreset = 'vina_docking' | 'openmm_md' | 'boltz_predict' | 'pyscf_qm' | 'rfdiffusion_design';

export function ComputeNodesView({
  activeSmiles,
  activeSmilesName,
  activeRefPdbOrCif,
  activeRefLabel,
  pocketBox,
  stagedComputeTarget,
  onImportArtifactToViewer,
}: ComputeNodesViewProps) {
  const [snapshot, setSnapshot] = useState(() => getComputeSnapshot());
  const [pairingInput, setPairingInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const [selectedRunner, setSelectedRunner] = useState<RunnerPreset>('vina_docking');
  const [smilesParam, setSmilesParam] = useState(activeSmiles);
  const [proteinSeqParam, setProteinSeqParam] = useState(
    'MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRIL',
  );
  const [mdSteps, setMdSteps] = useState('1000');
  const [dftFunctional, setDftFunctional] = useState('B3LYP');
  const [dftBasis, setDftBasis] = useState('sto-3g');
  const [submitting, setSubmitting] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(getComputeSnapshot());
    return subscribeComputeState(() => setSnapshot(getComputeSnapshot()));
  }, []);

  useEffect(() => {
    setSmilesParam(activeSmiles);
  }, [activeSmiles]);

  useEffect(() => {
    if (!stagedComputeTarget) return;
    setSelectedRunner(stagedComputeTarget.tool === 'pyscf' ? 'pyscf_qm' : 'vina_docking');
  }, [stagedComputeTarget]);

  const activeNode = snapshot.activeNode;

  const handlePair = async () => {
    setPairError(null);
    try {
      const node = await addOrUpdateComputeNode({
        pairingOrEndpoint: pairingInput,
        label: labelInput || undefined,
      });
      setPairingInput('');
      setLabelInput('');
      setProbingId(node.id);
      await probeComputeNode(node.id);
    } catch (err) {
      setPairError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbingId(null);
    }
  };

  const handleProbe = async (nodeId: string) => {
    setProbingId(nodeId);
    setPairError(null);
    try {
      await probeComputeNode(nodeId);
    } finally {
      setProbingId(null);
    }
  };

  const handleRunJob = async () => {
    if (!activeNode) {
      setJobError('Connect and select a compute node first.');
      return;
    }
    setSubmitting(true);
    setJobError(null);
    try {
      let params: Record<string, unknown> = {};
      if (selectedRunner === 'vina_docking') {
        params = {
          ligandSmiles: smilesParam,
          receptorPdb: activeRefPdbOrCif,
          center: pocketBox?.center ?? [0, 0, 0],
          size: pocketBox?.size ?? [22, 22, 22],
          exhaustiveness: 8,
          numModes: 9,
        };
      } else if (selectedRunner === 'openmm_md') {
        params = {
          pdbContent: activeRefPdbOrCif,
          steps: Number.parseInt(mdSteps, 10) || 1000,
          temperatureK: 300,
        };
      } else if (selectedRunner === 'boltz_predict') {
        params = {
          sequences: [
            { id: 'A', sequence: proteinSeqParam.trim() },
            ...(smilesParam.trim() ? [{ id: 'B', smiles: smilesParam.trim() }] : []),
          ],
          useMsaServer: true,
        };
      } else if (selectedRunner === 'pyscf_qm') {
        params = {
          smiles: smilesParam,
          functional: dftFunctional,
          basis: dftBasis,
        };
      } else if (selectedRunner === 'rfdiffusion_design') {
        params = {
          targetPdb: activeRefPdbOrCif,
          contigs: '[A1-60/0 50-70]',
          numDesigns: 2,
        };
      }

      const job = await submitComputeJob(activeNode.id, selectedRunner, params);
      void waitForComputeJob(activeNode.id, job.job_id);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadArtifact = async (job: ComputeJobRecord, art: ComputeArtifact) => {
    if (!job.nodeId) return;
    const text = await downloadAndVerifyArtifact(job.nodeId, job.job_id, art);
    const fmt =
      art.format === 'cif'
        ? 'mmcif'
        : art.format === 'pdbqt'
          ? 'pdbqt'
          : art.format === 'sdf'
            ? 'sdf'
            : art.format === 'mol'
              ? 'mol'
              : 'pdb';
    onImportArtifactToViewer({ label: `${job.tool_id}:${art.name}`, content: text, format: fmt });
  };

  const localCmd = 'cd services/compute-worker && python3 -m synlexa_compute.server --port 4180 --tunnel';

  return (
    <div className="h-full overflow-y-auto p-4 text-xs">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Server className="h-4 w-4 text-sky-400" />
              External GPU & Compute Nodes (Tier-2 Bridge)
            </h2>
            <p className="mt-1 text-slate-400">
              Pair Google Colab (T4/L4/A100), local CUDA/Apple Metal workstations, Docker, or remote HPC servers to run
              AutoDock Vina, OpenMM, Boltz-2, RFdiffusion + ProteinMPNN, GROMACS, and PySCF.
            </p>
          </div>
          <Badge tone="warn">Tokens sealed in AES-256-GCM state.vscdb</Badge>
        </div>

        {/* Pair New Compute Node */}
        <Card className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Cloud className="h-4 w-4 text-sky-400" />
              Pair Colab, Local, or Remote GPU Node
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(localCmd);
                setCopiedCmd(true);
                setTimeout(() => setCopiedCmd(false), 1500);
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[0.6875rem] text-slate-300 hover:border-sky-500/50"
            >
              <Copy className="h-3 w-3" />
              {copiedCmd ? 'Copied start command!' : 'Copy worker start command'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[12rem_1fr_auto]">
            <Input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Node label (e.g. Colab T4)"
            />
            <Input
              value={pairingInput}
              onChange={(e) => setPairingInput(e.target.value)}
              placeholder="Paste synlexa-node://https://xxxx.trycloudflare.com#<token> or http://127.0.0.1:4180#<token>"
              className="font-mono"
            />
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void handlePair()}>
              Pair & Probe
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-slate-400">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span>
              Colab notebook: <code className="text-sky-300">services/compute-worker/colab/synlexa_colab_gpu.ipynb</code>
            </span>
            <span>·</span>
            <span>
              Local command: <code className="text-slate-300">{localCmd}</code>
            </span>
          </div>

          {pairError && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-rose-200">
              {pairError}
            </div>
          )}
        </Card>

        {/* Nodes + Active Capabilities */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-5">
            <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Registered Nodes ({snapshot.nodes.length})
            </div>
            {snapshot.nodes.length === 0 ? (
              <Card className="p-4 text-slate-400">
                No external nodes paired yet. Start <code className="text-slate-200">synlexa-compute</code> locally or in
                Google Colab and paste its <code className="text-sky-300">synlexa-node://</code> pairing string above.
              </Card>
            ) : (
              snapshot.nodes.map((node) => {
                const selected = node.id === activeNode?.id;
                const primaryGpu = node.capabilities?.gpus?.[0];
                return (
                  <div
                    key={node.id}
                    onClick={() => setActiveComputeNode(node.id)}
                    className={cx(
                      'cursor-pointer rounded-xl border p-3 transition',
                      selected
                        ? 'border-sky-500/60 bg-sky-500/[0.06]'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cx(
                            'h-2 w-2 rounded-full',
                            node.online ? 'bg-emerald-400' : 'bg-slate-600',
                          )}
                        />
                        <span className="font-semibold text-slate-100">{node.label}</span>
                        <Badge tone={node.kind === 'colab' ? 'accent' : 'neutral'}>{node.kind}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleProbe(node.id);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                          title="Re-probe node"
                        >
                          <RefreshCw className={cx('h-3.5 w-3.5', probingId === node.id && 'animate-spin')} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeComputeNode(node.id);
                          }}
                          className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-rose-300"
                          title="Remove node"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 truncate font-mono text-[0.6875rem] text-slate-400">
                      {node.endpoint}
                    </div>
                    {node.capabilities ? (
                      <div className="mt-2 flex flex-wrap gap-2 text-[0.6875rem] text-slate-300">
                        <span className="flex items-center gap-1">
                          <Cpu className="h-3 w-3 text-emerald-400" />
                          {primaryGpu
                            ? `${primaryGpu.name}${primaryGpu.vram_mb ? ` (${(primaryGpu.vram_mb / 1024).toFixed(1)} GB)` : ''}`
                            : `${node.capabilities.cpu_cores} CPU cores`}
                        </span>
                        <span>·</span>
                        <span>{node.capabilities.tools.filter((t) => t.installed).length} tools ready</span>
                      </div>
                    ) : node.lastError ? (
                      <div className="mt-1.5 text-[0.6875rem] text-amber-300">{node.lastError}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Installed Engines & Direct Runner */}
          <div className="space-y-3 lg:col-span-7">
            <Card className="p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-slate-200">Run GPU / HPC Workload</span>
                <span className="font-mono text-[0.6875rem] text-slate-400">
                  Target: {activeNode ? `${activeNode.label} (${activeNode.online ? 'online' : 'offline'})` : 'None'}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 pb-2.5">
                {(
                  [
                    ['vina_docking', 'AutoDock Vina'],
                    ['openmm_md', 'OpenMM MD'],
                    ['boltz_predict', 'Boltz-2 AI'],
                    ['rfdiffusion_design', 'RFdiffusion'],
                    ['pyscf_qm', 'PySCF DFT'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedRunner(id)}
                    className={cx(
                      'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                      selectedRunner === id
                        ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                        : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-2 rounded-lg border border-white/[0.06] bg-[#070b12] p-2.5">
                {(selectedRunner === 'vina_docking' || selectedRunner === 'pyscf_qm' || selectedRunner === 'boltz_predict') && (
                  <div>
                    <div className="mb-1 text-[0.6875rem] text-slate-400">
                      Ligand SMILES ({activeSmilesName})
                    </div>
                    <Input
                      value={smilesParam}
                      onChange={(e) => setSmilesParam(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                )}

                {selectedRunner === 'vina_docking' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-slate-400">
                    <span>Receptor: <strong className="text-slate-200">{activeRefLabel || 'None'}</strong></span>
                    <span>
                      Box: {pocketBox ? `${pocketBox.sourceLabel} · [${pocketBox.center.join(', ')}]` : 'Default [0, 0, 0]'}
                    </span>
                  </div>
                )}

                {selectedRunner === 'openmm_md' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[0.6875rem] text-slate-400">Receptor Structure</div>
                      <div className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-slate-300">
                        {activeRefLabel || 'None loaded'}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[0.6875rem] text-slate-400">MD Steps (2 fs/step)</div>
                      <Input value={mdSteps} onChange={(e) => setMdSteps(e.target.value)} className="font-mono" />
                    </div>
                  </div>
                )}

                {selectedRunner === 'boltz_predict' && (
                  <div>
                    <div className="mb-1 text-[0.6875rem] text-slate-400">Protein Sequence (Chain A)</div>
                    <textarea
                      rows={3}
                      value={proteinSeqParam}
                      onChange={(e) => setProteinSeqParam(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0d1119] p-2 font-mono text-xs text-slate-100 outline-none focus:border-sky-400/60"
                    />
                  </div>
                )}

                {selectedRunner === 'pyscf_qm' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[0.6875rem] text-slate-400">Functional</div>
                      <Input value={dftFunctional} onChange={(e) => setDftFunctional(e.target.value)} className="font-mono" />
                    </div>
                    <div>
                      <div className="mb-1 text-[0.6875rem] text-slate-400">Basis Set</div>
                      <Input value={dftBasis} onChange={(e) => setDftBasis(e.target.value)} className="font-mono" />
                    </div>
                  </div>
                )}

                {jobError && (
                  <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-rose-200">
                    {jobError}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="flex items-center gap-1 text-[0.6875rem] text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-400/80" />
                    RUO provenance & SHA-256 verified on return
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={submitting || !activeNode?.online}
                    icon={<Play className="h-3.5 w-3.5" />}
                    onClick={() => void handleRunJob()}
                  >
                    {submitting ? 'Submitting…' : 'Dispatch to Node'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Installed Tools Matrix on Selected Node */}
            {activeNode?.capabilities && (
              <Card className="p-3.5">
                <div className="mb-2 text-xs font-semibold text-slate-200">
                  Detected Engines on {activeNode.label}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {activeNode.capabilities.tools.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#070b12] px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-slate-200">
                          {t.installed ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                          )}
                          <span className="truncate">{t.name}</span>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-slate-500">
                          {t.installed ? t.version ?? 'installed' : t.install_hint}
                        </div>
                      </div>
                      <Badge tone={t.commercial_safe ? 'neutral' : 'warn'}>{t.license}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Job Telemetry & Artifact History */}
        <Card className="p-3.5">
          <div className="mb-2 flex items-center gap-2 font-semibold text-slate-200">
            <Activity className="h-4 w-4 text-sky-400" />
            Remote Compute Job Queue ({snapshot.jobs.length})
          </div>
          {snapshot.jobs.length === 0 ? (
            <p className="text-slate-500">Dispatched GPU/HPC jobs appear here with live logs and verified artifacts.</p>
          ) : (
            <div className="space-y-2">
              {snapshot.jobs.map((job) => (
                <div key={job.job_id} className="rounded-lg border border-white/[0.07] bg-[#070b12] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-100">{job.tool_id}</span>
                      <span className="font-mono text-[0.6875rem] text-slate-500">{job.job_id}</span>
                      <Badge
                        tone={
                          job.status === 'completed'
                            ? 'good'
                            : job.status === 'failed'
                              ? 'bad'
                              : job.status === 'running'
                                ? 'accent'
                                : 'warn'
                        }
                      >
                        {job.status} · {Math.round(job.progress * 100)}%
                      </Badge>
                    </div>
                    {job.status === 'running' && job.nodeId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void cancelComputeJob(job.nodeId!, job.job_id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>

                  {job.error_message && (
                    <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[0.6875rem] text-amber-200">
                      {job.error_code}: {job.error_message}
                    </div>
                  )}

                  {Object.keys(job.metrics).length > 0 && (
                    <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950 p-2 font-mono text-[0.6875rem] text-emerald-300">
                      {JSON.stringify(job.metrics, null, 2)}
                    </pre>
                  )}

                  {job.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {job.artifacts.map((art) => (
                        <button
                          key={art.name}
                          type="button"
                          onClick={() => void handleLoadArtifact(job, art)}
                          className="flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-1 font-mono text-[0.6875rem] text-sky-200 hover:bg-sky-500/25"
                        >
                          <Eye className="h-3 w-3" /> Load {art.name} ({art.sha256.slice(0, 8)})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
