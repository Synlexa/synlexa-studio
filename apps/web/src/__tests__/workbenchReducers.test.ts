import { describe, expect, it } from 'vitest';
import {
  BioEngineClient,
  CancelledRunError,
} from '../lib/bioEngineClient';
import { executeCopilotCommand } from '../lib/copilotEngine';
import {
  chemistryReducer,
  crisprReducer,
  parseMutationList,
  peptideReducer,
  SMILES_PRESETS,
  type ChemistryWorkbenchState,
  type CrisprWorkbenchState,
  type PeptideWorkbenchState,
} from '../lib/workbenchReducers';

describe('Workbench Reducers, Client Cancellation & Copilot', () => {
  it('handles peptide sequence, mutation list, and slice clamping cleanly', () => {
    let state: PeptideWorkbenchState = {
      sequence: 'MSHHWGYGKH',
      mutationsInput: '',
      mutations: [],
      sliceStart: 1,
      sliceEnd: 10,
      focusSeqId: null,
    };

    state = peptideReducer(state, { type: 'add_mutation', notation: 'h4a' });
    expect(state.mutations).toEqual(['H4A']);

    state = peptideReducer(state, { type: 'add_mutation', notation: 'INVALID' });
    expect(state.mutations).toEqual(['H4A']);

    state = peptideReducer(state, { type: 'set_slice', start: 0, end: 999 });
    expect(state.sliceStart).toBe(1);
    expect(state.sliceEnd).toBe(10);

    expect(parseMutationList('H94A, t199v ; bad123')).toEqual(['H94A', 'T199V']);
  });

  it('handles CRISPR & Chemistry reducers deterministically', () => {
    let crispr: CrisprWorkbenchState = {
      transcriptId: 'NM_000067.3',
      customDna: '',
      useCustomDna: false,
      targetCodonIndex: 94,
      baseEditOffset: 0,
      newBase: 'A',
      nuclease: 'SpCas9',
    };

    crispr = crisprReducer(crispr, { type: 'set_target_codon', codonIndex: -5 });
    expect(crispr.targetCodonIndex).toBe(1);
    crispr = crisprReducer(crispr, { type: 'set_nuclease', nuclease: 'Cas12a' });
    expect(crispr.nuclease).toBe('Cas12a');
    crispr = crisprReducer(crispr, { type: 'set_custom_dna', dna: 'atg-ccc-ttt' });
    expect(crispr.customDna).toBe('ATGCCCTTT');
    expect(crispr.useCustomDna).toBe(true);

    let chem: ChemistryWorkbenchState = {
      selectedPresetId: SMILES_PRESETS[0].id,
      name: SMILES_PRESETS[0].name,
      smiles: SMILES_PRESETS[0].smiles,
    };
    chem = chemistryReducer(chem, { type: 'select_preset', presetId: 'caffeine' });
    expect(chem.smiles).toBe('Cn1cnc2c1c(=O)n(C)c(=O)n2C');
    chem = chemistryReducer(chem, { type: 'set_custom_smiles', smiles: 'CCO', name: 'Ethanol' });
    expect(chem.selectedPresetId).toBe('custom');
    expect(chem.name).toBe('Ethanol');
  });

  it('cancels stale BioEngineClient requests on the same channel so newer runs win', async () => {
    let resolveFirst!: (val: { response: { ok: true; op: string; data: unknown; error: null } }) => void;
    let callCount = 0;

    const client = new BioEngineClient(async (_op, payload) => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return {
        cancelled: false,
        response: { ok: true, op: 'analyze_molecule_smiles', data: payload, error: null },
      };
    });

    const p1 = client.analyzeMoleculeSmiles({ smiles: 'C' }, 'smiles');
    const p2 = client.analyzeMoleculeSmiles({ smiles: 'CCO' }, 'smiles');

    resolveFirst({
      response: { ok: true, op: 'analyze_molecule_smiles', data: { smiles: 'C' }, error: null },
    });

    await expect(p1).rejects.toBeInstanceOf(CancelledRunError);
    await expect(p2).resolves.toMatchObject({ smiles: 'CCO' });
  });

  it('executes deterministic Copilot actions without fabricating metrics', () => {
    const out = executeCopilotCommand('focus_residues 94, 96, 119', {
      refLabel: '3HS4.cif',
      mobLabel: 'AF-P00918-F1-model_v6.cif',
      refInspect: null,
      mobInspect: null,
      comparison: null,
      peptide: null,
      crispr: null,
      smiles: null,
    });

    expect(out.actions).toEqual([{ type: 'focus_residues', seqIds: [94, 96, 119] }]);
    expect(out.reply.text).toContain('94, 96, 119');
  });
});
