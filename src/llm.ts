import type { Model, Context } from '@mariozechner/pi-ai';
import { complete } from '@mariozechner/pi-ai';
import type { Complete, Turn } from './types.js';

/**
 * Which job a model call belongs to (Q-48).
 *
 * `elicitor` runs in front of a person — probes, red-lights, live composition
 * — so latency is the binding constraint. `clerk` runs behind them — harvest
 * extraction, docket minting, consolidation — so instruction-following is.
 * The split is a default, not a coupling: either role points anywhere its env
 * vars say, and both endpoints stay local (ADR-0001).
 */
export type LlmRole = 'elicitor' | 'clerk';

/** Where a role sends its calls, and which model answers them. */
export type RoleConfig = {
  role: LlmRole;
  baseUrl: string;
  modelId: string;
};

const DEFAULTS: Record<LlmRole, { baseUrl: string; modelId: string }> = {
  // bonsai-27b on llama.cpp: 3-9s turns, and it collapses on long structured
  // payloads — which the foreground never asks it for.
  elicitor: { baseUrl: 'http://192.168.0.229:8088/v1', modelId: 'bonsai-27b' },
  // qwen3.6:35b on Ollama: clean JSON first try, far slower per call.
  clerk: { baseUrl: 'http://192.168.0.229:11434/v1', modelId: 'qwen3.6:35b' },
};

const ENV_KEYS: Record<LlmRole, { baseUrl: string; modelId: string }> = {
  elicitor: { baseUrl: 'ELICIT_LLM_BASE_URL', modelId: 'ELICIT_LLM_MODEL' },
  clerk: { baseUrl: 'ELICIT_CLERK_BASE_URL', modelId: 'ELICIT_CLERK_MODEL' },
};

/** What a role will actually call right now. Read from the environment on every call. */
export function roleConfig(role: LlmRole): RoleConfig {
  const keys = ENV_KEYS[role];
  return {
    role,
    baseUrl: process.env[keys.baseUrl] ?? DEFAULTS[role].baseUrl,
    modelId: process.env[keys.modelId] ?? DEFAULTS[role].modelId,
  };
}

/** One line naming a role and the endpoint behind it, for banners and errors. */
export function describeRole(cfg: RoleConfig): string {
  return `${cfg.role}: ${cfg.modelId} @ ${cfg.baseUrl}`;
}

/**
 * Report a dead or erroring endpoint by role, and fail.
 *
 * The other role's model is never tried. A silent swap would produce an
 * artifact stamped with a model that did not write it, and a wrong stamp is
 * worse than a missing artifact — Q-34 only holds if the record is literal.
 */
function roleFailure(cfg: RoleConfig, detail: string): Error {
  const message = `${cfg.role} model call failed — ${cfg.modelId} at ${cfg.baseUrl}: ${detail}`;
  console.error(message);
  return new Error(message);
}

/**
 * Build a custom pi-ai Model targeting a local OpenAI-compatible endpoint.
 * llama.cpp and Ollama both serve /v1/chat/completions — standard openai-completions.
 */
function buildModel(cfg: RoleConfig): Model<'openai-completions'> {
  return {
    id: cfg.modelId,
    name: `${cfg.modelId} (local, ${cfg.role} role)`,
    api: 'openai-completions',
    provider: 'llama.cpp',
    baseUrl: cfg.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16384,
    maxTokens: 32000,
    compat: {
      // llama.cpp does not accept the 'developer' role or reasoning_effort
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

/**
 * Create a Complete for one role, backed by that role's local endpoint.
 * The environment is read here, so re-calling this picks up a reconfiguration.
 */
export function makeComplete(role: LlmRole = 'elicitor'): Complete {
  const cfg = roleConfig(role);
  const model = buildModel(cfg);

  return async (system: string, turns: Turn[], opts?: { temperature?: number }): Promise<string> => {
    // pi-ai serializes assistant content by filtering CONTENT BLOCKS — a plain string
    // throws inside its provider and surfaces as stopReason 'error' with empty text.
    // User content may be a string; assistant content must be [{type:'text', text}].
    const messages = turns.map((t) => {
      const now = Date.now();
      if (t.role === 'agent') {
        return {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: t.text }],
          timestamp: now,
        };
      }
      return { role: 'user' as const, content: t.text, timestamp: now };
    });

    const context = {
      systemPrompt: system,
      messages,
    } as Context;

    const options = {
      apiKey: 'none', // local endpoint does not require auth
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    let response;
    try {
      response = await complete(model, context, options);
    } catch (err) {
      // A refused connection or a timeout reaches the caller naming its role.
      throw roleFailure(cfg, err instanceof Error ? err.message : String(err));
    }

    if (response.stopReason === 'error') {
      const detail = (response as { errorMessage?: string }).errorMessage ?? 'no detail';
      throw roleFailure(cfg, detail);
    }

    // Collect text content blocks.
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }

    return parts.join('');
  };
}
