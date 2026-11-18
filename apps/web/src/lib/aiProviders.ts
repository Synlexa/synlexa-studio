/**
 * Multi-provider AI assistant (bring-your-own-key + Synlexa Cloud).
 *
 * Security & provenance rules:
 *  - BYOK API keys (Anthropic, Gemini, OpenAI/Codex) are stored exclusively in
 *    the local encrypted `state.vscdb` vault (never plain-text JSON or localStorage)
 *    and sent directly from the client to the selected provider's API.
 *  - "Synlexa Cloud" routes requests through synlexa.com using the signed-in
 *    account bearer token.
 *  - All tool calls route through the in-app MCP server so deterministic kernels
 *    and verified public APIs own every number and citation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { executeCopilotCommand } from './copilotEngine';
import {
  beginRoundPlanningStep,
  buildWorkspaceSummaryText,
  DEFAULT_GEMINI_MODEL,
  emitStepProgress,
  executeAgentToolWithTrace,
  GEMINI_MODELS,
  getActiveToolDeclarations,
  LS_MODEL_KEY as LS_GEMINI_MODEL,
  pushRoundReasoningSteps,
  resolveRoundPlanningStep,
  runGeminiAgentTurn,
  STUDIO_TOOL_DECLARATIONS,
  SYSTEM_INSTRUCTION,
  type AgentChatMessage,
  type AgentStepTrace,
  type ExecutedToolRecord,
  type GeminiFunctionDeclaration,
  type GeminiModelId,
  type GeminiToolName,
  type RunGeminiTurnOptions,
} from './geminiAgent';
import { RUO_DISCLAIMER } from './reportGenerator';
import { getVaultSecret, setVaultSecret } from './secureKeyVault';
import { recordUsage } from './usageTracker';
import { loadStudioAccessToken, STUDIO_ASSISTANT_ENDPOINT } from './studioAuth';
import { getFreshStudioAccessToken, withStudioTokenRetry } from './studioTokens';

export type AiProviderId = 'synlexa' | 'anthropic' | 'gemini' | 'openai';

/** Display order in pickers. */
export const AI_PROVIDER_ORDER: AiProviderId[] = ['synlexa', 'anthropic', 'gemini', 'openai'];

export const AI_PROVIDERS: Record<
  AiProviderId,
  {
    label: string;
    keyHint: string;
    keyUrl: string;
    models: { id: string; label: string; note: string }[];
  }
> = {
  synlexa: {
    label: 'Synlexa Cloud',
    keyHint: '',
    keyUrl: 'https://synlexa.com',
    models: GEMINI_MODELS.map(({ id, label, note }) => ({ id, label, note })),
  },
  anthropic: {
    label: 'Anthropic Claude',
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable · deep multi-step analysis' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced speed and capability' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest · lowest cost' },
    ],
  },
  gemini: {
    label: 'Google Gemini',
    keyHint: 'AIza… or AQ.…',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: GEMINI_MODELS.map(({ id, label, note }) => ({ id, label, note })),
  },
  openai: {
    label: 'OpenAI / Codex',
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', note: 'Strong reasoning & MCP tool orchestration' },
      { id: 'o4-mini', label: 'o4-mini', note: 'Fast STEM & scientific reasoning' },
      { id: 'codex-mini-latest', label: 'Codex Mini', note: 'Low-latency agentic workflow execution' },
    ],
  },
};

export interface AiProviderConfig {
  /** BYOK key (loaded from state.vscdb), or for Synlexa Cloud the signed-in account's bearer token. */
  apiKey: string;
  model: string;
}

export type AiRoutingPreference = 'byok-first' | 'manual';

export interface AiConfig {
  provider: AiProviderId;
  routingPreference?: AiRoutingPreference;
  enableWebSearch?: boolean;
  synlexa: AiProviderConfig;
  gemini: AiProviderConfig;
  anthropic: AiProviderConfig;
  openai?: AiProviderConfig;
}

const LS_PROVIDER = 'synlexa.studio.ai.provider';
const LS_ROUTING_PREF = 'synlexa.studio.ai.routingPreference';
const LS_WEB_SEARCH = 'synlexa.studio.ai.webSearch';
const LS_ANTHROPIC_MODEL = 'synlexa.studio.anthropic.model';
const LS_OPENAI_MODEL = 'synlexa.studio.openai.model';
const LS_CLOUD_MODEL = 'synlexa.studio.cloud.model';

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function envGeminiKey(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY;
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

export function resolveActiveAiRoute(config: AiConfig): {
  provider: AiProviderId;
  isByok: boolean;
  hasByok: boolean;
  hasCloudToken: boolean;
  overriddenFromCloud: boolean;
} {
  const byokOrder: Array<'anthropic' | 'gemini' | 'openai'> = ['anthropic', 'gemini', 'openai'];
  const configuredByok = byokOrder.filter((id) => Boolean((config[id]?.apiKey ?? '').trim()));
  const hasByok = configuredByok.length > 0;
  const hasCloudToken = Boolean((config.synlexa?.apiKey ?? '').trim());
  const pref: AiRoutingPreference = config.routingPreference ?? 'byok-first';

  if (config.provider !== 'synlexa' && (config[config.provider]?.apiKey ?? '').trim()) {
    return {
      provider: config.provider,
      isByok: true,
      hasByok,
      hasCloudToken,
      overriddenFromCloud: false,
    };
  }

  if (pref === 'byok-first' && hasByok) {
    return {
      provider: configuredByok[0],
      isByok: true,
      hasByok,
      hasCloudToken,
      overriddenFromCloud: config.provider === 'synlexa',
    };
  }

  return {
    provider: config.provider,
    isByok: config.provider !== 'synlexa' && Boolean((config[config.provider]?.apiKey ?? '').trim()),
    hasByok,
    hasCloudToken,
    overriddenFromCloud: false,
  };
}

export function loadAiConfig(): AiConfig {
  const s = ls();
  const stored = s?.getItem(LS_PROVIDER);
  const storedPref = s?.getItem(LS_ROUTING_PREF);
  const routingPreference: AiRoutingPreference = storedPref === 'manual' ? 'manual' : 'byok-first';
  const storedProvider = AI_PROVIDER_ORDER.find((p) => p === stored) ?? null;
  const enableWebSearch = s?.getItem(LS_WEB_SEARCH) !== 'false';

  const storedGemini = s?.getItem(LS_GEMINI_MODEL)?.trim() ?? '';
  const gemini: AiProviderConfig = {
    apiKey: getVaultSecret('gemini') || envGeminiKey(),
    model: storedGemini && !/^gemini-[12]\./.test(storedGemini) ? storedGemini : DEFAULT_GEMINI_MODEL,
  };
  const anthropic: AiProviderConfig = {
    apiKey: getVaultSecret('anthropic'),
    model: s?.getItem(LS_ANTHROPIC_MODEL) || AI_PROVIDERS.anthropic.models[0].id,
  };
  const openai: AiProviderConfig = {
    apiKey: getVaultSecret('openai'),
    model: s?.getItem(LS_OPENAI_MODEL) || AI_PROVIDERS.openai.models[0].id,
  };
  const cloudModel = s?.getItem(LS_CLOUD_MODEL);
  const synlexa: AiProviderConfig = {
    apiKey: loadStudioAccessToken() ?? '',
    model: AI_PROVIDERS.synlexa.models.some((m) => m.id === cloudModel) ? (cloudModel as string) : DEFAULT_GEMINI_MODEL,
  };

  const initialProvider: AiProviderId =
    storedProvider ??
    (anthropic.apiKey
      ? 'anthropic'
      : gemini.apiKey
        ? 'gemini'
        : openai.apiKey
          ? 'openai'
          : 'synlexa');

  const draft: AiConfig = {
    provider: initialProvider,
    routingPreference,
    enableWebSearch,
    synlexa,
    gemini,
    anthropic,
    openai,
  };
  const route = resolveActiveAiRoute(draft);
  return { ...draft, provider: route.provider };
}

export function saveAiConfig(update: {
  provider?: AiProviderId;
  routingPreference?: AiRoutingPreference;
  enableWebSearch?: boolean;
  synlexa?: { model?: string };
  gemini?: Partial<AiProviderConfig>;
  anthropic?: Partial<AiProviderConfig>;
  openai?: Partial<AiProviderConfig>;
}): AiConfig {
  const s = ls();
  if (s) {
    if (update.routingPreference) s.setItem(LS_ROUTING_PREF, update.routingPreference);
    if (update.provider) {
      s.setItem(LS_PROVIDER, update.provider);
    } else if (update.anthropic?.apiKey?.trim()) {
      s.setItem(LS_PROVIDER, 'anthropic');
    } else if (update.gemini?.apiKey?.trim()) {
      s.setItem(LS_PROVIDER, 'gemini');
    } else if (update.openai?.apiKey?.trim()) {
      s.setItem(LS_PROVIDER, 'openai');
    }
    if (update.enableWebSearch !== undefined) s.setItem(LS_WEB_SEARCH, update.enableWebSearch ? 'true' : 'false');
    const setOrRemove = (k: string, v: string | undefined) => {
      if (v === undefined) return;
      const t = v.trim();
      if (t) s.setItem(k, t);
      else s.removeItem(k);
    };
    setOrRemove(LS_GEMINI_MODEL, update.gemini?.model);
    setOrRemove(LS_ANTHROPIC_MODEL, update.anthropic?.model);
    setOrRemove(LS_OPENAI_MODEL, update.openai?.model);
    setOrRemove(LS_CLOUD_MODEL, update.synlexa?.model);
  }
  if (update.gemini?.apiKey !== undefined) void setVaultSecret('gemini', update.gemini.apiKey);
  if (update.anthropic?.apiKey !== undefined) void setVaultSecret('anthropic', update.anthropic.apiKey);
  if (update.openai?.apiKey !== undefined) void setVaultSecret('openai', update.openai.apiKey);
  return loadAiConfig();
}

export function activeProviderReady(cfg: AiConfig): boolean {
  return Boolean(cfg[cfg.provider]?.apiKey);
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return '••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

/** Gemini OBJECT/STRING schema -> JSON Schema for Anthropic & OpenAI tools. */
function toJsonSchema(decl: GeminiFunctionDeclaration): Anthropic.Tool['input_schema'] {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(decl.parameters.properties)) {
    const prop: Record<string, unknown> = { type: v.type.toLowerCase(), description: v.description };
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

export const ANTHROPIC_TOOLS: Anthropic.Tool[] = STUDIO_TOOL_DECLARATIONS.map((d) => ({
  name: d.name,
  description: d.description,
  input_schema: toJsonSchema(d),
}));

function buildAnthropicTools(enableWebSearch: boolean): Anthropic.Tool[] {
  return getActiveToolDeclarations(enableWebSearch).map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: toJsonSchema(d),
  }));
}

function buildOpenAiTools(enableWebSearch: boolean) {
  return getActiveToolDeclarations(enableWebSearch).map((d) => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: toJsonSchema(d),
    },
  }));
}

type RunOpts = Omit<RunGeminiTurnOptions, 'apiKey' | 'model'>;

function localFallback(opts: RunOpts, id: string, now: string, errorNote?: string): AgentChatMessage {
  const res = executeCopilotCommand(opts.prompt, opts.workspace);
  if (opts.onFallbackAction) for (const act of res.actions) opts.onFallbackAction(act);
  const executedTools: ExecutedToolRecord[] = res.reply.actionTaken
    ? [{ name: res.reply.command ?? 'copilot', args: {}, ok: true, summary: res.reply.actionTaken, result: null, permissionStatus: 'auto' }]
    : [];
  const stepTrace: AgentStepTrace[] = executedTools.map((t, i) => ({
    round: i + 1,
    phase: 'tool',
    title: `${t.name} · ok`,
    detail: t.summary,
    toolName: String(t.name),
    ok: true,
  }));
  return {
    id,
    role: 'assistant',
    mode: 'local-deterministic-fallback',
    model: 'deterministic-copilot',
    providerLabel: 'Local Deterministic Copilot',
    text: `${errorNote ? `AI provider unavailable (${errorNote}). Answered with the built-in deterministic assistant.\n\n` : ''}${res.reply.text}`,
    citations: res.reply.citations,
    thinkingTrace: res.reply.actionTaken ? [`Matched local deterministic command: ${res.reply.actionTaken}`] : [],
    stepTrace,
    executedTools,
    timestampUtc: now,
    error: errorNote,
  };
}

function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'invalid Anthropic API key';
  if (err instanceof Anthropic.PermissionDeniedError) return 'this key cannot use the selected model';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited — try again shortly';
  if (err instanceof Anthropic.BadRequestError) return `request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'network error reaching api.anthropic.com';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}`.trim();
  return err instanceof Error ? err.message : String(err);
}

async function runAnthropicTurn(opts: RunOpts & { apiKey: string; model: string }): Promise<AgentChatMessage> {
  const now = new Date().toISOString();
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
  });

  const messages: Anthropic.MessageParam[] = [];
  for (const m of opts.history.slice(-8)) {
    if (!m.text.trim()) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (messages.length === 0 && role === 'assistant') continue;
    messages.push({ role, content: m.text });
  }
  messages.push({
    role: 'user',
    content: `[LIVE WORKSPACE STATE]\n${buildWorkspaceSummaryText(opts.workspace)}\n\n[USER REQUEST]\n${opts.prompt}`,
  });

  const executedTools: ExecutedToolRecord[] = [];
  const stepTrace: AgentStepTrace[] = [];
  const thinkingTrace: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const maxRounds = Math.max(1, opts.maxToolRounds ?? 10);
  const supportsFallback = opts.model === 'claude-opus-5-5' || opts.model === 'claude-sonnet-5-5';
  const tools = buildAnthropicTools(opts.enableWebSearch !== false);
  const turnStarted = Date.now();
  let useThinking = true;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const { step: planningStep, startedAtMs } = beginRoundPlanningStep(
        stepTrace,
        round + 1,
        'Anthropic BYOK',
        opts.onProgress,
      );

      const callRound = async (withThinking: boolean) =>
        client.beta.messages.create({
          model: opts.model,
          max_tokens: 16000,
          system: SYSTEM_INSTRUCTION,
          tools,
          messages,
          ...(withThinking ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
          ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });

      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await callRound(useThinking);
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && useThinking && /thinking/i.test(err.message)) {
          useThinking = false;
          response = await callRound(false);
        } else {
          resolveRoundPlanningStep(stepTrace, planningStep);
          throw err;
        }
      }
      const roundDurationMs = Math.max(1, Date.now() - startedAtMs);
      resolveRoundPlanningStep(stepTrace, planningStep);

      usage.inputTokens += response.usage.input_tokens ?? 0;
      usage.outputTokens += response.usage.output_tokens ?? 0;

      if (response.stop_reason === 'refusal') {
        return {
          id,
          role: 'assistant',
          mode: 'anthropic-api',
          model: response.model,
          providerLabel: `Anthropic BYOK (${response.model})`,
          text: 'The model declined this request. Try rephrasing it as a research-use computational question.',
          thinkingTrace,
          stepTrace,
          executedTools,
          timestampUtc: now,
          durationMs: Math.max(1, Date.now() - turnStarted),
          usage,
        };
      }

      const thinkingBlocks = response.content
        .filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === 'thinking' && typeof b.thinking === 'string')
        .map((b) => b.thinking.trim())
        .filter(Boolean);

      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      pushRoundReasoningSteps({
        stepTrace,
        thinkingTrace,
        round: round + 1,
        thoughts: thinkingBlocks,
        preToolRationale: response.stop_reason === 'tool_use' && toolUses.length > 0 ? text : undefined,
        roundDurationMs,
        thoughtTitle: 'Claude reasoning',
      });

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content as Anthropic.MessageParam['content'] });
          continue;
        }
        emitStepProgress(opts.onProgress, stepTrace);
        const raw = text || 'Done. Check the workspace tabs for updated results.';
        const hasRuo = /research[- ]use[- ]only|\(ruo\)/i.test(raw);
        return {
          id,
          role: 'assistant',
          mode: 'anthropic-api',
          model: response.model,
          providerLabel: `Anthropic BYOK (${response.model})`,
          text: hasRuo ? raw : `${raw}\n\n_${RUO_DISCLAIMER}_`,
          thinkingTrace,
          stepTrace,
          executedTools,
          citations: opts.workspace.comparison ? [`resultId:${opts.workspace.comparison.resultId}`] : [],
          timestampUtc: now,
          durationMs: Math.max(1, Date.now() - turnStarted),
          usage,
        };
      }

      emitStepProgress(opts.onProgress, stepTrace);

      messages.push({ role: 'assistant', content: response.content as Anthropic.MessageParam['content'] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const args = (tu.input && typeof tu.input === 'object' ? tu.input : {}) as Record<string, unknown>;
        const outcome = await executeAgentToolWithTrace(
          {
            round: round + 1,
            executeTool: opts.executeTool,
            requestToolPermission: opts.requestToolPermission,
            sessionApprovedCategories: opts.sessionApprovedCategories,
            permissionPolicies: opts.permissionPolicies,
            onProgress: opts.onProgress,
            stepTrace,
            executedTools,
          },
          tu.name as GeminiToolName,
          args,
        );
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ summary: outcome.summary, data: outcome.data }).slice(0, 60_000),
          is_error: !outcome.ok,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    return {
      id,
      role: 'assistant',
      mode: 'anthropic-api',
      model: opts.model,
      providerLabel: `Anthropic BYOK (${opts.model})`,
      text: `Ran ${executedTools.length} tool step(s). ${RUO_DISCLAIMER}`,
      thinkingTrace,
      stepTrace,
      executedTools,
      timestampUtc: now,
      durationMs: Math.max(1, Date.now() - turnStarted),
      usage,
    };
  } catch (err) {
    const msg = describeAnthropicError(err);
    recordUsage({ provider: 'anthropic', model: opts.model, ...usage, error: true });
    return localFallback(opts, id, now, msg);
  }
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function runOpenAiTurn(opts: RunOpts & { apiKey: string; model: string }): Promise<AgentChatMessage> {
  const now = new Date().toISOString();
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return localFallback(opts, id, now, 'fetch unavailable');

  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  for (const m of opts.history.slice(-8)) {
    if (!m.text.trim()) continue;
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
  }
  messages.push({
    role: 'user',
    content: `[LIVE WORKSPACE STATE]\n${buildWorkspaceSummaryText(opts.workspace)}\n\n[USER REQUEST]\n${opts.prompt}`,
  });

  const executedTools: ExecutedToolRecord[] = [];
  const stepTrace: AgentStepTrace[] = [];
  const thinkingTrace: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const maxRounds = Math.max(1, opts.maxToolRounds ?? 10);
  const tools = buildOpenAiTools(opts.enableWebSearch !== false);
  const turnStarted = Date.now();
  const supportsTemp = !/^(o\d|codex)/i.test(opts.model);

  try {
    for (let round = 0; round < maxRounds; round++) {
      const { step: planningStep, startedAtMs } = beginRoundPlanningStep(
        stepTrace,
        round + 1,
        'OpenAI BYOK',
        opts.onProgress,
      );

      const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          tools,
          ...(supportsTemp ? { temperature: 0.2 } : {}),
        }),
      });
      const payload = ((await res.json().catch(() => ({}))) ?? {}) as OpenAiChatResponse;
      usage.inputTokens += payload.usage?.prompt_tokens ?? 0;
      usage.outputTokens += payload.usage?.completion_tokens ?? 0;
      if (!res.ok || payload.error) {
        resolveRoundPlanningStep(stepTrace, planningStep);
        const msg = payload.error?.message ?? `OpenAI HTTP ${res.status}`;
        recordUsage({ provider: 'openai', model: opts.model, ...usage, error: true });
        return localFallback(opts, id, now, msg);
      }

      const roundDurationMs = Math.max(1, Date.now() - startedAtMs);
      resolveRoundPlanningStep(stepTrace, planningStep);

      const choice = payload.choices?.[0]?.message;
      const reasoning =
        choice?.reasoning_content?.trim() ||
        (choice as { reasoning?: string } | undefined)?.reasoning?.trim();
      const toolCalls = choice?.tool_calls ?? [];

      pushRoundReasoningSteps({
        stepTrace,
        thinkingTrace,
        round: round + 1,
        thoughts: reasoning ? [reasoning] : [],
        preToolRationale: toolCalls.length > 0 ? choice?.content?.trim() : undefined,
        roundDurationMs,
        thoughtTitle: 'Reasoning',
      });

      if (toolCalls.length === 0) {
        emitStepProgress(opts.onProgress, stepTrace);
        const raw = (choice?.content ?? '').trim() || 'Completed requested analysis.';
        const hasRuo = /research[- ]use[- ]only|\(ruo\)/i.test(raw);
        return {
          id,
          role: 'assistant',
          mode: 'openai-api',
          model: payload.model ?? opts.model,
          providerLabel: `OpenAI BYOK (${payload.model ?? opts.model})`,
          text: hasRuo ? raw : `${raw}\n\n_${RUO_DISCLAIMER}_`,
          thinkingTrace,
          stepTrace,
          executedTools,
          citations: opts.workspace.comparison ? [`resultId:${opts.workspace.comparison.resultId}`] : [],
          timestampUtc: now,
          durationMs: Math.max(1, Date.now() - turnStarted),
          usage,
        };
      }

      emitStepProgress(opts.onProgress, stepTrace);

      messages.push({
        role: 'assistant',
        content: choice?.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const outcome = await executeAgentToolWithTrace(
          {
            round: round + 1,
            executeTool: opts.executeTool,
            requestToolPermission: opts.requestToolPermission,
            sessionApprovedCategories: opts.sessionApprovedCategories,
            permissionPolicies: opts.permissionPolicies,
            onProgress: opts.onProgress,
            stepTrace,
            executedTools,
          },
          tc.function.name as GeminiToolName,
          args,
        );
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ summary: outcome.summary, data: outcome.data }).slice(0, 60_000),
        });
      }
    }

    return {
      id,
      role: 'assistant',
      mode: 'openai-api',
      model: opts.model,
      providerLabel: `OpenAI BYOK (${opts.model})`,
      text: `Ran ${executedTools.length} tool step(s). ${RUO_DISCLAIMER}`,
      thinkingTrace,
      stepTrace,
      executedTools,
      timestampUtc: now,
      durationMs: Math.max(1, Date.now() - turnStarted),
      usage,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordUsage({ provider: 'openai', model: opts.model, ...usage, error: true });
    return localFallback(opts, id, now, msg);
  }
}

/** Runs one assistant turn with the configured provider, recording usage locally. */
export async function runAssistantTurn(opts: RunOpts & { config: AiConfig }): Promise<AgentChatMessage> {
  const { config } = opts;
  const route = resolveActiveAiRoute(config);
  const activeProvider = route.provider;
  const p = config[activeProvider] ?? { apiKey: '', model: '' };
  const enableWebSearch = opts.enableWebSearch ?? config.enableWebSearch ?? true;
  if (!p.apiKey) {
    const now = new Date().toISOString();
    const reply = localFallback(opts, `agent-${Date.now()}`, now);
    recordUsage({ provider: 'local', model: 'deterministic-copilot', toolCalls: reply.executedTools?.length ?? 0 });
    return reply;
  }
  let reply: AgentChatMessage;
  if (activeProvider === 'anthropic') {
    reply = await runAnthropicTurn({ ...opts, enableWebSearch, apiKey: p.apiKey, model: p.model });
  } else if (activeProvider === 'openai') {
    reply = await runOpenAiTurn({ ...opts, enableWebSearch, apiKey: p.apiKey, model: p.model });
  } else if (activeProvider === 'synlexa') {
    // The access token lasts an hour: refresh it first when it is about to
    // expire, and once more if the server still answers 401.
    const fetchFn = opts.fetchImpl ?? globalThis.fetch;
    const token = (await getFreshStudioAccessToken({ fetchImpl: fetchFn })) ?? p.apiKey;
    reply = await runGeminiAgentTurn({
      ...opts,
      enableWebSearch,
      model: p.model as GeminiModelId,
      fetchImpl: withStudioTokenRetry(fetchFn),
      transport: { endpoint: STUDIO_ASSISTANT_ENDPOINT, headers: { Authorization: `Bearer ${token}` } },
    });
  } else {
    reply = await runGeminiAgentTurn({
      ...opts,
      enableWebSearch,
      apiKey: p.apiKey,
      model: p.model as GeminiModelId,
    });
  }
  if (reply.mode !== 'local-deterministic-fallback') {
    recordUsage({
      provider: activeProvider,
      model: reply.model ?? p.model,
      inputTokens: reply.usage?.inputTokens,
      outputTokens: reply.usage?.outputTokens,
      toolCalls: reply.executedTools?.length ?? 0,
    });
  } else if (activeProvider !== 'anthropic' && activeProvider !== 'openai') {
    recordUsage({ provider: activeProvider, model: p.model, error: true });
  }
  return reply;
}
