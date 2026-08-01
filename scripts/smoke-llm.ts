/**
 * Smoke test: sends one short prompt to the local model via src/llm.ts
 * and prints the completion string.
 *
 * Usage: npx tsx scripts/smoke-llm.ts
 */
import { makeComplete } from '../src/llm.js';

const complete = makeComplete();

const result = await complete(
 'You are a concise assistant. Answer in one short sentence.',
 [{ role: 'user', text: 'What is the capital of France?', at: new Date().toISOString() }],
 { temperature: 0.7 },
);

console.log(result);

// Multi-turn: an assistant turn in history exercises pi-ai's content-block
// serialization — the path a single user turn never touches.
const followUp = await complete(
 'You are a concise assistant. Answer in one short sentence.',
 [
  { role: 'user', text: 'What is the capital of France?', at: new Date().toISOString() },
  { role: 'agent', text: result, at: new Date().toISOString() },
  { role: 'user', text: 'And its river?', at: new Date().toISOString() },
 ],
 { temperature: 0.7 },
);

console.log(followUp);
if (!followUp.trim()) throw new Error('multi-turn completion came back empty');
