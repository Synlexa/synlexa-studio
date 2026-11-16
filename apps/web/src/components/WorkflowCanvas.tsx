import { useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  CheckCircle2,
  Download,
  GitBranch,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  Trash2,
  Unlink,
  XCircle,
} from 'lucide-react';
import type { Studio3DBridge } from '../lib/studioBridge';
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
import { Project3DContextBanner, ToolGuideCard } from './WorkbenchShared';

interface WorkflowCanvasProps {
  onExecuteNode: (kind: WorkflowNodeKind, params: Record<string, unknown>) => Promise<{ summary: string; metrics?: Record<string, unknown> }>;
  activeComputeLabel: string | null;
  onOpenComputeNodes: () => void;
  bridge?: Studio3DBridge;
}

export function WorkflowCanvas({
  onExecuteNode,
  activeComputeLabel,
  onOpenComputeNodes,
  bridge,
}: WorkflowCanvasProps) {
  const [graph, setGraph] = useState<WorkflowGraph>(() => WORKFLOW_TEMPLATES[0]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(WORKFLOW_TEMPLATES[0].nodes[0]?.id ?? null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [runStates, setRunStates] = useState<Record<string, WorkflowNodeRunStatus>>({});
  const [running, setRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const canvasBounds = useMemo(() => {
    let maxX = 960;
    let maxY = 340;
    for (const n of graph.nodes) {
      if (n.x + 230 > maxX) maxX = n.x + 230;
      if (n.y + 130 > maxY) maxY = n.y + 130;
    }
    return { width: maxX, height: maxY };
  }, [graph.nodes]);

  const addNode = (kind: WorkflowNodeKind) => {
    const spec = WORKFLOW_NODE_CATALOG[kind];
    const id = `n${Date.now().toString(36).slice(-4)}`;
    const col = graph.nodes.length % 4;
    const row = Math.floor(graph.nodes.length / 4);
    setGraph((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id,
          kind,
          x: 40 + col * 235,
          y: 45 + row * 125,
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

  const deleteEdge = (edgeId: string) => {
    setGraph((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== edgeId),
    }));
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

  const autoLayout = () => {
    let ordered = graph.nodes;
    try {
      ordered = topologicalSortWorkflow(graph);
    } catch {
      // keep existing order if cyclic
    }
    // Assign layers by longest path from roots
    const depth = new Map<string, number>();
    for (const n of ordered) depth.set(n.id, 0);
    for (const n of ordered) {
      const d = depth.get(n.id) ?? 0;
      for (const e of graph.edges) {
        if (e.from === n.id) {
          depth.set(e.to, Math.max(depth.get(e.to) ?? 0, d + 1));
        }
      }
    }
    const byLayer = new Map<number, string[]>();
    for (const n of ordered) {
      const l = depth.get(n.id) ?? 0;
      const arr = byLayer.get(l) ?? [];
      arr.push(n.id);
      byLayer.set(l, arr);
    }
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        const l = depth.get(n.id) ?? 0;
        const siblings = byLayer.get(l) ?? [n.id];
        const idx = siblings.indexOf(n.id);
        return {
          ...n,
          x: 32 + l * 235,
          y: 44 + idx * 124,
        };
      }),
    }));
  };

  const updateNodeParam = (nodeId: string, key: string, value: unknown) => {
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
      ),
    }));
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

  const onNodePointerDown = (e: PointerEvent<HTMLDivElement>, nodeId: string, x: number, y: number) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: x,
      origY: y,
      moved: false,
    };
  };

  const onNodePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const nx = Math.max(16, d.origX + dx);
    const ny = Math.max(16, d.origY + dy);
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)),
    }));
  };

  const onNodePointerUp = (nodeId: string) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      if (connectFromId && connectFromId !== nodeId) {
        connectTo(nodeId);
      } else {
        setSelectedNodeId(nodeId);
      }
    }
  };

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const selectedEdges = selectedNode
    ? graph.edges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
    : [];

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs @xl:p-4">
      <Project3DContextBanner
        bridge={bridge}
        title="Visual Workflow Canvas (DAG)"
        subtitle="Chain local Wasm/RDKit steps and external GPU jobs using your active 3D structure & ligand, or export Nextflow / Snakemake."
        icon={<GitBranch className="h-4 w-4" />}
        guideOpen={guideOpen}
        onToggleGuide={() => setGuideOpen((v) => !v)}
        actions={
          <button
            type="button"
            onClick={onOpenComputeNodes}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:border-sky-500/40"
          >
            GPU Node: <strong className={activeComputeLabel ? 'text-emerald-300' : 'text-amber-300'}>{activeComputeLabel ?? 'Not paired'}</strong>
          </button>
        }
      />

      <ToolGuideCard
        open={guideOpen}
        title="How the Visual Workflow Canvas Works"
        summary="Design reproducible Directed Acyclic Graph (DAG) pipelines combining Tier-0/Tier-1 browser Wasm steps (Kabsch, RDKit, Reports) and Tier-2 GPU Compute Node workloads (Vina, OpenMM, Boltz-2, RFdiffusion, PySCF)."
        steps={[
          'Pick a starter template or click + buttons to add processing nodes onto the canvas.',
          'Drag nodes to organize them, click Link → on one node then click a target node to connect edges, and edit node parameters in the Inspector below.',
          'Click Run DAG to execute topologically using your active 3D structures & ligand SMILES, or export a reproducible Nextflow / Snakemake script.',
        ]}
        connectionTip="The Workspace Inputs node automatically pulls your currently loaded 3D Reference/Comparison structures, active SMILES ligand, and 3D Vina pocket box."
      />

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" icon={<LayoutGrid className="h-3.5 w-3.5" />} onClick={autoLayout}>
            Auto-Layout
          </Button>
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
        </div>

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

      {/* Templates & Node Palette */}
      <div className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0b1018] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] font-semibold text-slate-400 uppercase">Templates:</span>
          {WORKFLOW_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                setGraph(tpl);
                setSelectedNodeId(tpl.nodes[0]?.id ?? null);
                setRunStates({});
                setPipelineError(null);
              }}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-xs transition',
                graph.id === tpl.id
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-white/10 bg-slate-900 text-slate-300 hover:border-white/25',
              )}
            >
              {tpl.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
          <span className="text-[0.6875rem] text-slate-400">Add Node:</span>
          {(Object.keys(WORKFLOW_NODE_CATALOG) as WorkflowNodeKind[]).map((kind) => {
            const spec = WORKFLOW_NODE_CATALOG[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addNode(kind)}
                title={`${spec.toolName} (${spec.tier})`}
                className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-[0.6875rem] text-slate-300 hover:border-sky-500/40"
              >
                <Plus className="h-3 w-3 text-sky-300" />
                {spec.label}
              </button>
            );
          })}
        </div>
      </div>

      {pipelineError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200">
          {pipelineError}
        </div>
      )}

      {/* Interactive SVG + Draggable Card DAG Canvas */}
      <div className="relative min-h-[300px] flex-1 overflow-auto rounded-xl border border-white/[0.08] bg-[#070b12]">
        <div
          className="relative"
          style={{ width: canvasBounds.width, height: canvasBounds.height }}
        >
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
              const x1 = a.x + 196;
              const y1 = a.y + 46;
              const x2 = b.x;
              const y2 = b.y + 46;
              const mx = (x1 + x2) / 2;
              const isHighlighted = selectedNodeId === e.from || selectedNodeId === e.to;
              return (
                <path
                  key={e.id}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isHighlighted ? 'rgba(56,189,248,0.85)' : 'rgba(56,189,248,0.4)'}
                  strokeWidth={isHighlighted ? 2.5 : 2}
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
                onPointerDown={(e) => onNodePointerDown(e, node.id, node.x, node.y)}
                onPointerMove={onNodePointerMove}
                onPointerUp={() => onNodePointerUp(node.id)}
                className={cx(
                  'absolute cursor-grab rounded-xl border bg-[#0d121b]/95 p-2.5 shadow-lg transition select-none active:cursor-grabbing',
                  isSelected ? 'border-sky-400/80 ring-1 ring-sky-400/35' : 'border-white/10 hover:border-white/25',
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
                          : 'border-white/10 text-slate-400 hover:text-slate-200',
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
                {st?.error && (
                  <div className="mt-1.5 truncate font-mono text-[0.6875rem] text-rose-300" title={st.error}>
                    {st.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Node Interactive Parameter Inspector */}
      {selectedNode && (
        <Card className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">
                  {WORKFLOW_NODE_CATALOG[selectedNode.kind].label}
                </span>
                <span className="font-mono text-[0.6875rem] text-slate-500">({selectedNode.id})</span>
                <Badge tone={WORKFLOW_NODE_CATALOG[selectedNode.kind].tier === 'tier2-gpu' ? 'warn' : 'good'}>
                  {WORKFLOW_NODE_CATALOG[selectedNode.kind].tier}
                </Badge>
              </div>
              <div className="mt-0.5 text-[0.6875rem] text-slate-400">
                Input: {WORKFLOW_NODE_CATALOG[selectedNode.kind].inputPort} → Output: {WORKFLOW_NODE_CATALOG[selectedNode.kind].outputPort}
              </div>
            </div>

            {WORKFLOW_NODE_CATALOG[selectedNode.kind].tier === 'tier2-gpu' && !activeComputeLabel && (
              <button
                type="button"
                onClick={onOpenComputeNodes}
                className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[0.6875rem] font-medium text-amber-200 hover:bg-amber-500/20"
              >
                Requires Online GPU Node — Pair Colab / Local →
              </button>
            )}
          </div>

          {/* Editable Parameters */}
          {Object.keys(selectedNode.params).length > 0 && (
            <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3">
              {Object.entries(selectedNode.params).map(([key, val]) => (
                <label
                  key={key}
                  className="flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-black/25 px-2.5 py-2"
                >
                  <span className="font-mono text-[0.6875rem] text-slate-400">{key}</span>
                  {typeof val === 'boolean' ? (
                    <span className="flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={(e) => updateNodeParam(selectedNode.id, key, e.target.checked)}
                        className="accent-sky-400"
                      />
                      {val ? 'Enabled' : 'Disabled'}
                    </span>
                  ) : typeof val === 'number' ? (
                    <input
                      type="number"
                      value={val}
                      onChange={(e) => updateNodeParam(selectedNode.id, key, Number(e.target.value) || 0)}
                      className="h-7 rounded border border-white/10 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-sky-400"
                    />
                  ) : (
                    <input
                      value={String(val)}
                      onChange={(e) => updateNodeParam(selectedNode.id, key, e.target.value)}
                      className="h-7 rounded border border-white/10 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-sky-400"
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Connected Edges with Unlink */}
          {selectedEdges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
              <span className="text-[0.6875rem] text-slate-500">Connections:</span>
              {selectedEdges.map((edge) => {
                const fromLabel = WORKFLOW_NODE_CATALOG[nodeMap.get(edge.from)?.kind ?? 'load_structures'].label;
                const toLabel = WORKFLOW_NODE_CATALOG[nodeMap.get(edge.to)?.kind ?? 'load_structures'].label;
                return (
                  <button
                    key={edge.id}
                    type="button"
                    onClick={() => deleteEdge(edge.id)}
                    title="Click to unlink edge"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[0.6875rem] text-slate-300 hover:border-rose-400/50 hover:text-rose-200"
                  >
                    <span>
                      {fromLabel} → {toLabel}
                    </span>
                    <Unlink className="h-3 w-3" />
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
