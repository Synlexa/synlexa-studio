import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AssistantView } from '../components/AssistantView';
import { GeminiAgentPanel } from '../components/GeminiAgentPanel';
import { MarkdownContent, parseMarkdownBlocks, stripMarkdownForPreview } from '../components/MarkdownContent';
import { ThinkingProcessPanel } from '../components/ThinkingProcessPanel';
import { runAssistantTurn, type AiConfig } from '../lib/aiProviders';
import {
  runGeminiAgentTurn,
  type AgentStepTrace,
  type GeminiWorkspaceContext,
} from '../lib/geminiAgent';

const sampleWorkspace: GeminiWorkspaceContext = {
  refLabel: '3HS4.cif',
  mobLabel: 'AF-P00918-F1-model_v6.cif',
  refChain: 'A',
  mobChain: 'A',
  refInspect: null,
  mobInspect: null,
  comparison: null,
  peptide: null,
  crispr: null,
  smiles: null,
  ramachandran: null,
};

describe('Structured Markdown rendering for AI responses', () => {
  it('renders H1-H6 headings, horizontal rules, ordered/nested lists, GFM tables, code blocks, and safe links', () => {
    const sampleResponse = [
      '• **Molecular Class:** Investigational tri-agonist (`PMID:42942810`, `PMID:42745421`):',
      '',
      '1. **GIPR** (glucose-dependent insulinotropic polypeptide receptor)',
      '2. **GLP-1R** (glucagon-like peptide-1 receptor)',
      '   - Sub-item with `fetch_from_database` and `AF-P00918-F1-model_v6.cif`',
      '3. **GCGR** (glucagon receptor)',
      '',
      '---',
      '',
      '#### 3. Experimental 3D Structures in RCSB PDB',
      '',
      'RCSB PDB currently hosts four cryo-EM structures:',
      '',
      '| PDB ID | Receptor Complex | Method & Resolution | EMDB / Citation | RCSB URL |',
      '| :--- | :--- | :--- | :--- | :--- |',
      '| `8YW3` | Human **GLP-1R–Gs** + retatrutide | Cryo-EM, **2.68 Å** | `EMD-39621` · `PMID:39019866` | https://www.rcsb.org/structure/8YW3 |',
      '| `8YWF` | **GLP-1** complex (non-polymer `A1D7Q`) | Cryo-EM, **2.74 Å** | `EMD-39631` · To Be Published | [8YWF](https://www.rcsb.org/structure/8YWF) |',
      '',
      '```python',
      'print("8YW3", 2.68)',
      '```',
      '',
      '> **Note:** Verify `fetch_from_database` outputs directly.',
      '',
      '- [x] Checked unsafe link: [bad](javascript:alert(1))',
    ].join('\n');

    const blocks = parseMarkdownBlocks(sampleResponse);
    expect(blocks.some((b) => b.type === 'table')).toBe(true);
    expect(blocks.some((b) => b.type === 'hr')).toBe(true);
    expect(blocks.some((b) => b.type === 'heading' && b.level === 4)).toBe(true);
    expect(blocks.some((b) => b.type === 'code' && b.lang === 'python')).toBe(true);
    expect(blocks.some((b) => b.type === 'blockquote')).toBe(true);

    const html = renderToStaticMarkup(createElement(MarkdownContent, { text: sampleResponse }));
    expect(html).toContain('<h4');
    expect(html).toContain('3. Experimental 3D Structures in RCSB PDB');
    expect(html).not.toContain('####');
    expect(html).toContain('<hr');
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('<code');
    expect(html).toContain('>8YW3</code>');
    expect(html).toContain('>EMD-39621</code>');
    expect(html).toContain('<ol');
    expect(html).toContain('<ul');
    expect(html).toContain('href="https://www.rcsb.org/structure/8YW3"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('print(&quot;8YW3&quot;, 2.68)');
    expect(html).toContain('<blockquote');
    // Underscores inside identifiers must never become <em> italics
    expect(html).not.toContain('<em>from</em>');
    expect(html).not.toContain('<em>F1</em>');
    // Unsafe URL schemes must never produce clickable links
    expect(html).not.toContain('href="javascript:');
  });

  it('preserves escaped pipes and pipes inside inline code within GFM table cells', () => {
    const md = [
      '| Symbol | Expression |',
      '| --- | --- |',
      '| `a|b` | x \\| y |',
    ].join('\n');

    const blocks = parseMarkdownBlocks(md);
    const table = blocks.find((b) => b.type === 'table');
    expect(table).toBeDefined();
    if (table && table.type === 'table') {
      expect(table.headers).toEqual(['Symbol', 'Expression']);
      expect(table.rows).toEqual([['`a|b`', 'x | y']]);
    }
  });
});

describe('Thinking process capture & structured visualization', () => {
  it('requests includeThoughts on Gemini, removes empty planning placeholders, and emits running->done tool traces', async () => {
    const seenBodies: Array<Record<string, unknown>> = [];
    const responses = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { thought: true, thoughtSignature: 'sig-1', text: 'Checking **RCSB** entries first.' },
                { text: 'Fetching `8YW3` metadata.' },
                { functionCall: { name: 'fetch_from_database', args: { source: 'rcsb', query: '8YW3' } } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 40 },
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '#### Done\n\n| PDB | Status |\n| :--- | :--- |\n| `8YW3` | Loaded |' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 140, candidatesTokenCount: 30 },
      },
    ];

    let callIdx = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seenBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(responses[callIdx++]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const progressSnapshots: AgentStepTrace[][] = [];
    const reply = await runGeminiAgentTurn({
      prompt: 'Inspect 8YW3',
      history: [],
      workspace: sampleWorkspace,
      apiKey: 'AIza-test',
      model: 'gemini-4-hydrogen',
      fetchImpl,
      onProgress: (steps) => progressSnapshots.push(steps),
      executeTool: async () => ({ ok: true, summary: 'Loaded 8YW3 from RCSB', data: { pdbId: '8YW3' } }),
    });

    expect((seenBodies[0].generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      includeThoughts: true,
    });
    expect(reply.thinkingTrace).toEqual(['Checking **RCSB** entries first.', 'Fetching `8YW3` metadata.']);
    expect(reply.stepTrace?.some((s) => s.title.includes('Planning'))).toBe(false);
    expect(progressSnapshots.some((snap) => snap.some((s) => s.status === 'running' && s.toolName === 'fetch_from_database'))).toBe(true);
    expect(reply.stepTrace?.some((s) => s.status === 'done' && s.toolName === 'fetch_from_database')).toBe(true);
    expect(typeof reply.durationMs).toBe('number');
  });

  it('retries Gemini turn cleanly without thinkingConfig if a model rejects thinkingConfig with HTTP 400', async () => {
    const seenBodies: Array<Record<string, unknown>> = [];
    let attempt = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seenBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      attempt++;
      if (attempt === 1) {
        return new Response(
          JSON.stringify({ error: { code: 400, message: 'Unknown name "thinkingConfig" at generation_config' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Fallback ok.' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const reply = await runGeminiAgentTurn({
      prompt: 'Check status',
      history: [],
      workspace: sampleWorkspace,
      apiKey: 'AIza-test',
      fetchImpl,
      executeTool: vi.fn(),
    });

    expect(attempt).toBe(2);
    expect((seenBodies[0].generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ includeThoughts: true });
    expect((seenBodies[1].generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
    expect(reply.mode).toBe('gemini-api');
    expect(reply.text).toContain('Fallback ok.');
  });

  it('requests summarized adaptive thinking on Anthropic and captures thinking blocks cleanly', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [
            { type: 'thinking', thinking: 'Evaluating active site zinc coordination.' },
            { type: 'text', text: 'Active site verified. Research use only (RUO).' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 90, output_tokens: 25 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const cfg: AiConfig = {
      provider: 'anthropic',
      synlexa: { apiKey: '', model: 'gemini-3.1-flash-lite' },
      anthropic: { apiKey: 'sk-ant-test', model: 'claude-opus-5-5' },
      gemini: { apiKey: '', model: 'gemini-3.1-flash-lite' },
    };

    const reply = await runAssistantTurn({
      prompt: 'Check zinc site',
      history: [],
      workspace: sampleWorkspace,
      config: cfg,
      fetchImpl,
      executeTool: vi.fn(),
    });

    expect(requests[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(reply.thinkingTrace).toEqual(['Evaluating active site zinc coordination.']);
    expect(reply.stepTrace?.[0]?.title).toContain('Claude reasoning');
  });

  it('renders ThinkingProcessPanel preview & timeline and integrates cleanly into AssistantView & GeminiAgentPanel', () => {
    const preview = stripMarkdownForPreview('#### Plan\n- Inspect **8YW3** via [RCSB](https://www.rcsb.org)');
    expect(preview).toBe('Plan Inspect 8YW3 via RCSB');

    const collapsedHtml = renderToStaticMarkup(
      createElement(ThinkingProcessPanel, {
        thinkingTrace: ['Checking **8YW3** cryo-EM metadata.'],
        executedTools: [
          {
            name: 'fetch_from_database',
            args: { source: 'rcsb', query: '8YW3' },
            ok: true,
            summary: 'Loaded 8YW3',
            result: null,
            durationMs: 240,
          },
        ],
        durationMs: 1500,
        defaultOpen: false,
      }),
    );
    expect(collapsedHtml).toContain('Thinking &amp; tool process');
    expect(collapsedHtml).toContain('1.5s');
    expect(collapsedHtml).toContain('Checking 8YW3 cryo-EM metadata.');
    expect(collapsedHtml).toContain('fetch_from_database');

    const expandedHtml = renderToStaticMarkup(
      createElement(ThinkingProcessPanel, {
        stepTrace: [
          {
            round: 1,
            phase: 'thinking',
            title: 'Model reasoning (round 1)',
            detail: '- Check **8YW3**\n- Compare `EMD-39621`',
            durationMs: 620,
            status: 'done',
          },
          {
            round: 1,
            phase: 'tool',
            title: 'fetch_from_database · ok',
            detail: 'Loaded 8YW3',
            toolName: 'fetch_from_database',
            args: { source: 'rcsb', query: '8YW3' },
            durationMs: 180,
            ok: true,
            status: 'done',
          },
        ],
        defaultOpen: true,
      }),
    );
    expect(expandedHtml).toContain('<ul');
    expect(expandedHtml).toContain('<strong');
    expect(expandedHtml).toContain('source:');
    expect(expandedHtml).toContain('rcsb');

    const assistantHtml = renderToStaticMarkup(
      createElement(AssistantView, {
        messages: [
          {
            id: 'u1',
            role: 'user',
            text: 'Show 8YW3 structures',
            timestampUtc: '2026-11-16T12:00:00Z',
          },
          {
            id: 'a1',
            role: 'assistant',
            mode: 'gemini-api',
            model: 'gemini-4-hydrogen',
            text: '#### 3. Structures\n\n| PDB |\n| --- |\n| `8YW3` |',
            thinkingTrace: ['Queried RCSB for 8YW3.'],
            durationMs: 1200,
            timestampUtc: '2026-11-16T12:00:01Z',
          },
        ],
        busy: false,
        config: {
          provider: 'gemini',
          synlexa: { apiKey: '', model: 'gemini-3.1-flash-lite' },
          anthropic: { apiKey: '', model: 'claude-opus-5-5' },
          gemini: { apiKey: 'AIza-demo', model: 'gemini-4-hydrogen' },
        },
        onSelectProvider: () => {},
        onSend: () => {},
        onClear: () => {},
        onOpenKeySettings: () => {},
      }),
    );
    expect(assistantHtml).toContain('<h4');
    expect(assistantHtml).toContain('<table');
    expect(assistantHtml).toContain('Queried RCSB for 8YW3.');
    expect(assistantHtml).toContain('Copy');

    const panelHtml = renderToStaticMarkup(
      createElement(GeminiAgentPanel, {
        messages: [
          {
            id: 'a2',
            role: 'assistant',
            mode: 'gemini-api',
            text: '#### Summary\n\n| ID |\n| --- |\n| `8YW3` |',
            thinkingTrace: ['Verified 8YW3.'],
            timestampUtc: '2026-11-16T12:00:01Z',
          },
        ],
        busy: false,
        config: { apiKey: 'AIza-demo', model: 'gemini-4-hydrogen', keySource: 'vault' },
        onUpdateConfig: () => {},
        onSendPrompt: () => {},
      }),
    );
    expect(panelHtml).toContain('<h4');
    expect(panelHtml).toContain('<table');
    expect(panelHtml).toContain('Verified 8YW3.');
  });
});
