import type { Model, Context } from '@mariozechner/pi-ai';
import { complete } from '@mariozechner/pi-ai';
import type { Complete, Turn } from './types.js';

const BASE_URL = process.env.ELICIT_LLM_BASE_URL ?? 'http://192.168.0.229:8088/v1';
const MODEL_ID = process.env.ELICIT_LLM_MODEL ?? 'bonsai-27b';

/**
 * Build a custom pi-ai Model targeting a local OpenAI-compatible endpoint.
 * llama.cpp serves the /v1/chat/completions API — standard openai-completions.
 */
function buildModel(): Model<'openai-completions'> {
 return {
  id: MODEL_ID,
  name: `${MODEL_ID} (local llama.cpp)`,
  api: 'openai-completions',
  provider: 'llama.cpp',
  baseUrl: BASE_URL,
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
 * Create a Complete function backed by the local pi-ai model.
 * Reads ELICIT_LLM_BASE_URL and ELICIT_LLM_MODEL from environment at call time
 * (so a single process can reconfigure by re-calling makeComplete).
 */
export function makeComplete(): Complete {
 const model = buildModel();

 return async (system: string, turns: Turn[], opts?: { temperature?: number }): Promise<string> => {
  // pi-ai's Context.messages is Message[] (UserMessage | AssistantMessage | ToolResultMessage),
  // but at runtime it only inspects role + content. The AssistantMessage extra fields (api,
  // provider, model, usage, stopReason) are output-only — only real assistant responses need them.
  const messages = turns.map((t) => {
   const now = Date.now();
   if (t.role === 'agent') {
    return { role: 'assistant' as const, content: t.text, timestamp: now };
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

  const response = await complete(model, context, options);

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
