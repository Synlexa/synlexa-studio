import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BookOpen,
  Bot,
  CheckCircle2,
  Cpu,
  Dna,
  FolderPlus,
  Layers,
  ShieldCheck,
  Split,
  X,
} from 'lucide-react';
import type { ToolTabId } from '../lib/workspaceLayout';
import { Badge, Button, cx } from './ui';

export interface TutorialStep {
  id: number;
  title: string;
  subtitle: string;
  icon: typeof BookOpen;
  targetTab?: ToolTabId;
  actionLabel?: string;
  summary: string;
  bullets: string[];
  tryActionKey: 'home' | 'viewer' | 'chemistry' | 'peptide' | 'crispr' | 'workflow' | 'compute' | 'assistant' | 'settings';
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 1,
    title: 'Start Page & Multi-Project Workspaces',
    subtitle: 'Create isolated projects from templates and keep structures, ligands, and edits organized',
    icon: FolderPlus,
    targetTab: 'home',
    actionLabel: 'Open Start Page',
    tryActionKey: 'home',
    summary:
      'Synlexa Studio starts on the Start Page so you can create a new research project, launch starter benchmarks, or resume saved workspaces before diving into 3D inspection.',
    bullets: [
      'Click "+ New project" on the Start Page or Workspace Explorer to create a dedicated project (Structure Compare, Ligand Design & Binding, or Peptide & CRISPR Test).',
      'Switch between projects anytime — all imported structures, designed SMILES molecules, peptides, and CRISPR targets stay organized inside each project.',
      'Alt-click any tool in the Tools sidebar to open tabs side-by-side.',
    ],
  },
  {
    id: 2,
    title: 'Import Multiple Structures & Split Chains / Ligands',
    subtitle: 'Load PDB/mmCIF files or fetch RCSB, AlphaFold, UniProt, and PubChem records',
    icon: Split,
    targetTab: 'viewer',
    actionLabel: 'Open 3D Viewer',
    tryActionKey: 'viewer',
    summary:
      'Import multiple local structures by drag-and-drop or fetch public IDs directly. Split multi-chain complexes or co-crystallized ligands into standalone project assets.',
    bullets: [
      'Load structures into Reference and Comparison slots from your disk or Public Databases.',
      'Click "Split Ref" or "Split Comp" in the Workspace Explorer (or ask the AI Assistant) to split polymer chains and non-water HETATM ligands into independent assets.',
      'Inspect deterministic float64 Kabsch RMSD, TM-score, GDT-TS, and per-residue Cα distances in 3D.',
    ],
  },
  {
    id: 3,
    title: 'Design Molecules in the 2D Sketcher & RDKit Engine',
    subtitle: 'Edit ligands visually or by SMILES, score drug-likeness & PAINS alerts, and save to project',
    icon: Atom,
    targetTab: 'chemistry',
    actionLabel: 'Open Ligands & 2D Sketcher',
    tryActionKey: 'chemistry',
    summary:
      'Draw ring systems and bonds on the interactive 2D SVG canvas or enter SMILES strings directly. Studio runs RDKit in WebAssembly to compute deterministic descriptors offline.',
    bullets: [
      'Check exact molecular formula, MW, cLogP, TPSA, HBD/HBA, rotatable bonds, SA score, and Lipinski/Veber checks.',
      'Flag PAINS structural alerts locally before saving promising analogs into your active project.',
      'Click "Bind" next to any saved project molecule to stage docking/binding tests.',
    ],
  },
  {
    id: 4,
    title: 'Peptide Engineering & CRISPR / Base-Editing Workbenches',
    subtitle: 'Mutate residues, check 3D active-site contacts, and score SpCas9/SaCas9/Cas12a guides',
    icon: Dna,
    targetTab: 'peptide',
    actionLabel: 'Open Peptide Workbench',
    tryActionKey: 'peptide',
    summary:
      'Test point mutations in loaded protein sequences and inspect base-editing CRISPR targets with automatic PAM matching and codon delta computation.',
    bullets: [
      'In Peptide Engineering, apply mutations (e.g. H94A), track isoelectric point / charge shifts, and focus those positions in Mol* 3D.',
      'In Gene & CRISPR, switch nucleases (SpCas9 NGG, SaCas9, Cas12a), inspect guide RNAs, and preview amino-acid consequences.',
    ],
  },
  {
    id: 5,
    title: 'External GPU Nodes (Colab / SSH) & Workflow Canvas',
    subtitle: 'Connect AutoDock Vina, OpenMM MD, Boltz-2, RFdiffusion, and PySCF backends',
    icon: Cpu,
    targetTab: 'compute',
    actionLabel: 'Open GPU & Compute Nodes',
    tryActionKey: 'compute',
    summary:
      'Light visualization and cheminformatics run in-browser via Rust WASM & RDKit. Heavy GPU jobs dispatch cleanly to a local sidecar, Google Colab, or cluster worker.',
    bullets: [
      'Connect your Google Colab / FastAPI compute worker URL & bearer token in GPU & Compute Nodes.',
      'Design multi-step pipelines in Workflow Canvas and export reproducible Nextflow (`main.nf`) or Snakemake (`Snakefile`) definitions.',
    ],
  },
  {
    id: 6,
    title: 'Autonomous AI Agent: Live Thinking, Octopus Tools & Permissions',
    subtitle: 'Full UI + project control with interactive permission prompts',
    icon: Bot,
    targetTab: 'assistant',
    actionLabel: 'Open AI Assistant',
    tryActionKey: 'assistant',
    summary:
      'The AI Assistant uses Studio’s in-app MCP server as "octopus arms" to create projects, design molecules, split structures, run workflows, and switch UI tabs.',
    bullets: [
      'Watch the live Thinking & Tool Trace accordion while the agent plans rounds and runs tools.',
      'Sensitive categories (external web/database fetches and remote GPU/workflow execution) pause for your interactive Allow Once / Session / Deny approval.',
      'Adjust per-category policies anytime in Settings → Agent Tool Permissions.',
    ],
  },
  {
    id: 7,
    title: 'BYOK Key Vault (state.vscdb) vs Synlexa Cloud & Exports',
    subtitle: 'Keep your own Anthropic/Gemini/OpenAI keys encrypted locally with full control',
    icon: ShieldCheck,
    actionLabel: 'Open AI & Key Settings',
    tryActionKey: 'settings',
    summary:
      'When you enter your own API key (Anthropic, Gemini, or OpenAI), Studio encrypts it in local state.vscdb and routes directly to your provider instead of Synlexa Cloud.',
    bullets: [
      'Use "Prefer BYOK keys" (default) so personal API keys always take priority, or switch to manual mode to choose Synlexa Cloud anytime.',
      'Export RUO-labeled HTML reports, JSON manifests, and reproducible `.synlexa.bundle.json` project archives.',
    ],
  },
];

interface TutorialGuideModalProps {
  open: boolean;
  onClose: () => void;
  onExecuteStepAction: (key: TutorialStep['tryActionKey']) => void;
}

export function TutorialGuideModal({ open, onClose, onExecuteStepAction }: TutorialGuideModalProps) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const step = TUTORIAL_STEPS[stepIdx] ?? TUTORIAL_STEPS[0];
  const Icon = step.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Synlexa Studio Interactive Tutorial"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0e131c] shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
              <BookOpen className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Synlexa Studio Interactive Guide</h2>
              <p className="text-xs text-slate-400">
                Step {step.id} of {TUTORIAL_STEPS.length} · Research-Use-Only (RUO)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step pills */}
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] bg-white/[0.015] px-5 py-2.5">
          {TUTORIAL_STEPS.map((s, idx) => {
            const active = idx === stepIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIdx(idx)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200',
                )}
              >
                <span className="font-mono text-[0.6875rem]">{s.id}</span>
                <span className="hidden sm:inline">{s.title.split('&')[0]?.trim()}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/10 text-sky-300">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-100">{step.title}</h3>
                <Badge tone="accent">Step {step.id}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">{step.subtitle}</p>
            </div>
          </div>

          <p className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 text-sm leading-relaxed text-slate-200">
            {step.summary}
          </p>

          <ul className="mt-4 space-y-2.5">
            {step.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
            <span className="text-xs text-slate-300">Try this feature directly inside the Studio workspace:</span>
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              onClick={() => {
                onExecuteStepAction(step.tryActionKey);
                onClose();
              }}
            >
              {step.actionLabel ?? 'Try in Studio'}
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={stepIdx === 0}
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          >
            Previous
          </Button>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Layers className="h-3.5 w-3.5" />
            <span>Press Esc anytime · Reopen via Guide in the top bar</span>
          </div>
          {stepIdx < TUTORIAL_STEPS.length - 1 ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setStepIdx((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1))}
            >
              Next
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
