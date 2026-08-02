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

/**
 * Ollama structured outputs: the `response_format` body of a chat completion.
 *
 * The OpenAI-compatible layer maps this onto Ollama's native `format` grammar
 * (verified against ollama/server/openai.go, v0.30.11 — the bare `format`
 * field is dropped at /v1, `response_format` is honored). `strict: true`
 * requires `additionalProperties: false` at every level of `schema` and turns
 * a JSON-schema mismatch into a generation-time impossibility.
 */
export type ResponseFormat = {
 type: 'json_schema';
 json_schema: {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
 };
};

/** Construction options for a role's Complete. */
export type MakeCompleteOptions = {
 /**
  * When set, every call carries this response_format — the model physically
  * cannot emit a payload that violates the schema. Off by default so the
  * fake responder path and every existing caller are untouched (ticket 078).
  */
 responseFormat?: ResponseFormat;
 /**
  * Per-request wall-clock budget in milliseconds. Defaults to
  * DEFAULT_TIMEOUT_MS; a call still running when the budget elapses is
  * aborted, and the caller sees a `timed out after Ns` detail that names
  * the budget (ticket 086).
  */
 timeoutMs?: number;
 /**
  * Output-token bound, sent as `max_tokens` on every call. Defaults to
  * DEFAULT_MAX_TOKENS — the server-side cap on a degenerate loop, so a
  * runaway generation is bounded even when a client abort cannot reach
  * the server (ticket 086).
  */
 maxTokens?: number;
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
   // Emit `max_tokens`, the field both local backends read. pi-ai would
   // otherwise auto-detect `max_completion_tokens` for any non-OpenAI
   // baseUrl, and Ollama's OpenAI layer has NO such field — verified
   // against ollama/openai/openai.go at v0.30.11: ChatCompletionRequest
   // carries only `max_tokens`, mapped to num_predict. Without this
   // override the token bound below would be silently ignored (ticket 086).
   maxTokensField: 'max_tokens',
  },
 };
}

/**
 * Per-request wall-clock budget for every completion, in milliseconds.
 *
 * Justified against the measurements the ticket cites. T15/T16's drain
 * measured ~29s typical clerk calls; 078's constrained-harvest measurement
 * found honest grammar-constrained calls exceeding 120s (its first ratchet
 * run capped at 120s and read three `timed out after 120s` chunkErrors on
 * eval-003's longest turns); the embeddings path chose 120s per request.
 * 180s is ~6x the typical clerk call and 1.5x the embeddings budget, so it
 * covers honest slow calls with margin; an elicitor turn (3-9s on
 * bonsai-27b) is never close, and a foreground call that hangs three
 * minutes is already broken UX worth failing. The known exception is 007's
 * measured 370s cold-model first call, which now fails at the budget and
 * is retried warm — a paid warm-up, recoverable through the attempts-aware
 * backoff, not a stall. Tonight's 84-minute runaway is what this budget
 * exists to convert into a named `timed out after 180s` failure (ticket
 * 086).
 */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Output-token bound sent as `max_tokens` on every completion.
 *
 * Ollama maps it to num_predict (verified against ollama/openai/openai.go
 * at v0.30.11, lines 589-591); llama.cpp reads `max_tokens` natively. At
 * the measured ~28 tok/s decode rate, 16384 tokens is roughly ten minutes
 * of generation — well beyond the 180s client budget, so the bound never
 * truncates a call the client would let finish. It exists to cap SERVER
 * work when a client abort cannot reach the server: the ticket's runaway
 * ran 84 minutes against an established socket, and an unbounded runner
 * keeps generating into the void after the client gives up (ticket 086).
 */
const DEFAULT_MAX_TOKENS = 16384;

/** The failure detail for an elapsed budget — the 078 spelling, so a log
 * reader can tell `timed out after Ns` from a refused connection (034 —
 * two different diagnoses, two different correctives). */
function timeoutDetail(timeoutMs: number): string {
 return `timed out after ${timeoutMs / 1000}s`;
}

/**
 * Create a Complete for one role, backed by that role's local endpoint.
 * The environment is read here, so re-calling this picks up a reconfiguration.
 */
export function makeComplete(role: LlmRole = 'elicitor', options?: MakeCompleteOptions): Complete {
 const cfg = roleConfig(role);
 const model = buildModel(cfg);
 // Captured once at construction so the closure reads stable values.
 const responseFormat = options?.responseFormat;
 const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
 const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

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

  // One controller per call, and only the timer ever aborts it — so an
  // 'aborted' stopReason is always OUR elapsed budget, never a caller's
  // signal, and the diagnosis can name the budget with certainty.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
   apiKey: 'none', // local endpoint does not require auth
   ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
   signal: controller.signal,
   maxTokens,
   // pi-ai's onPayload hook runs after buildParams and before the fetch;
   // mutating the body here carries response_format to the endpoint through
   // the same completion path the plain calls use (ticket 078).
   ...(responseFormat !== undefined
    ? {
     onPayload: (payload: unknown): unknown => {
      (payload as Record<string, unknown>).response_format = responseFormat;
      return payload;
     },
    }
    : {}),
  };

  let response;
  try {
   response = await complete(model, context, options);
  } catch (err) {
   // The abort surfaced as a rejection, not as an 'aborted' stopReason.
   if (controller.signal.aborted) {
    throw roleFailure(cfg, timeoutDetail(timeoutMs));
   }
   // A refused connection reaches the caller naming its role.
   throw roleFailure(cfg, err instanceof Error ? err.message : String(err));
  } finally {
   clearTimeout(timer);
  }

  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
   // The budget elapsed: the abort is ours, and the detail names it so a
   // log reader can tell `timed out after 180s` from a refused connection
   // (034 — two different diagnoses, two different correctives).
   if (controller.signal.aborted) {
    throw roleFailure(cfg, timeoutDetail(timeoutMs));
   }
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
