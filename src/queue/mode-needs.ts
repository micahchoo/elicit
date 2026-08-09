/**
 * The Mode an unprompted session runs on: nothing declared but the inward
 * default target (Q-19). One declaration for the server sites that start
 * an unprompted sitting — the minute/energy ladder and the energy scale
 * that used to live here died with the declarations (canon §9 wave 1).
 *
 * Pure module: zero `node:` imports, so `web/main.ts` can bundle it
 * (precedent: `web/main.ts` already imports `src/queue/source-label.ts`,
 * which has no `node:` imports either). Type-only imports are fine.
 */

import type { Mode } from '../types.js';

export const UNPROMPTED_MODE: Mode = { target: 'self' };
