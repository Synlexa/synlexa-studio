import { getCustomVaultSecret, setCustomVaultSecret } from './secureKeyVault';
import { sha256HexUniversal } from './sha256';

export type ComputeNodeKind = 'local' | 'colab' | 'remote' | 'hpc';

export interface ComputeGpuInfo {
  index: number;
  name: string;
  backend: 'cuda' | 'metal' | 'rocm' | 'opencl';
  vram_mb: number | null;
  driver_version: string | null;
}

export interface ComputeToolInfo {
  id: string;
  name: string;
  category: string;
  license: string;
  commercial_safe: boolean;
  installed: boolean;
  version: string | null;
  install_hint: string;
  requires_gpu?: boolean;
}

export interface ComputeCapabilities {
  hostname: string;
  os_name: string;
  arch: string;
  python_version: string;
  cpu_cores: number;
  ram_mb: number | null;
  gpus: ComputeGpuInfo[];
  tools: ComputeToolInfo[];
  workerVersion: string;
  ruoNotice: string;
  supportedAdapters: string[];
}

export interface ComputeNodeProfile {
  id: string;
  label: string;
  kind: ComputeNodeKind;
  endpoint: string;
  createdAtUtc: string;
  lastCheckedUtc: string | null;
  online: boolean;
  lastError: string | null;
  capabilities: ComputeCapabilities | null;
}

export interface ComputeArtifact {
  name: string;
  format: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at_utc: string;
}

export interface ComputeJobRecord {
  job_id: string;
  tool_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at_utc: string;
  started_at_utc: string | null;
  finished_at_utc: string | null;
  progress: number;
  stage: string;
  tool_version: string | null;
  metrics: Record<string, unknown>;
  logs: string[];
  artifacts: ComputeArtifact[];
  error_code: string | null;
  error_message: string | null;
  ruo_notice: string;
  nodeId?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LS_NODES_KEY = 'synlexa.studio.computeNodes.v1';
const LS_ACTIVE_NODE_KEY = 'synlexa.studio.activeComputeNode.v1';
const VAULT_TOKEN_PREFIX = 'compute-node:';

let nodesState: ComputeNodeProfile[] = [];
let activeNodeIdState: string | null = null;
let jobsState: ComputeJobRecord[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeComputeState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getComputeSnapshot() {
  return {
    nodes: [...nodesState],
    activeNodeId: activeNodeIdState,
    activeNode: nodesState.find((n) => n.id === activeNodeIdState) ?? null,
    jobs: [...jobsState],
  };
}

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadComputeNodes(storage?: StorageLike): ComputeNodeProfile[] {
  const s = getStorage(storage);
  if (!s) return nodesState;
  try {
    const raw = s.getItem(LS_NODES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ComputeNodeProfile[];
      if (Array.isArray(parsed)) {
        nodesState = parsed.map((n) => ({ ...n, online: false }));
      }
    }
    const active = s.getItem(LS_ACTIVE_NODE_KEY);
    if (active) activeNodeIdState = active;
  } catch {
    /* ignore corrupt local profile */
  }
  emit();
  return [...nodesState];
}

function saveNodes(storage?: StorageLike) {
  const s = getStorage(storage);
  if (!s) return;
  try {
    s.setItem(LS_NODES_KEY, JSON.stringify(nodesState));
    if (activeNodeIdState) s.setItem(LS_ACTIVE_NODE_KEY, activeNodeIdState);
  } catch {
    /* ignore storage quota */
  }
}

export function inferNodeKind(endpoint: string): ComputeNodeKind {
  const lower = endpoint.toLowerCase();
  if (lower.includes('trycloudflare.com') || lower.includes('ngrok') || lower.includes('colab')) {
    return 'colab';
  }
  if (lower.includes('127.0.0.1') || lower.includes('localhost')) {
    return 'local';
  }
  return 'remote';
}

export function parsePairingUri(raw: string): { endpoint: string; token: string; kind: ComputeNodeKind } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Pairing URI or endpoint is empty.');

  let normalized = trimmed;
  if (normalized.startsWith('synlexa-node://')) {
    normalized = normalized.slice('synlexa-node://'.length);
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Endpoint must begin with synlexa-node://, http://, or https://');
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Malformed compute node URL.');
  }

  const token = parsed.hash ? parsed.hash.slice(1).trim() : '';
  parsed.hash = '';
  const endpoint = parsed.toString().replace(/\/+$/, '');

  return {
    endpoint,
    token,
    kind: inferNodeKind(endpoint),
  };
}

export async function addOrUpdateComputeNode(
  input: {
    label?: string;
    pairingOrEndpoint: string;
    token?: string;
    kind?: ComputeNodeKind;
  },
  storage?: StorageLike,
): Promise<ComputeNodeProfile> {
  const parsed = parsePairingUri(input.pairingOrEndpoint);
  const finalToken = (input.token ?? parsed.token).trim();
  const kind = input.kind ?? parsed.kind;

  const existing = nodesState.find((n) => n.endpoint === parsed.endpoint);
  const id = existing?.id ?? `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const defaultLabel =
    kind === 'colab'
      ? 'Google Colab GPU'
      : kind === 'local'
        ? 'Local Compute Daemon'
        : 'Remote GPU Node';

  const profile: ComputeNodeProfile = {
    id,
    label: input.label?.trim() || existing?.label || defaultLabel,
    kind,
    endpoint: parsed.endpoint,
    createdAtUtc: existing?.createdAtUtc ?? new Date().toISOString(),
    lastCheckedUtc: existing?.lastCheckedUtc ?? null,
    online: existing?.online ?? false,
    lastError: null,
    capabilities: existing?.capabilities ?? null,
  };

  if (finalToken) {
    await setCustomVaultSecret(`${VAULT_TOKEN_PREFIX}${id}`, finalToken);
  }

  nodesState = existing
    ? nodesState.map((n) => (n.id === id ? profile : n))
    : [profile, ...nodesState];
  activeNodeIdState = id;
  saveNodes(storage);
  emit();
  return profile;
}

export async function removeComputeNode(nodeId: string, storage?: StorageLike): Promise<void> {
  await setCustomVaultSecret(`${VAULT_TOKEN_PREFIX}${nodeId}`, '');
  nodesState = nodesState.filter((n) => n.id !== nodeId);
  if (activeNodeIdState === nodeId) {
    activeNodeIdState = nodesState[0]?.id ?? null;
  }
  saveNodes(storage);
  emit();
}

export function setActiveComputeNode(nodeId: string | null, storage?: StorageLike): void {
  activeNodeIdState = nodeId;
  saveNodes(storage);
  emit();
}

function getNodeToken(nodeId: string): string {
  return getCustomVaultSecret(`${VAULT_TOKEN_PREFIX}${nodeId}`);
}

export async function probeComputeNode(
  nodeId: string,
  fetchImpl: typeof fetch = fetch,
  storage?: StorageLike,
): Promise<ComputeNodeProfile> {
  const node = nodesState.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Unknown compute node: ${nodeId}`);
  const token = getNodeToken(nodeId);
  const now = new Date().toISOString();

  try {
    const healthRes = await fetchImpl(`${node.endpoint}/v1/health`);
    if (!healthRes.ok) {
      throw new Error(`Health check HTTP ${healthRes.status}`);
    }
    const capsRes = await fetchImpl(`${node.endpoint}/v1/capabilities`, {
      headers: token ? { 'X-Synlexa-Compute-Token': token } : {},
    });
    if (!capsRes.ok) {
      throw new Error(
        capsRes.status === 401
          ? 'Compute token rejected (401). Re-paste pairing string.'
          : `Capabilities check HTTP ${capsRes.status}`,
      );
    }
    const capsJson = (await capsRes.json()) as { ok: boolean; data?: ComputeCapabilities; error?: string };
    if (!capsJson.ok || !capsJson.data) {
      throw new Error(capsJson.error || 'Malformed capabilities payload.');
    }
    const updated: ComputeNodeProfile = {
      ...node,
      online: true,
      lastCheckedUtc: now,
      lastError: null,
      capabilities: capsJson.data,
    };
    nodesState = nodesState.map((n) => (n.id === nodeId ? updated : n));
    saveNodes(storage);
    emit();
    return updated;
  } catch (err) {
    const updated: ComputeNodeProfile = {
      ...node,
      online: false,
      lastCheckedUtc: now,
      lastError: err instanceof Error ? err.message : String(err),
    };
    nodesState = nodesState.map((n) => (n.id === nodeId ? updated : n));
    saveNodes(storage);
    emit();
    return updated;
  }
}

function upsertJob(job: ComputeJobRecord, nodeId: string) {
  const withNode = { ...job, nodeId };
  const idx = jobsState.findIndex((j) => j.job_id === withNode.job_id);
  if (idx >= 0) {
    jobsState = jobsState.map((j, i) => (i === idx ? withNode : j));
  } else {
    jobsState = [withNode, ...jobsState].slice(0, 50);
  }
  emit();
}

export async function submitComputeJob(
  nodeId: string,
  toolId: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<ComputeJobRecord> {
  const node = nodesState.find((n) => n.id === nodeId);
  if (!node) throw new Error('No compute node selected.');
  const token = getNodeToken(nodeId);
  if (!token) throw new Error('Missing compute node token in encrypted vault.');

  const res = await fetchImpl(`${node.endpoint}/v1/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Synlexa-Compute-Token': token,
    },
    body: JSON.stringify({ toolId, params }),
  });
  const data = (await res.json()) as { ok: boolean; job?: ComputeJobRecord; error?: string };
  if (!res.ok || !data.ok || !data.job) {
    throw new Error(data.error || `Job submission failed (HTTP ${res.status})`);
  }
  upsertJob(data.job, nodeId);
  return data.job;
}

export async function fetchComputeJob(
  nodeId: string,
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ComputeJobRecord> {
  const node = nodesState.find((n) => n.id === nodeId);
  if (!node) throw new Error('Unknown compute node.');
  const token = getNodeToken(nodeId);
  const res = await fetchImpl(`${node.endpoint}/v1/jobs/${encodeURIComponent(jobId)}`, {
    headers: token ? { 'X-Synlexa-Compute-Token': token } : {},
  });
  const data = (await res.json()) as { ok: boolean; job?: ComputeJobRecord; error?: string };
  if (!res.ok || !data.ok || !data.job) {
    throw new Error(data.error || `Job status failed (HTTP ${res.status})`);
  }
  upsertJob(data.job, nodeId);
  return data.job;
}

export async function cancelComputeJob(
  nodeId: string,
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ComputeJobRecord> {
  const node = nodesState.find((n) => n.id === nodeId);
  if (!node) throw new Error('Unknown compute node.');
  const token = getNodeToken(nodeId);
  const res = await fetchImpl(`${node.endpoint}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: token ? { 'X-Synlexa-Compute-Token': token } : {},
  });
  const data = (await res.json()) as { ok: boolean; job?: ComputeJobRecord; error?: string };
  if (!res.ok || !data.ok || !data.job) {
    throw new Error(data.error || `Cancel failed (HTTP ${res.status})`);
  }
  upsertJob(data.job, nodeId);
  return data.job;
}

export async function waitForComputeJob(
  nodeId: string,
  jobId: string,
  options?: {
    pollMs?: number;
    maxPolls?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    onUpdate?: (job: ComputeJobRecord) => void;
  },
): Promise<ComputeJobRecord> {
  const pollMs = options?.pollMs ?? 1200;
  const maxPolls = options?.maxPolls ?? 300;
  const fetchImpl = options?.fetchImpl ?? fetch;

  for (let i = 0; i < maxPolls; i++) {
    if (options?.signal?.aborted) {
      await cancelComputeJob(nodeId, jobId, fetchImpl).catch(() => {});
      throw new Error('Compute job aborted.');
    }
    const job = await fetchComputeJob(nodeId, jobId, fetchImpl);
    options?.onUpdate?.(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('Timed out waiting for compute job completion.');
}

export async function downloadAndVerifyArtifact(
  nodeId: string,
  jobId: string,
  artifact: ComputeArtifact,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const node = nodesState.find((n) => n.id === nodeId);
  if (!node) throw new Error('Unknown compute node.');
  const token = getNodeToken(nodeId);
  const res = await fetchImpl(
    `${node.endpoint}/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.name)}`,
    { headers: token ? { 'X-Synlexa-Compute-Token': token } : {} },
  );
  if (!res.ok) {
    throw new Error(`Artifact download failed (HTTP ${res.status})`);
  }
  const text = await res.text();
  const actualSha = await sha256HexUniversal(text);
  if (artifact.sha256 && actualSha !== artifact.sha256) {
    throw new Error(`Artifact SHA-256 mismatch for ${artifact.name}: expected ${artifact.sha256}, got ${actualSha}`);
  }
  return text;
}

export function resetComputeStateForTesting(): void {
  nodesState = [];
  activeNodeIdState = null;
  jobsState = [];
}
