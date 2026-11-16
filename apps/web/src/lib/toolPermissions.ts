export type ToolPermissionCategory =
  | 'safe_read'
  | 'external_network'
  | 'workspace_mutate'
  | 'remote_compute';

export type PermissionPolicyMode = 'ask' | 'always-allow' | 'deny';

export type PermissionDecision = 'allow_once' | 'allow_session' | 'deny';

export interface ToolPermissionRequest {
  id: string;
  toolName: string;
  category: ToolPermissionCategory;
  title: string;
  detail: string;
  args: Record<string, unknown>;
}

export type ToolPermissionPolicyMap = Record<ToolPermissionCategory, PermissionPolicyMode>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LS_PERMISSIONS_KEY = 'synlexa.studio.aiPermissions.v1';

export const DEFAULT_PERMISSION_POLICIES: ToolPermissionPolicyMap = {
  safe_read: 'always-allow',
  external_network: 'ask',
  workspace_mutate: 'always-allow',
  remote_compute: 'ask',
};

export const PERMISSION_CATEGORY_LABELS: Record<
  ToolPermissionCategory,
  { label: string; description: string }
> = {
  safe_read: {
    label: 'Workspace inspection & UI navigation',
    description: 'Read loaded metrics, switch tabs/views, focus residues, and run offline RDKit/Wasm checks.',
  },
  workspace_mutate: {
    label: 'Project changes, plugins & exports',
    description: 'Create/modify projects, split structures, toggle plugins, or download HTML/JSON reports.',
  },
  external_network: {
    label: 'External web & public databases',
    description: 'Fetch structures/compounds from RCSB/AlphaFold/PubChem/ChEMBL or search Europe PMC & ClinicalTrials.gov.',
  },
  remote_compute: {
    label: 'External GPU / Colab & multi-step pipelines',
    description: 'Dispatch jobs to connected GPU Compute Nodes (AutoDock Vina, OpenMM, Boltz-2, RFdiffusion, PySCF).',
  },
};

export function classifyToolPermission(
  toolName: string,
  args: Record<string, unknown> = {},
): { category: ToolPermissionCategory; title: string; detail: string } {
  switch (toolName) {
    case 'fetch_from_database':
      return {
        category: 'external_network',
        title: `Fetch from ${String(args.source ?? 'public database').toUpperCase()}`,
        detail: `Query "${String(args.query ?? '')}"${args.autoImport !== false ? ' and import into workspace' : ''}.`,
      };
    case 'search_scientific_web':
      return {
        category: 'external_network',
        title: 'Search scientific literature & trials',
        detail: `Query Europe PMC / ClinicalTrials.gov for "${String(args.query ?? '')}".`,
      };
    case 'run_compute_job':
      return {
        category: 'remote_compute',
        title: `Dispatch GPU / Compute job (${String(args.toolId ?? 'adapter')})`,
        detail: 'Submit computation to the active connected Compute Node.',
      };
    case 'run_workflow_pipeline':
      return {
        category: 'remote_compute',
        title: `Execute workflow pipeline (${String(args.templateId ?? 'active')})`,
        detail: 'Run multi-step DAG workflow across configured compute tiers.',
      };
    case 'export_ruo_report':
      return {
        category: 'workspace_mutate',
        title: `Export RUO ${String(args.format ?? 'html').toUpperCase()} artifact`,
        detail: 'Generate and download report/manifest/bundle file.',
      };
    case 'manage_project': {
      const action = String(args.action ?? 'list');
      return {
        category: action === 'list' ? 'safe_read' : 'workspace_mutate',
        title: `Project action: ${action}`,
        detail: `Modify or split project assets (${String(args.name ?? args.projectId ?? 'active project')}).`,
      };
    }
    case 'manage_plugins': {
      const action = String(args.action ?? 'list');
      return {
        category: action === 'list' ? 'safe_read' : 'workspace_mutate',
        title: `Plugin manager: ${action}`,
        detail: `Inspect or toggle plugin "${String(args.pluginId ?? 'catalog')}".`,
      };
    }
    default:
      return {
        category: 'safe_read',
        title: `Run ${toolName}`,
        detail: 'Deterministic local workspace / UI action.',
      };
  }
}

export function loadPermissionPolicies(storage?: StorageLike): ToolPermissionPolicyMap {
  let s: StorageLike | null = storage ?? null;
  if (!s) {
    try {
      s = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      s = null;
    }
  }
  if (!s) return { ...DEFAULT_PERMISSION_POLICIES };
  try {
    const raw = s.getItem(LS_PERMISSIONS_KEY);
    if (!raw) return { ...DEFAULT_PERMISSION_POLICIES };
    const parsed = JSON.parse(raw) as Partial<ToolPermissionPolicyMap>;
    return {
      safe_read: parsed.safe_read ?? DEFAULT_PERMISSION_POLICIES.safe_read,
      external_network: parsed.external_network ?? DEFAULT_PERMISSION_POLICIES.external_network,
      workspace_mutate: parsed.workspace_mutate ?? DEFAULT_PERMISSION_POLICIES.workspace_mutate,
      remote_compute: parsed.remote_compute ?? DEFAULT_PERMISSION_POLICIES.remote_compute,
    };
  } catch {
    return { ...DEFAULT_PERMISSION_POLICIES };
  }
}

export function savePermissionPolicies(
  next: Partial<ToolPermissionPolicyMap>,
  storage?: StorageLike,
): ToolPermissionPolicyMap {
  const merged = { ...loadPermissionPolicies(storage), ...next };
  let s: StorageLike | null = storage ?? null;
  if (!s) {
    try {
      s = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      s = null;
    }
  }
  try {
    s?.setItem(LS_PERMISSIONS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}
