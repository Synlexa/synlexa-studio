import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  exportWorkflowToNextflow,
  exportWorkflowToSnakemake,
  topologicalSortWorkflow,
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_TEMPLATES,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeRunStatus,
} from '../lib/workflowEngine';
import { Badge, Button, Card, cx } from './ui';

interface WorkflowCanvasProps {
  onExecuteNode: (kind: WorkflowNodeKind, params: Record<string, unknown>) => Promise<{ summary: string; metrics?: Record<string, unknown> }>;
  activeComputeLabel: string | null;
  onOpenComputeNodes: () => void;
}

export function WorkflowCanvas({
  onExecuteNode,
  activeComputeLabel,
  onOpenComputeNodes,
}: WorkflowCanvasProps) {
  const [graph, setGraph] = useState<WorkflowGraph>(() => WORKFLOW_TEMPLATES[0]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(WORKFLOW_TEMPLATES[0].nodes[0]?.id ?? null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [runStates, setRunStates] = useState<Record<string, WorkflowNodeRunStatus>>({});
  const [running, setRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const addNode = (kind: WorkflowNodeKind) => {
    const spec = WORKFLOW_NODE_CATALOG[kind];
    const id = `n${Date.now().toString(36).slice(-4)}`;
    const offset = (graph.nodes.length % 5) * 45;
    setGraph((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id,
          kind,
          x: 80 + offset * 3,
          y: 60 + offset,
          params: { ...spec.defaultParams },
        },
      ],
    }));
    setSelectedNodeId(id);
  };

  const deleteNode = (id: string) => {
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const connectTo = (targetId: string) => {
    if (!connectFromId || connectFromId === targetId) {
      setConnectFromId(null);
      return;
    }
    const exists = graph.edges.some((e) => e.from === connectFromId && e.to === targetId);
    if (!exists) {
      setGraph((prev) => ({
        ...prev,
        edges: [...prev.edges, { id: `e-${connectFromId}-${targetId}`, from: connectFromId, to: targetId }],
      }));
    }
    setConnectFromId(null);
  };

  const runPipeline = async () => {
    setPipelineError(null);
    let ordered;
    try {
      ordered = topologicalSortWorkflow(graph);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : String(err));
      return;
    }

    setRunning(true);
    const initial: Record<string, WorkflowNodeRunStatus> = {};
    for (const n of ordered) initial[n.id] = { status: 'idle' };
    setRunStates(initial);

    try {
      for (const node of ordered) {
        setRunStates((prev) => ({ ...prev, [node.id]: { status: 'running' } }));
        try {
          const out = await onExecuteNode(node.kind, node.params);
          setRunStates((prev) => ({
            ...prev,
            [node.id]: { status: 'completed', summary: out.summary, metrics: out.metrics },
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setRunStates((prev) => ({
            ...prev,
            [node.id]: { status: 'failed', error: msg },
          }));
          setPipelineError(`Stopped at ${WORKFLOW_NODE_CATALOG[node.kind].label}: ${msg}`);
          break;
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const downloadText = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-xs">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <GitBranch className="h-4 w-4 text-sky-400" />
            Visual Workflow Canvas
          </h2>
          <p className="text-slate-400">
            Chain Tier-0 Wasm, Tier-1 RDKit/Mol*, and Tier-2 GPU Compute Nodes into reproducible pipelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenComputeNodes}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:border-sky-500/40"
          >
            GPU Node: <strong className="text-sky-300">{activeComputeLabel ?? 'Not paired'}</strong>
          </button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => downloadText('main.nf', exportWorkflowToNextflow(graph))}
          >
            Nextflow
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => downloadText('Snakefile', exportWorkflowToSnakemake(graph))}
          >
            Snakemake
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => downloadText(`${graph.id}.synlexa-flow.json`, JSON.stringify(graph, null, 2))}
          >
            JSON
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={running}
            icon={running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            onClick={() => void runPipeline()}
          >
            {running ? 'Running Pipeline…' : 'Run DAG'}
          </Button>
        </div>
      </div>

      {/* Templates & Node Palette */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#0b1018] p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] font-semibold text-slate-400 uppercase">Templates:</span>
          {WORKFLOW_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                setGraph(tpl);
                setRunStates({});
                setPipelineError(null);
              }}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-xs transition',
                graph.id === tpl.id
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600',
              )}
            >
              {tpl.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[0.6875rem] text-slate-500">Add Node:</span>
          {(Object.keys(WORKFLOW_NODE_CATALOG) as WorkflowNodeKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => addNode(kind)}
              className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-[0.6875rem] text-slate-300 hover:border-sky-500/40"
            >
              <Plus className="h-2.5 w-2.5" />
              {WORKFLOW_NODE_CATALOG[kind].label}
            </button>
          ))}
        </div>
      </div>

      {pipelineError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200">
          {pipelineError}
        </div>
      )}

      {/* Interactive SVG + Card DAG Canvas */}
      <div className="relative min-h-[340px] flex-1 overflow-auto rounded-xl border border-white/[0.08] bg-[#070b12]">
        <div className="relative h-[380px] min-w-[1160px]">
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <pattern id="synlexa-dag-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(148,163,184,0.05)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#synlexa-dag-grid)" />
            {graph.edges.map((e) => {
              const a = nodeMap.get(e.from);
              const b = nodeMap.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + 195;
              const y1 = a.y + 44;
              const x2 = b.x;
              const y2 = b.y + 44;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={e.id}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="rgba(56,189,248,0.45)"
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const spec = WORKFLOW_NODE_CATALOG[node.kind];
            const st = runStates[node.id];
            const isSelected = selectedNodeId === node.id;
            return (
              <div
                key={node.id}
                style={{ left: node.x, top: node.y, width: 196 }}
                onClick={() => {
                  if (connectFromId && connectFromId !== node.id) {
                    connectTo(node.id);
                  } else {
                    setSelectedNodeId(node.id);
                  }
                }}
                className={cx(
                  'absolute cursor-pointer rounded-xl border bg-[#0d121b]/95 p-2.5 shadow-lg transition',
                  isSelected ? 'border-sky-400/70 ring-1 ring-sky-400/30' : 'border-white/10 hover:border-white/25',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100">{spec.label}</div>
                    <div className="truncate font-mono text-[0.6875rem] text-slate-400">{spec.toolName}</div>
                  </div>
                  {st?.status === 'running' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />}
                  {st?.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  {st?.status === 'failed' && <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />}
                </div>

                <div className="mt-2 flex items-center justify-between gap-1">
                  <Badge tone={spec.tier === 'tier2-gpu' ? 'warn' : spec.tier === 'tier1-wasm' ? 'accent' : 'good'}>
                    {spec.tier}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnectFromId(connectFromId === node.id ? null : node.id);
                      }}
                      className={cx(
                        'rounded border px-1.5 py-0.5 text-[0.625rem]',
                        connectFromId === node.id
                          ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                          : 'border-slate-700 text-slate-400 hover:text-slate-200',
                      )}
                    >
                      {connectFromId === node.id ? 'Click target…' : 'Link →'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNode(node.id);
                      }}
                      className="rounded p-0.5 text-slate-500 hover:text-rose-300"
                      title="Delete node"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {st?.summary && (
                  <div className="mt-1.5 truncate font-mono text-[0.6875rem] text-emerald-300" title={st.summary}>
                    {st.summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Node Inspector */}
      {selectedNode && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div>
            <div className="font-semibold text-slate-100">
              {WORKFLOW_NODE_CATALOG[selectedNode.kind].label} ({selectedNode.id})
            </div>
            <div className="text-[0.6875rem] text-slate-400">
              {WORKFLOW_NODE_CATALOG[selectedNode.kind].inputPort} → {WORKFLOW_NODE_CATALOG[selectedNode.kind].outputPort}
            </div>
          </div>
          <pre className="rounded bg-[#070b12] px-2.5 py-1.5 font-mono text-[0.6875rem] text-slate-300">
            {JSON.stringify(selectedNode.params)}
          </pre>
        </Card>
      )}
    </div>
  );
}
