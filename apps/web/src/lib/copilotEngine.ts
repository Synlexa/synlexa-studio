import type {
  AnalyzeGeneCrisprResult,
  AnalyzeMoleculeSmilesResult,
  AnalyzePeptideResult,
  AnalyzeRamachandranResult,
  CompareStructuresResult,
  InspectStructureResult,
} from '@synlexa/wasm-bridge';
import { RUO_DISCLAIMER } from './reportGenerator';

export interface CopilotContext {
  refLabel: string;
  mobLabel: string;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  comparison: CompareStructuresResult | null;
  peptide: AnalyzePeptideResult | null;
  crispr: AnalyzeGeneCrisprResult | null;
  smiles: AnalyzeMoleculeSmilesResult | null;
  ramachandran?: AnalyzeRamachandranResult | null;
}

export type CopilotAction =
  | { type: 'focus_residues'; seqIds: number[] }
  | { type: 'compare_structures' }
  | { type: 'request_report'; format: 'html' | 'json' }
  | { type: 'switch_tab'; tab: 'sequence' | 'peptide' | 'crispr' | 'chemistry' | 'ramachandran' | 'mcp' }
  | { type: 'apply_peptide_mutation'; notation: string }
  | { type: 'analyze_smiles'; smiles: string; name?: string }
  | { type: 'focus_crispr_codon'; codonIndex: number };

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  command?: string;
  text: string;
  citations?: string[];
  actionTaken?: string;
  timestampUtc: string;
}

export interface CopilotExecutionResult {
  reply: CopilotMessage;
  actions: CopilotAction[];
}

export function executeCopilotCommand(
  rawInput: string,
  ctx: CopilotContext,
): CopilotExecutionResult {
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();
  const now = new Date().toISOString();
  const makeId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 1. list_artifacts
  if (lower === 'list_artifacts' || lower.includes('list artifacts') || lower === 'artifacts') {
    const refSha = ctx.comparison?.reference.sha256 ?? ctx.refInspect?.sha256 ?? 'unloaded';
    const mobSha = ctx.comparison?.mobile.sha256 ?? ctx.mobInspect?.sha256 ?? 'unloaded';
    const lines = [
      `Active Artifacts (RUO):`,
      `• Reference: ${ctx.refLabel} | chain=${ctx.comparison?.reference.chainId ?? ctx.refInspect?.chains[0]?.chainId ?? '?'} | sha256=${refSha.slice(0, 12)}… | metric=${ctx.comparison?.reference.confidenceKind ?? ctx.refInspect?.confidenceKind ?? 'none'}`,
      `• Mobile: ${ctx.mobLabel} | chain=${ctx.comparison?.mobile.chainId ?? ctx.mobInspect?.chains[0]?.chainId ?? '?'} | sha256=${mobSha.slice(0, 12)}… | metric=${ctx.comparison?.mobile.confidenceKind ?? ctx.mobInspect?.confidenceKind ?? 'none'}`,
    ];
    if (ctx.smiles) {
      lines.push(`• Ligand SMILES: ${ctx.smiles.name} (${ctx.smiles.formula}, MW ${ctx.smiles.molecularWeight.toFixed(2)} Da)`);
    }
    if (ctx.crispr) {
      lines.push(`• Transcript: ${ctx.crispr.transcriptId} (${ctx.crispr.geneSymbol}, ${ctx.crispr.cdsLengthBp} bp)`);
    }
    return {
      actions: [],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'list_artifacts',
        text: lines.join('\n'),
        citations: [
          `ref:sha256:${refSha}`,
          `mob:sha256:${mobSha}`,
        ],
        actionTaken: 'Listed active verified artifacts',
        timestampUtc: now,
      },
    };
  }

  // 2. focus_residues (e.g. "focus_residues 94 96 119" or "focus 94")
  const focusMatch = trimmed.match(/^(?:focus_residues|focus)\s+([0-9,\s]+)/i);
  if (focusMatch) {
    const seqIds = focusMatch[1]
      .split(/[,\s]+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (seqIds.length === 0) {
      return {
        actions: [],
        reply: {
          id: makeId(),
          role: 'assistant',
          command: 'focus_residues',
          text: 'Provide one or more positive residue sequence IDs, e.g. `focus_residues 94, 96, 119`.',
          timestampUtc: now,
        },
      };
    }

    const matchedInfo = seqIds.map((id) => {
      const m = ctx.comparison?.matchedResidues.find((r) => r.refSeqId === id);
      if (!m) return `res ${id}: not in matched Cα set`;
      return `${m.resName3}${m.refSeqId}: Δd=${m.distanceAngstrom.toFixed(3)} Å, B=${m.refBFactor != null ? m.refBFactor.toFixed(2) : 'n/a'} Å², pLDDT=${m.mobPlddt != null ? m.mobPlddt.toFixed(1) : 'n/a'}`;
    });

    return {
      actions: [{ type: 'focus_residues', seqIds }],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'focus_residues',
        text: `Focused residue(s) ${seqIds.join(', ')} in 3D, Sequence, and PAE views.\n${matchedInfo.join('\n')}`,
        citations: ctx.comparison ? [`resultId:${ctx.comparison.resultId}`] : [],
        actionTaken: `focus_residues(${seqIds.join(',')})`,
        timestampUtc: now,
      },
    };
  }

  // 3. compare_structures
  if (lower === 'compare_structures' || lower === 'compare') {
    return {
      actions: [{ type: 'compare_structures' }],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'compare_structures',
        text: `Dispatched Kabsch float64 superposition on ${ctx.refLabel} vs ${ctx.mobLabel}.`,
        actionTaken: 'compare_structures()',
        timestampUtc: now,
      },
    };
  }

  // 4. request_report
  if (lower.startsWith('request_report') || lower.includes('export report')) {
    const fmt = lower.includes('json') ? 'json' : 'html';
    return {
      actions: [{ type: 'request_report', format: fmt }],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'request_report',
        text: `Prepared self-contained RUO ${fmt.toUpperCase()} report from verified engine output (${ctx.comparison?.resultId ?? 'no active run'}).`,
        citations: ctx.comparison ? [`resultId:${ctx.comparison.resultId}`] : [],
        actionTaken: `request_report(${fmt})`,
        timestampUtc: now,
      },
    };
  }

  // 5. Peptide mutation command: e.g. "mutate H94A" or "peptide H94A"
  const mutMatch = trimmed.match(/^(?:mutate|peptide)\s+([ACDEFGHIKLMNPQRSTVWY]\d+[ACDEFGHIKLMNPQRSTVWY])/i);
  if (mutMatch) {
    const notation = mutMatch[1].toUpperCase();
    return {
      actions: [
        { type: 'switch_tab', tab: 'peptide' },
        { type: 'apply_peptide_mutation', notation },
      ],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'analyze_peptide',
        text: `Applying point mutation ${notation} in Peptide & Protein Engineering workbench (Wasm recalculation queued).`,
        actionTaken: `apply_peptide_mutation(${notation})`,
        timestampUtc: now,
      },
    };
  }

  // 6. SMILES command: e.g. "smiles CC(=O)Oc1ccccc1C(=O)O"
  const smilesMatch = trimmed.match(/^smiles\s+(\S+)(?:\s+(.+))?$/i);
  if (smilesMatch) {
    const smi = smilesMatch[1];
    const name = smilesMatch[2]?.trim();
    return {
      actions: [
        { type: 'switch_tab', tab: 'chemistry' },
        { type: 'analyze_smiles', smiles: smi, name },
      ],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'analyze_molecule_smiles',
        text: `Queued deterministic Wasm SMILES graph & descriptor evaluation for \`${smi}\`.`,
        actionTaken: `analyze_smiles(${smi})`,
        timestampUtc: now,
      },
    };
  }

  // 7. CRISPR codon command: e.g. "crispr codon 94"
  const crisprMatch = trimmed.match(/^crispr(?:\s+codon)?\s+(\d+)$/i);
  if (crisprMatch) {
    const codonIndex = Number.parseInt(crisprMatch[1], 10);
    return {
      actions: [
        { type: 'switch_tab', tab: 'crispr' },
        { type: 'focus_crispr_codon', codonIndex },
      ],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'analyze_gene_crispr',
        text: `Focused coding transcript codon #${codonIndex} and scanned PAM sites.`,
        actionTaken: `focus_crispr_codon(${codonIndex})`,
        timestampUtc: now,
      },
    };
  }

  // 8. Top deviating residues / contacts / Ramachandran / MCP queries
  if (lower.includes('deviat') || lower.includes('outlier') || lower.includes('ramachandran') || lower.includes('contact')) {
    const parts: string[] = [];
    const actions: CopilotAction[] = [];
    if (ctx.comparison && (lower.includes('deviat') || !lower.includes('ramachandran'))) {
      const top5 = [...ctx.comparison.matchedResidues]
        .sort((a, b) => b.distanceAngstrom - a.distanceAngstrom)
        .slice(0, 5);
      parts.push(
        `Top deviating Cα residues (${ctx.refLabel} vs ${ctx.mobLabel}):\n` +
          top5
            .map(
              (r) =>
                `• ${r.resName3}${r.refSeqId}: Δd=${r.distanceAngstrom.toFixed(3)} Å (B=${r.refBFactor?.toFixed(1) ?? 'n/a'}, pLDDT=${r.mobPlddt?.toFixed(1) ?? 'n/a'})`,
            )
            .join('\n'),
      );
      if (top5[0]) actions.push({ type: 'focus_residues', seqIds: [top5[0].refSeqId] });
    }
    if (ctx.comparison?.refContacts?.length && lower.includes('contact')) {
      const c5 = [...ctx.comparison.refContacts]
        .sort((a, b) => a.distanceAngstrom - b.distanceAngstrom)
        .slice(0, 6);
      parts.push(
        `Active-site contacts (≤ 4.5 Å, ${ctx.comparison.refContacts.length} total):\n` +
          c5
            .map(
              (c) =>
                `• ${c.ligandResName}.${c.ligandAtom} ↔ ${c.proteinResName3}${c.proteinSeqId}.${c.proteinAtom}: ${c.distanceAngstrom.toFixed(2)} Å`,
            )
            .join('\n'),
      );
    }
    if (ctx.ramachandran && lower.includes('ramachandran')) {
      const r = ctx.ramachandran;
      const outliers = r.residues.filter((x) => x.region === 'outlier').slice(0, 6);
      parts.push(
        `Ramachandran geometry (${r.chainId}, ${r.residueCount} residues): Favored ${r.regionCounts.favored}, Allowed ${r.regionCounts.allowed}, Outliers ${r.regionCounts.outlier}.` +
          (outliers.length
            ? `\nOutlier residues: ${outliers.map((o) => `${o.resName3}${o.seqId} (φ=${o.phiDeg?.toFixed(1) ?? 'n/a'}°, ψ=${o.psiDeg?.toFixed(1) ?? 'n/a'}°)`).join(', ')}`
            : ''),
      );
      actions.push({ type: 'switch_tab', tab: 'ramachandran' });
    }
    if (parts.length > 0) {
      return {
        actions,
        reply: {
          id: makeId(),
          role: 'assistant',
          command: 'get_workspace_state',
          text: `${parts.join('\n\n')}\n\n_${RUO_DISCLAIMER}_`,
          citations: ctx.comparison ? [`resultId:${ctx.comparison.resultId}`] : [],
          actionTaken: 'Inspected deterministic workspace telemetry',
          timestampUtc: now,
        },
      };
    }
  }

  if (lower.includes('mcp')) {
    return {
      actions: [{ type: 'switch_tab', tab: 'mcp' }],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'open_mcp_server',
        text: `Opened the In-App MCP Server panel. Studio exposes 11 JSON-RPC 2.0 tools, 8 live workspace resources, and 4 prompts for both the internal AI Assistant and external clients (Claude Desktop, Claude Code, OpenAI Codex CLI, Cursor). ${RUO_DISCLAIMER}`,
        actionTaken: 'Opened MCP Server workbench',
        timestampUtc: now,
      },
    };
  }

  // 9. explain_result (default or explicit)
  if (
    lower === 'explain_result' ||
    lower.includes('explain') ||
    lower.includes('summary') ||
    lower.includes('metric')
  ) {
    if (!ctx.comparison) {
      return {
        actions: [],
        reply: {
          id: makeId(),
          role: 'assistant',
          command: 'explain_result',
          text: 'No active structural comparison result yet. Run `compare_structures` first.',
          timestampUtc: now,
        },
      };
    }

    const c = ctx.comparison;
    const maxDev = c.matchedResidues.reduce(
      (best, cur) => (cur.distanceAngstrom > best.distanceAngstrom ? cur : best),
      c.matchedResidues[0],
    );
    const contactCount = c.refContacts?.length ?? 0;

    return {
      actions: [],
      reply: {
        id: makeId(),
        role: 'assistant',
        command: 'explain_result',
        text: [
          `Verified Comparison Summary (${RUO_DISCLAIMER}):`,
          `• Cα RMSD: ${c.metrics.rmsdAngstrom.toFixed(4)} Å across ${c.metrics.matchedCaCount} matched Cα residues (${c.engine.target}, ${c.engine.floatPrecision}).`,
          `• Reference Coverage: ${c.metrics.refCoverage.numerator}/${c.metrics.refCoverage.denominator} (${(c.metrics.refCoverage.ratio * 100).toFixed(1)}%, ${c.metrics.refCoverage.denominatorKind}).`,
          `• Mobile Coverage: ${c.metrics.mobCoverage.numerator}/${c.metrics.mobCoverage.denominator} (${(c.metrics.mobCoverage.ratio * 100).toFixed(1)}%, ${c.metrics.mobCoverage.denominatorKind}).`,
          `• Peak Residue Δd: ${maxDev ? `${maxDev.resName3}${maxDev.refSeqId} (${maxDev.distanceAngstrom.toFixed(3)} Å)` : 'n/a'} · PAE status: ${c.metrics.paeStatus}.`,
          `• Active-site ligand/metal contacts (≤4.5 Å): ${contactCount} atom contacts recorded.`,
          `• Confidence Separation: Reference uses ${c.reference.confidenceKind} (Å²); Mobile uses ${c.mobile.confidenceKind}.`,
        ].join('\n'),
        citations: [
          `resultId:${c.resultId}`,
          `ref:sha256:${c.reference.sha256}`,
          `mob:sha256:${c.mobile.sha256}`,
        ],
        actionTaken: 'explain_result()',
        timestampUtc: now,
      },
    };
  }

  return {
    actions: [],
    reply: {
      id: makeId(),
      role: 'assistant',
      text: [
        `Available deterministic commands (RUO):`,
        `• \`list_artifacts\` — Show loaded structures, SHA-256 digests, and confidence types`,
        `• \`focus_residues 94, 96, 119\` — Highlight residue(s) across 3D, Sequence, and PAE`,
        `• \`compare_structures\` — Re-run float64 Kabsch alignment in Wasm worker`,
        `• \`explain_result\` — Summarize verified RMSD, coverage, contacts, and provenance`,
        `• \`which residues deviate most\` — Inspect top Cα deviations and active-site contacts`,
        `• \`ramachandran outliers\` — Check backbone φ/ψ geometry & outliers`,
        `• \`mutate H94A\` — Apply point mutation in Peptide Engineering tab`,
        `• \`crispr codon 94\` — Jump to coding codon & scan Cas9/Cas12a PAMs`,
        `• \`smiles CC(=O)Nc1nnc(S(N)(=O)=O)s1\` — Depict & analyze SMILES ligand`,
        `• \`mcp\` — Open the In-App MCP Server & external client setup`,
        `• \`request_report html\` or \`request_report json\` — Export RUO report`,
      ].join('\n'),
      timestampUtc: now,
    },
  };
}
