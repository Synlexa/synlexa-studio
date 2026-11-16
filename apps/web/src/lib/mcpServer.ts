/**
 * In-App Model Context Protocol (MCP) Server for Synlexa Studio (RUO).
 *
 * Implements JSON-RPC 2.0 MCP methods (`initialize`, `ping`, `tools/list`,
 * `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`)
 * inside the browser/desktop workbench and shares the exact same deterministic
 * tool execution pipeline with:
 *   1) The internal Studio AI Assistant (`aiProviders.ts` / `geminiAgent.ts`)
 *   2) The interactive MCP Playground (`McpServerView.tsx`)
 *   3) External AI clients (Claude Desktop, Claude Code, OpenAI Codex, Cursor)
 *      via `synlexa-studio mcp` (stdio) or `http://127.0.0.1:4179/mcp`.
 */
import type { LibraryItem } from './moleculeLibrary';
import {
  STUDIO_TOOL_DECLARATIONS,
  type GeminiFunctionDeclaration,
  type GeminiToolName,
  type GeminiWorkspaceContext,
  type ToolExecutor,
} from './geminiAgent';
import { getVaultStatus } from './secureKeyVault';
import { listAllPlugins } from './pluginRegistry';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_INFO = {
  name: 'synlexa-studio-mcp',
  version: typeof __SYNLEXA_APP_VERSION__ !== 'undefined' ? __SYNLEXA_APP_VERSION__ : '0.4.0',
  description: 'Deterministic computational biology, structural superposition, CRISPR, SMILES, and scientific web MCP server (RUO).',
};

export interface McpToolSpec {
  name: GeminiToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface McpResourceSpec {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptSpec {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface McpLogEntry {
  id: string;
  timestampUtc: string;
  caller: 'internal-ai-agent' | 'mcp-playground' | 'external-client';
  method: string;
  target: string;
  ok: boolean;
  durationMs: number;
  summary: string;
  requestPayload?: unknown;
  responsePreview?: unknown;
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerRuntime {
  workspace: GeminiWorkspaceContext;
  libraryItems: LibraryItem[];
  executeTool: ToolExecutor;
}

const logEntries: McpLogEntry[] = [];
const logListeners = new Set<() => void>();

function emitLogs() {
  for (const fn of logListeners) fn();
}

export function getMcpLogs(): McpLogEntry[] {
  return [...logEntries];
}

export function clearMcpLogs(): void {
  logEntries.length = 0;
  emitLogs();
}

export function subscribeMcpLogs(fn: () => void): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function recordMcpLog(entry: McpLogEntry) {
  logEntries.unshift(entry);
  if (logEntries.length > 100) logEntries.length = 100;
  emitLogs();
}

export function toMcpInputSchema(decl: GeminiFunctionDeclaration): McpToolSpec['inputSchema'] {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(decl.parameters.properties)) {
    const prop: Record<string, unknown> = {
      type: v.type.toLowerCase(),
      description: v.description,
    };
    if (v.enum) prop.enum = v.enum;
    if (v.items) prop.items = { type: v.items.type.toLowerCase() };
    properties[k] = prop;
  }
  return {
    type: 'object',
    properties,
    required: decl.parameters.required ?? [],
  };
}

export const MCP_TOOLS: McpToolSpec[] = STUDIO_TOOL_DECLARATIONS.map((d) => ({
  name: d.name,
  description: d.description,
  inputSchema: toMcpInputSchema(d),
}));

export function getEffectiveMcpTools(): McpToolSpec[] {
  const dynamic: McpToolSpec[] = [];
  for (const p of listAllPlugins()) {
    if (p.builtin || !p.enabled || !p.mcpTools) continue;
    for (const t of p.mcpTools) {
      dynamic.push({
        name: t.name as GeminiToolName,
        description: `[Plugin: ${p.name}] ${t.description}`,
        inputSchema: t.inputSchema,
      });
    }
  }
  return [...MCP_TOOLS, ...dynamic];
}

export const MCP_RESOURCES: McpResourceSpec[] = [
  {
    uri: 'synlexa://workspace/summary',
    name: 'Live Workspace Summary',
    description: 'Overview of loaded structures, RMSD, coverage, active-site contacts, and workbench state.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://workspace/comparison',
    name: 'Kabsch Superposition Result',
    description: 'Full ComparisonResultV1 metrics, 4x4 rigid transform matrix, and top deviating residues.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://workspace/peptide',
    name: 'Peptide Engineering State',
    description: 'Wild-type vs engineered biophysical descriptors, pH titration delta, and 5.0 Å 3D contacts.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://workspace/crispr',
    name: 'CRISPR & Coding Transcript Analysis',
    description: 'Codon translation consequence and SpCas9/SaCas9/Cas12a PAM site scan.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://workspace/chemistry',
    name: 'Ligands & SMILES Descriptors',
    description: 'Formula, molecular weight, TPSA, cLogP, Lipinski/Veber metrics, and 2D layout.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://workspace/ramachandran',
    name: 'Ramachandran Geometry & Contacts',
    description: 'Backbone (φ, ψ) angles, secondary structure fractions, and Cα–Cα contact pairs.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://library/catalog',
    name: 'Local Molecule Library Catalog',
    description: 'Structures, ligands, and sequences saved in IndexedDB with SHA-256 provenance.',
    mimeType: 'application/json',
  },
  {
    uri: 'synlexa://vault/status',
    name: 'Encrypted BYOK Vault Status',
    description: 'Non-secret metadata and backend status for local state.vscdb key storage.',
    mimeType: 'application/json',
  },
];

export const MCP_PROMPTS: McpPromptSpec[] = [
  {
    name: 'structural-deviation-audit',
    description: 'Audit Kabsch RMSD, coverage denominators, PAE uncertainty, and top deviating residues (RUO).',
    arguments: [{ name: 'focus_chain', description: 'Chain ID to examine (e.g. A)', required: false }],
  },
  {
    name: 'active-site-mutation-scan',
    description: 'Evaluate a point mutation in the active site along with 5.0 Å local 3D contacts.',
    arguments: [{ name: 'mutation', description: 'Mutation notation such as H94A', required: true }],
  },
  {
    name: 'crispr-codon-pam-plan',
    description: 'Inspect coding codon edit consequence and enumerate SpCas9/Cas12a PAM windows.',
    arguments: [{ name: 'transcript', description: 'RefSeq transcript ID (e.g. NM_000067.3)', required: true }],
  },
  {
    name: 'literature-evidence-check',
    description: 'Query Europe PMC and ClinicalTrials.gov via search_scientific_web with verified PMIDs/NCTs.',
    arguments: [{ name: 'topic', description: 'Biomarker, protein, or ligand query', required: true }],
  },
];

export function buildWorkspaceTelemetrySnapshot(
  ctx: GeminiWorkspaceContext,
  libraryItems: LibraryItem[],
  section = 'all',
  topN = 10,
): Record<string, unknown> {
  const n = Math.max(1, Math.min(50, topN));
  const include = (key: string) => section === 'all' || section === key;
  const out: Record<string, unknown> = {
    ruoNotice: 'For research and development use. Not for diagnostic or treatment decisions.',
    capturedAtUtc: new Date().toISOString(),
  };

  if (include('comparison')) {
    out.structures = {
      refLabel: ctx.refLabel,
      refChain: ctx.refChain,
      refSha256: ctx.comparison?.reference.sha256 ?? ctx.refInspect?.sha256 ?? null,
      refConfidenceKind: ctx.comparison?.reference.confidenceKind ?? ctx.refInspect?.confidenceKind ?? null,
      mobLabel: ctx.mobLabel,
      mobChain: ctx.mobChain,
      mobSha256: ctx.comparison?.mobile.sha256 ?? ctx.mobInspect?.sha256 ?? null,
      mobConfidenceKind: ctx.comparison?.mobile.confidenceKind ?? ctx.mobInspect?.confidenceKind ?? null,
      comparison: ctx.comparison
        ? {
            resultId: ctx.comparison.resultId,
            metrics: ctx.comparison.metrics,
            topDeviatingResidues: [...ctx.comparison.matchedResidues]
              .sort((a, b) => b.distanceAngstrom - a.distanceAngstrom)
              .slice(0, n),
            ligands: ctx.comparison.refDisplayAtoms?.ligands.map((l) => ({
              resName: l.resName,
              chainId: l.chainId,
              seqId: l.seqId,
              atomCount: l.atoms.length,
            })),
          }
        : null,
    };
  }

  if (include('contacts')) {
    out.activeSiteContacts = (ctx.comparison?.refContacts ?? []).slice(0, n);
  }

  if (include('peptide')) {
    out.peptide = ctx.peptide
      ? {
          appliedMutations: ctx.peptide.appliedMutations,
          wildType: ctx.peptide.wildType,
          engineered: ctx.peptide.engineered,
          deltas: ctx.peptide.deltas,
          local3dContacts: ctx.peptide.local3dContacts.slice(0, n),
        }
      : null;
  }

  if (include('crispr')) {
    out.crispr = ctx.crispr
      ? {
          transcriptId: ctx.crispr.transcriptId,
          geneSymbol: ctx.crispr.geneSymbol,
          cdsLengthBp: ctx.crispr.cdsLengthBp,
          targetCodon: ctx.crispr.targetCodon,
          pamSitesCount: ctx.crispr.pamSites.length,
          topPamSites: ctx.crispr.pamSites.slice(0, n),
        }
      : null;
  }

  if (include('chemistry')) {
    out.chemistry = ctx.smiles
      ? {
          name: ctx.smiles.name,
          smiles: ctx.smiles.smiles,
          formula: ctx.smiles.formula,
          molecularWeight: ctx.smiles.molecularWeight,
          exactMass: ctx.smiles.exactMass,
          tpsa: ctx.smiles.tpsa,
          crippenLogP: ctx.smiles.crippenLogP,
          hbd: ctx.smiles.hbd,
          hba: ctx.smiles.hba,
          rotatableBonds: ctx.smiles.rotatableBonds,
          ringCount: ctx.smiles.ringCount,
          lipinskiViolations: ctx.smiles.lipinskiViolations,
          veberCompliant: ctx.smiles.veberCompliant,
        }
      : null;
  }

  if (include('ramachandran')) {
    out.ramachandran = ctx.ramachandran
      ? {
          chainId: ctx.ramachandran.chainId,
          residueCount: ctx.ramachandran.residueCount,
          secondaryCounts: ctx.ramachandran.secondaryCounts,
          regionCounts: ctx.ramachandran.regionCounts,
          contactPairsCount: ctx.ramachandran.contactPairs.length,
          outliers: ctx.ramachandran.residues.filter((r) => r.region === 'outlier').slice(0, n),
        }
      : null;
  }

  if (include('library')) {
    out.library = libraryItems.slice(0, n).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      format: item.format,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
      source: item.source,
    }));
  }

  return out;
}

export function readMcpResource(
  uri: string,
  workspace: GeminiWorkspaceContext,
  libraryItems: LibraryItem[],
): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  let payload: unknown;
  switch (uri) {
    case 'synlexa://workspace/summary':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'all', 10);
      break;
    case 'synlexa://workspace/comparison':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'comparison', 25);
      break;
    case 'synlexa://workspace/peptide':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'peptide', 20);
      break;
    case 'synlexa://workspace/crispr':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'crispr', 20);
      break;
    case 'synlexa://workspace/chemistry':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'chemistry', 20);
      break;
    case 'synlexa://workspace/ramachandran':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'ramachandran', 25);
      break;
    case 'synlexa://library/catalog':
      payload = buildWorkspaceTelemetrySnapshot(workspace, libraryItems, 'library', 50);
      break;
    case 'synlexa://vault/status':
      payload = getVaultStatus();
      break;
    default:
      throw new Error(`Unknown MCP resource URI: ${uri}`);
  }
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/** Wraps internal AI tool execution so every call flows through MCP + updates the live MCP log. */
export async function invokeMcpTool(
  runtime: McpServerRuntime,
  toolName: GeminiToolName,
  args: Record<string, unknown>,
  caller: McpLogEntry['caller'] = 'internal-ai-agent',
): Promise<{ ok: boolean; summary: string; data: unknown }> {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let outcome: { ok: boolean; summary: string; data: unknown };
  try {
    outcome = await runtime.executeTool(toolName, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome = { ok: false, summary: msg, data: { error: msg } };
  }
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recordMcpLog({
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestampUtc: new Date().toISOString(),
    caller,
    method: 'tools/call',
    target: toolName,
    ok: outcome.ok,
    durationMs: Math.max(0, Math.round(end - start)),
    summary: outcome.summary,
    requestPayload: args,
    responsePreview: outcome.data,
  });
  return outcome;
}

/** Handles raw JSON-RPC 2.0 MCP messages inside the app or from a bridge. */
export async function handleMcpJsonRpc(
  req: McpJsonRpcRequest,
  runtime: McpServerRuntime,
  caller: McpLogEntry['caller'] = 'mcp-playground',
): Promise<McpJsonRpcResponse> {
  const id = req.id ?? null;
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const params = req.params ?? {};

  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: MCP_SERVER_INFO,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: getEffectiveMcpTools() } };
      case 'tools/call': {
        const name = String(params.name ?? '') as GeminiToolName;
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<
          string,
          unknown
        >;
        if (!getEffectiveMcpTools().some((t) => t.name === name)) {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown MCP tool: ${name}` } };
        }
        const outcome = await invokeMcpTool(runtime, name, args, caller);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: !outcome.ok,
            content: [
              {
                type: 'text',
                text: JSON.stringify({ summary: outcome.summary, data: outcome.data }, null, 2),
              },
            ],
          },
        };
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: MCP_RESOURCES } };
      case 'resources/read': {
        const uri = String(params.uri ?? '');
        const result = readMcpResource(uri, runtime.workspace, runtime.libraryItems);
        const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
        recordMcpLog({
          id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestampUtc: new Date().toISOString(),
          caller,
          method: 'resources/read',
          target: uri,
          ok: true,
          durationMs: Math.max(0, Math.round(end - start)),
          summary: `Read resource ${uri}`,
          requestPayload: params,
        });
        return { jsonrpc: '2.0', id, result };
      }
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: MCP_PROMPTS } };
      case 'prompts/get': {
        const name = String(params.name ?? '');
        const p = MCP_PROMPTS.find((x) => x.name === name);
        if (!p) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown MCP prompt: ${name}` } };
        }
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<
          string,
          string
        >;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: p.description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `[Synlexa Studio RUO MCP Prompt: ${p.name}] Arguments: ${JSON.stringify(args)}. Inspect synlexa://workspace/summary first, use deterministic Studio MCP tools, and cite verified provenance only.`,
                },
              },
            ],
          },
        };
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export function getExternalMcpSnippets(httpPort = 4179) {
  return {
    claudeDesktopJson: JSON.stringify(
      {
        mcpServers: {
          'synlexa-studio': {
            command: 'synlexa-studio',
            args: ['mcp', '--stdio'],
          },
        },
      },
      null,
      2,
    ),
    claudeCodeCmd: 'claude mcp add synlexa-studio -- synlexa-studio mcp --stdio',
    codexCliCmd: 'codex mcp add synlexa-studio -- synlexa-studio mcp --stdio',
    codexConfigToml: `[mcp_servers.synlexa_studio]\ncommand = "synlexa-studio"\nargs = ["mcp", "--stdio"]`,
    httpEndpointJson: JSON.stringify(
      {
        mcpServers: {
          'synlexa-studio-http': {
            url: `http://127.0.0.1:${httpPort}/mcp`,
            transport: 'http',
          },
        },
      },
      null,
      2,
    ),
  };
}
