/**
 * Plain-English, research-use-only interpretations of deterministic metrics.
 *
 * These helpers translate engine-computed numbers into calm, descriptive
 * labels so that beginners and experts can read a result at a glance. They are
 * heuristic bands from widely used computational conventions (e.g. AlphaFold DB
 * pLDDT bands, Lipinski/Veber rules of thumb). They are NOT clinical,
 * diagnostic, or therapeutic judgements and never replace analyst review.
 */

export type InsightTone = 'excellent' | 'good' | 'moderate' | 'caution' | 'info';

export interface MetricInsight {
  /** Short metric name, e.g. "Cα RMSD". */
  metric: string;
  /** Formatted value including units, e.g. "0.368 Å". */
  value: string;
  tone: InsightTone;
  /** Short badge label, e.g. "High Structural Agreement". */
  label: string;
  /** One-sentence plain-English explanation. */
  explanation: string;
  /** The rule used, so the derivation is inspectable. */
  rule: string;
}

const fmt = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a');

export function explainRmsd(rmsdAngstrom: number): MetricInsight {
  const value = `${fmt(rmsdAngstrom, 3)} Å`;
  if (rmsdAngstrom < 1.0) {
    return {
      metric: 'Cα RMSD',
      value,
      tone: 'excellent',
      label: 'High Structural Agreement',
      explanation:
        'Backbones overlay almost perfectly after superposition — the two models share the same fold at near-atomic detail.',
      rule: 'RMSD < 1.0 Å',
    };
  }
  if (rmsdAngstrom < 2.0) {
    return {
      metric: 'Cα RMSD',
      value,
      tone: 'good',
      label: 'Close Structural Agreement',
      explanation: 'Same overall fold with small local differences (loops, termini, or side-chain driven shifts).',
      rule: '1.0 ≤ RMSD < 2.0 Å',
    };
  }
  if (rmsdAngstrom < 3.0) {
    return {
      metric: 'Cα RMSD',
      value,
      tone: 'moderate',
      label: 'Partial Agreement',
      explanation: 'Core fold is likely similar, but some regions deviate noticeably. Inspect the Δd track.',
      rule: '2.0 ≤ RMSD < 3.0 Å',
    };
  }
  return {
    metric: 'Cα RMSD',
    value,
    tone: 'caution',
    label: 'Low Agreement',
    explanation: 'Large deviations — check chain selection, domain motion, or sequence mapping before interpreting.',
    rule: 'RMSD ≥ 3.0 Å',
  };
}

/** AlphaFold DB confidence bands for per-residue pLDDT (0–100). */
export function explainPlddt(plddt: number): MetricInsight {
  const value = fmt(plddt, 1);
  if (plddt > 90) {
    return {
      metric: 'Mean pLDDT',
      value,
      tone: 'excellent',
      label: 'Very High Confidence',
      explanation: 'The predictor is very confident in local backbone and many side-chain positions.',
      rule: 'pLDDT > 90',
    };
  }
  if (plddt > 70) {
    return {
      metric: 'Mean pLDDT',
      value,
      tone: 'good',
      label: 'Confident',
      explanation: 'Backbone placement is generally reliable; side chains may vary.',
      rule: '70 < pLDDT ≤ 90',
    };
  }
  if (plddt > 50) {
    return {
      metric: 'Mean pLDDT',
      value,
      tone: 'moderate',
      label: 'Low Confidence',
      explanation: 'Treat these regions with caution — they may be flexible or poorly constrained.',
      rule: '50 < pLDDT ≤ 70',
    };
  }
  return {
    metric: 'Mean pLDDT',
    value,
    tone: 'caution',
    label: 'Very Low Confidence',
    explanation: 'Likely disordered or unreliable in isolation; do not interpret fine structure here.',
    rule: 'pLDDT ≤ 50',
  };
}

export function explainCoverage(ratio: number, numerator: number, denominator: number): MetricInsight {
  const value = `${numerator}/${denominator} (${fmt(ratio * 100, 1)}%)`;
  if (ratio >= 0.9) {
    return {
      metric: 'Coverage',
      value,
      tone: 'excellent',
      label: 'Near-Complete Coverage',
      explanation: 'Almost every residue was matched, so the RMSD summarises nearly the whole chain.',
      rule: 'coverage ≥ 90%',
    };
  }
  if (ratio >= 0.6) {
    return {
      metric: 'Coverage',
      value,
      tone: 'good',
      label: 'Good Coverage',
      explanation: 'Most residues were matched; unmatched parts are often termini, tags, or signal peptides.',
      rule: '60% ≤ coverage < 90%',
    };
  }
  if (ratio >= 0.3) {
    return {
      metric: 'Coverage',
      value,
      tone: 'moderate',
      label: 'Partial Coverage',
      explanation: 'Only part of the chain was compared — RMSD describes that subset only.',
      rule: '30% ≤ coverage < 60%',
    };
  }
  return {
    metric: 'Coverage',
    value,
    tone: 'caution',
    label: 'Sparse Coverage',
    explanation: 'Few residues matched. The comparison may cover a single domain of a larger protein.',
    rule: 'coverage < 30%',
  };
}

export function explainPae(meanPae: number): MetricInsight {
  const value = `${fmt(meanPae, 1)} Å`;
  if (meanPae < 5) {
    return {
      metric: 'Mean PAE',
      value,
      tone: 'excellent',
      label: 'Confident Relative Placement',
      explanation: 'Domains and residues are predicted to sit in well-defined positions relative to each other.',
      rule: 'mean PAE < 5 Å',
    };
  }
  if (meanPae < 10) {
    return {
      metric: 'Mean PAE',
      value,
      tone: 'good',
      label: 'Moderate Relative Placement',
      explanation: 'Overall arrangement is plausible, with some uncertainty between distant regions.',
      rule: '5 ≤ mean PAE < 10 Å',
    };
  }
  return {
    metric: 'Mean PAE',
    value,
    tone: 'caution',
    label: 'Uncertain Relative Placement',
    explanation: 'Relative domain positions are uncertain — avoid reading inter-domain geometry.',
    rule: 'mean PAE ≥ 10 Å',
  };
}

export function explainTpsa(tpsa: number): MetricInsight {
  const value = `${fmt(tpsa, 1)} Å²`;
  if (tpsa <= 140) {
    return {
      metric: 'TPSA',
      value,
      tone: tpsa <= 90 ? 'excellent' : 'good',
      label: 'Good Permeability (heuristic)',
      explanation:
        'Polar surface area is within the common Veber guideline associated with passive membrane permeability in computational screens.',
      rule: 'TPSA ≤ 140 Å²',
    };
  }
  return {
    metric: 'TPSA',
    value,
    tone: 'caution',
    label: 'High Polarity',
    explanation: 'Large polar surface area; passive permeability is usually lower for such compounds.',
    rule: 'TPSA > 140 Å²',
  };
}

export function explainClogP(clogp: number): MetricInsight {
  const value = fmt(clogp, 2);
  if (clogp < 0) {
    return {
      metric: 'cLogP',
      value,
      tone: 'info',
      label: 'Hydrophilic',
      explanation: 'Prefers water over octanol — typically very soluble but less membrane-partitioning.',
      rule: 'cLogP < 0',
    };
  }
  if (clogp <= 5) {
    return {
      metric: 'cLogP',
      value,
      tone: 'good',
      label: 'Balanced Lipophilicity',
      explanation: 'Within the Lipinski rule-of-five lipophilicity limit (≤ 5).',
      rule: '0 ≤ cLogP ≤ 5',
    };
  }
  return {
    metric: 'cLogP',
    value,
    tone: 'caution',
    label: 'Highly Lipophilic',
    explanation: 'Above the rule-of-five limit; often associated with low aqueous solubility.',
    rule: 'cLogP > 5',
  };
}

export function explainLipinski(violations: number): MetricInsight {
  return {
    metric: 'Lipinski',
    value: `${violations} violation${violations === 1 ? '' : 's'}`,
    tone: violations === 0 ? 'excellent' : violations === 1 ? 'good' : 'caution',
    label: violations === 0 ? 'Rule-of-Five Compliant' : violations === 1 ? 'One Rule Exceeded' : 'Multiple Rules Exceeded',
    explanation:
      violations <= 1
        ? 'Descriptor profile sits inside the classic rule-of-five heuristic for small molecules.'
        : 'Outside the classic rule-of-five heuristic (many natural products and biologics are too).',
    rule: 'MW ≤ 500, cLogP ≤ 5, HBD ≤ 5, HBA ≤ 10',
  };
}

export function explainPi(pi: number, chargeAtPh74: number): MetricInsight {
  const value = `pI ${fmt(pi, 2)}`;
  const sign = chargeAtPh74 > 0.5 ? 'positive' : chargeAtPh74 < -0.5 ? 'negative' : 'near-neutral';
  return {
    metric: 'Isoelectric point',
    value,
    tone: 'info',
    label: pi > 7.4 ? 'Basic (pI > 7.4)' : pi < 7.4 ? 'Acidic (pI < 7.4)' : 'Neutral pI',
    explanation: `At pH 7.4 the sequence carries a ${sign} net charge (${chargeAtPh74 >= 0 ? '+' : ''}${fmt(chargeAtPh74, 2)}), estimated by Henderson–Hasselbalch.`,
    rule: 'compare pI with pH 7.4',
  };
}

export function explainGravy(gravy: number): MetricInsight {
  return {
    metric: 'GRAVY',
    value: fmt(gravy, 3),
    tone: 'info',
    label: gravy > 0 ? 'Net Hydrophobic' : 'Net Hydrophilic',
    explanation:
      gravy > 0
        ? 'Average Kyte–Doolittle hydropathy is positive — the sequence leans hydrophobic.'
        : 'Average Kyte–Doolittle hydropathy is negative — typical of soluble, globular proteins.',
    rule: 'GRAVY > 0 hydrophobic',
  };
}

export function explainGcPercent(gc: number): MetricInsight {
  const inRange = gc >= 40 && gc <= 60;
  return {
    metric: 'Guide GC%',
    value: `${fmt(gc, 0)}%`,
    tone: inRange ? 'good' : 'moderate',
    label: inRange ? 'Typical GC Range' : 'Atypical GC',
    explanation: inRange
      ? 'Protospacer GC content is within the 40–60% range commonly preferred in guide design heuristics.'
      : 'GC content is outside the commonly preferred 40–60% window; consider nearby PAM sites.',
    rule: '40% ≤ GC ≤ 60%',
  };
}

export function meanOf(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

export function meanPaeFromJson(paeJson: string | null): number | null {
  if (!paeJson) return null;
  try {
    const parsed = JSON.parse(paeJson);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    const mat = entry?.predicted_aligned_error;
    if (!Array.isArray(mat)) return null;
    let sum = 0;
    let n = 0;
    for (const row of mat) {
      if (!Array.isArray(row)) continue;
      for (const v of row) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          sum += v;
          n += 1;
        }
      }
    }
    return n > 0 ? sum / n : null;
  } catch {
    return null;
  }
}

export const TONE_CLASSES: Record<InsightTone, string> = {
  excellent: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  good: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  moderate: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  caution: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
  info: 'border-slate-500/40 bg-slate-500/10 text-slate-200',
};
