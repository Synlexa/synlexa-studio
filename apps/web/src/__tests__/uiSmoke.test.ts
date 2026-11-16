import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadWasmBioCore } from '@synlexa/wasm-bridge';
import { BioEngineClient } from '../lib/bioEngineClient';
import { TopHeaderBar } from '../components/TopHeaderBar';
import { SequenceDeviationTrack } from '../components/SequenceDeviationTrack';
import { PeptideWorkbench } from '../components/PeptideWorkbench';
import { CrisprWorkbench } from '../components/CrisprWorkbench';
import { ChemistryWorkbench } from '../components/ChemistryWorkbench';
import { RamachandranPanel } from '../components/RamachandranPanel';
import { OnboardingLaunchpad } from '../components/OnboardingLaunchpad';
import { SimpleStepperBar } from '../components/SimpleStepperBar';
import { GeminiAgentPanel } from '../components/GeminiAgentPanel';

describe('UI Component Server Render Smoke Tests (RUO)', () => {
  it('renders TopHeaderBar and all 4 biology/chemistry workbench tabs with real Wasm data', async () => {
    const [wasmBytes, refCif, mobCif, paeJson] = await Promise.all([
      readFile(new URL('../../public/wasm/synlexa_bio_core.wasm', import.meta.url)),
      readFile(new URL('../../public/fixtures/3HS4.cif', import.meta.url), 'utf8'),
      readFile(new URL('../../public/fixtures/AF-P00918-F1-model_v6.cif', import.meta.url), 'utf8'),
      readFile(
        new URL('../../public/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json', import.meta.url),
        'utf8',
      ),
    ]);

    const session = await loadWasmBioCore(new Uint8Array(wasmBytes));
    const client = BioEngineClient.fromWasmSession(session);

    const [refInsp, mobInsp, cmp] = await Promise.all([
      client.inspectStructure('r', { label: '3HS4.cif', content: refCif }),
      client.inspectStructure('m', { label: 'AF-P00918-F1-model_v6.cif', content: mobCif }),
      client.compareStructures({
        refLabel: '3HS4.cif',
        refContent: refCif,
        refChain: 'A',
        mobLabel: 'AF-P00918-F1-model_v6.cif',
        mobContent: mobCif,
        mobChain: 'A',
        paeJson,
      }),
    ]);

    const seq = mobInsp.chains[0].sequence1Letter;
    const [pep, crispr, chem] = await Promise.all([
      client.analyzePeptide({
        sequence: seq,
        mutations: ['H94A', 'T199V'],
        structureContent: refCif,
        chainId: 'A',
        focusSeqId: 94,
      }),
      client.analyzeGeneCrispr({
        transcriptId: 'NM_000067.3',
        targetCodonIndex: 94,
        baseEditIndex: (94 - 1) * 3 + 1,
        newBase: 'G',
        nuclease: 'SpCas9',
      }),
      client.analyzeMoleculeSmiles({
        name: 'Acetazolamide',
        smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
      }),
    ]);

    const headerHtml = renderToStaticMarkup(
      createElement(TopHeaderBar, {
        comparison: cmp,
        busyLabel: null,
        wasmReady: true,
        rendererMode: 'webgl2',
        onOpenPalette: () => {},
        onExportHtmlReport: () => {},
        onExportBundle: () => {},
      }),
    );
    expect(headerHtml).toContain('RESEARCH USE ONLY (RUO)');
    expect(headerHtml).toContain('0.368');

    const seqHtml = renderToStaticMarkup(
      createElement(SequenceDeviationTrack, {
        comparison: cmp,
        refInspect: refInsp,
        mobInspect: mobInsp,
        refChainId: 'A',
        mobChainId: 'A',
        focusedSeqId: 94,
        onFocusResidue: () => {},
      }),
    );
    expect(seqHtml).toContain('Focus:');

    const pepHtml = renderToStaticMarkup(
      createElement(PeptideWorkbench, {
        state: {
          sequence: seq,
          mutationsInput: 'H94A, T199V',
          mutations: ['H94A', 'T199V'],
          sliceStart: 1,
          sliceEnd: seq.length,
          focusSeqId: 94,
        },
        dispatch: () => {},
        result: pep,
        error: null,
        onFocusResidue: () => {},
      }),
    );
    expect(pepHtml).toContain('H94A');
    expect(pepHtml).toContain('T199V');

    const crisprHtml = renderToStaticMarkup(
      createElement(CrisprWorkbench, {
        state: {
          transcriptId: 'NM_000067.3',
          customDna: '',
          useCustomDna: false,
          targetCodonIndex: 94,
          baseEditOffset: 0,
          newBase: 'G',
          nuclease: 'SpCas9',
        },
        dispatch: () => {},
        result: crispr,
        error: null,
        onFocusResidue: () => {},
      }),
    );
    expect(crisprHtml).toContain('CA2');
    expect(crisprHtml).toContain('Codon 94');

    const chemHtml = renderToStaticMarkup(
      createElement(ChemistryWorkbench, {
        state: {
          selectedPresetId: 'azm',
          name: 'Acetazolamide',
          smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
        },
        dispatch: () => {},
        result: chem,
        comparison: cmp,
        error: null,
        onFocusResidue: () => {},
      }),
    );
    expect(chemHtml).toContain('C4H6N4O3S2');
    expect(chemHtml).toContain('AZM');
  });

  it('renders Simple Mode stepper, Quick-Start launchpad, Ramachandran Wasm panel, and Gemini Agent panel', async () => {
    const [wasmBytes, refCif] = await Promise.all([
      readFile(new URL('../../public/wasm/synlexa_bio_core.wasm', import.meta.url)),
      readFile(new URL('../../public/fixtures/3HS4.cif', import.meta.url), 'utf8'),
    ]);
    const session = await loadWasmBioCore(new Uint8Array(wasmBytes));
    const client = BioEngineClient.fromWasmSession(session);
    const rama = await client.analyzeRamachandran({ content: refCif, chainId: 'A' });

    expect(rama.residueCount).toBe(257);
    expect(rama.contactPairs.length).toBeGreaterThan(500);

    const ramaHtml = renderToStaticMarkup(
      createElement(RamachandranPanel, {
        refLabel: '3HS4.cif',
        refChain: 'A',
        mobLabel: 'AF-P00918-F1-model_v6.cif',
        mobChain: 'A',
        activeSource: 'reference',
        onChangeSource: () => {},
        result: rama,
        error: null,
        focusedSeqId: 94,
        onFocusResidue: () => {},
        simpleMode: true,
      }),
    );
    expect(ramaHtml).toContain('RAMACHANDRAN PLOT');
    expect(ramaHtml).toContain('α-Helix');
    expect(ramaHtml).toContain('β-Sheet');

    const stepperHtml = renderToStaticMarkup(
      createElement(SimpleStepperBar, {
        currentStep: 2,
        activeStarterTitle: 'Carbonic Anhydrase II',
        onSelectStep: () => {},
        onOpenLaunchpad: () => {},
        onOpenDatabaseExplorer: () => {},
        onSwitchToPro: () => {},
      }),
    );
    expect(stepperHtml).toContain('Pick or Fetch Molecule');
    expect(stepperHtml).toContain('Ask Gemini &amp; Export');

    const launchpadHtml = renderToStaticMarkup(
      createElement(OnboardingLaunchpad, {
        open: true,
        onClose: () => {},
        activeStarterId: 'ca2-azm',
        onLaunchStarter: () => {},
        onOpenDatabaseExplorer: () => {},
        onJumpToStep: () => {},
      }),
    );
    expect(launchpadHtml).toContain('Carbonic Anhydrase II');
    expect(launchpadHtml).toContain('Human Ubiquitin');
    expect(launchpadHtml).toContain('Hemoglobin β');
    expect(launchpadHtml).toContain('Human Lysozyme C');
    expect(launchpadHtml).toContain('Small-Molecule Chemistry Panel');
    expect(launchpadHtml).toContain('RESEARCH USE ONLY (RUO)');

    const agentHtml = renderToStaticMarkup(
      createElement(GeminiAgentPanel, {
        messages: [
          {
            id: '1',
            role: 'assistant',
            mode: 'local-deterministic-fallback',
            text: 'RUO ready',
            timestampUtc: '2026-11-15T00:00:00Z',
          },
        ],
        busy: false,
        config: { apiKey: '', model: 'gemini-3.1-flash-lite', keySource: 'none' },
        onUpdateConfig: () => {},
        onSendPrompt: () => {},
        simpleMode: true,
      }),
    );
    expect(agentHtml).toContain('RUO assistant');
  });
});
