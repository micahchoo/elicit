import type { Complete } from '../src/types.js';

/**
 * Scripted fake Complete factory.
 * Returns a Complete function that dequeues responses in order.
 * Throws if called more times than responses were queued.
 */
export function makeScriptedComplete(responses: string[]): Complete {
 let i = 0;
 return async (
  _system: string,
  _turns: Parameters<Complete>[1],
  _opts?: { temperature?: number },
 ) => {
  if (i >= responses.length) {
   throw new Error(
    `ScriptedComplete exhausted after ${responses.length} response(s)`,
   );
  }
  if (process.env.SCRIPT_DEBUG) {
   const sys = _system.slice(0, 40).replace(/\n/g, ' ');
   console.error(`[script ${i}] sys="${sys}" -> ${responses[i]!.slice(0, 60)}`);
  }
  return responses[i++]!;
 };
}
