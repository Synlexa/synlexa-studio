import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  addOrUpdateComputeNode,
  cancelComputeJob,
  downloadAndVerifyArtifact,
  getComputeSnapshot,
  loadComputeNodes,
  parsePairingUri,
  probeComputeNode,
  removeComputeNode,
  resetComputeStateForTesting,
  submitComputeJob,
  type StorageLike,
} from '../lib/computeBridge';
import { getCustomVaultSecret, initSecureVault, resetVaultForTesting } from '../lib/secureKeyVault';

function createMemStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

describe('External GPU Compute Bridge (RUO)', () => {
  it('parses Colab pairing URI, seals token in vault, and strips secret from storage', async () => {
    resetVaultForTesting();
    resetComputeStateForTesting();
    await initSecureVault();
    const storage = createMemStorage();

    const parsed = parsePairingUri('synlexa-node://https://demo-gpu.trycloudflare.com/#tok_secret_abc');
    expect(parsed.endpoint).toBe('https://demo-gpu.trycloudflare.com');
    expect(parsed.token).toBe('tok_secret_abc');
    expect(parsed.kind).toBe('colab');

    const node = await addOrUpdateComputeNode(
      { label: 'Colab T4', pairingOrEndpoint: 'synlexa-node://https://demo-gpu.trycloudflare.com#tok_secret_abc' },
      storage,
    );
    expect(getCustomVaultSecret(`compute-node:${node.id}`)).toBe('tok_secret_abc');

    // Token must NOT appear in persisted node JSON
    const rawSaved = storage.getItem('synlexa.studio.computeNodes.v1') ?? '';
    expect(rawSaved).not.toContain('tok_secret_abc');

    loadComputeNodes(storage);
    expect(getComputeSnapshot().nodes).toHaveLength(1);

    await removeComputeNode(node.id, storage);
    expect(getCustomVaultSecret(`compute-node:${node.id}`)).toBe('');
  });

  it('probes node, submits & cancels job, and verifies artifact SHA-256', async () => {
    resetVaultForTesting();
    resetComputeStateForTesting();
    await initSecureVault();
    const storage = createMemStorage();

    const node = await addOrUpdateComputeNode(
      { label: 'Local GPU', pairingOrEndpoint: 'http://127.0.0.1:4180#local-tok' },
      storage,
    );

    const artifactBody = 'REMARK VINA RESULT: -8.2 kcal/mol\n';
    const artifactSha = createHash('sha256').update(artifactBody).digest('hex');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/health')) {
        return new Response(JSON.stringify({ ok: true, service: 'synlexa-compute' }), { status: 200 });
      }
      if (url.endsWith('/v1/capabilities')) {
        expect((init?.headers as Record<string, string>)['X-Synlexa-Compute-Token']).toBe('local-tok');
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              hostname: 'colab-t4',
              os_name: 'Linux',
              arch: 'x86_64',
              python_version: '3.11.6',
              cpu_cores: 8,
              ram_mb: 16384,
              gpus: [{ index: 0, name: 'Tesla T4', backend: 'cuda', vram_mb: 15360, driver_version: '535' }],
              tools: [],
              workerVersion: '0.1.0',
              ruoNotice: 'RUO',
              supportedAdapters: ['vina_docking'],
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/v1/jobs')) {
        return new Response(
          JSON.stringify({
            ok: true,
            job: {
              job_id: 'job-123',
              tool_id: 'vina_docking',
              status: 'running',
              created_at_utc: '2026-11-16T12:00:00Z',
              started_at_utc: '2026-11-16T12:00:01Z',
              finished_at_utc: null,
              progress: 0.4,
              stage: 'docking',
              tool_version: 'vina-1.2.5',
              metrics: {},
              logs: [],
              artifacts: [],
              error_code: null,
              error_message: null,
              ruo_notice: 'RUO',
            },
          }),
          { status: 202 },
        );
      }
      if (url.endsWith('/v1/jobs/job-123/cancel')) {
        return new Response(
          JSON.stringify({
            ok: true,
            job: {
              job_id: 'job-123',
              tool_id: 'vina_docking',
              status: 'cancelled',
              created_at_utc: '2026-11-16T12:00:00Z',
              started_at_utc: '2026-11-16T12:00:01Z',
              finished_at_utc: '2026-11-16T12:00:02Z',
              progress: 0.4,
              stage: 'cancelled',
              tool_version: 'vina-1.2.5',
              metrics: {},
              logs: [],
              artifacts: [],
              error_code: 'ERR_CANCELLED',
              error_message: 'Cancelled',
              ruo_notice: 'RUO',
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/artifacts/pose.pdbqt')) {
        return new Response(artifactBody, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const probed = await probeComputeNode(node.id, fetchMock, storage);
    expect(probed.online).toBe(true);
    expect(probed.capabilities?.gpus[0].name).toBe('Tesla T4');

    const job = await submitComputeJob(node.id, 'vina_docking', { ligandSmiles: 'CCO' }, fetchMock);
    expect(job.job_id).toBe('job-123');

    const cancelled = await cancelComputeJob(node.id, job.job_id, fetchMock);
    expect(cancelled.status).toBe('cancelled');

    const artText = await downloadAndVerifyArtifact(
      node.id,
      job.job_id,
      {
        name: 'pose.pdbqt',
        format: 'pdbqt',
        mime_type: 'chemical/x-pdbqt',
        size_bytes: artifactBody.length,
        sha256: artifactSha,
        created_at_utc: '2026-11-16T12:00:02Z',
      },
      fetchMock,
    );
    expect(artText).toBe(artifactBody);

    await expect(
      downloadAndVerifyArtifact(
        node.id,
        job.job_id,
        {
          name: 'pose.pdbqt',
          format: 'pdbqt',
          mime_type: 'chemical/x-pdbqt',
          size_bytes: artifactBody.length,
          sha256: '0000000000000000',
          created_at_utc: '2026-11-16T12:00:02Z',
        },
        fetchMock,
      ),
    ).rejects.toThrow(/SHA-256 mismatch/);
  });
});
