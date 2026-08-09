/**
 * The /v2 core API's vocabulary — ticket 129, contract at
 * `docs/loop-core-api-spec.md` (ratified Q-92, ticket 120).
 *
 * Types only. Every union here is CLOSED on purpose: a persona that cannot
 * name an operation cannot perform it, which is what makes the say/act line
 * structural rather than a prompt promise —
 *
 *   `say` carries words that may become evidence.
 *   `act` carries data that never can.
 *
 * No string arriving through a `Verb` may reach a Snippet, a Piece or a claim
 * citation. The enums below are the enforcement: `act` takes ids, indices,
 * offsets and choice words, and the one place a sentence rides an act-shaped
 * request (`say {intent:'exclude'}`, `say {intent:'artifact'}`) is a `say`.
 *
 * Existing domain enums (Facet, Stance, GateChoice, HarvestDecision.action,
 * ImportDecision.action, Authorship, DatingRule) are reused verbatim from
 * `src/types.ts` and `src/import/contract.ts` — /v2 invents no new domain
 * vocabulary.
 */

import type { Authorship, DatingRule } from '../import/contract.js';
import type { Mode, Phase, QuestionForm, SoundingEnd } from '../types.js';

/**
 * The sitting phase — `SessionState.phase`'s union, imported rather than
 * re-spelled (the union used to be repeated here, where it could drift).
 */
export type { Phase };

/**
 * Every addressable context. Closed — there is no CRUD escape.
 *
 * Two kinds carry an OPTIONAL id where the spec writes a required one, and
 * both are minting doors rather than spec drift: `piece` without an id is the
 * `compose` verb (the spec's "re: {kind:'piece'} absent — mints the Piece"),
 * and `coach` without a slug is the `coach` verb, which declares the
 * Direction the slug is derived FROM. Every other verb on those kinds is
 * refused without the id — see `requireId` in `router.ts`.
 */
export type Re =
 | { kind: 'sitting'; id?: string }
 | { kind: 'unprompted' }
 | { kind: 'parked'; queueEntryId: string }
 | { kind: 'drm'; sittingId: string }
 | { kind: 'harvest'; sessionId: string }
 | { kind: 'import' }
 | { kind: 'import-piece'; hash: string }
 | { kind: 'piece'; id?: string }
 | { kind: 'wiki' }
 | { kind: 'claim'; id: string }
 | { kind: 'coach'; slug?: string }
 | { kind: 'quest'; id: string }
 | { kind: 'queue' }
 | { kind: 'waiting' };

export type ReKind = Re['kind'];

/** How a `say` is meant — the default is the one the context implies. */
export type SayIntent =
 | 'answer'
 | 'pulse'
 | 'unprompted'
 | 'restate'
 | 'correct'
 | 'return'
 | 'artifact'
 | 'exclude'
 | 'prose';

export type GateChoice = 'continue' | 'park' | 'another-day';

/** Every non-prose verb. Enums, ids and offsets only (the act half of the rule). */
export type Verb =
 // sitting
 | { v: 'skip' }
 | { v: 'defer'; need?: 'time' | 'energy' }
 | { v: 'end' }
 | { v: 'leave' }
 | { v: 'sounding'; accept: boolean }
 | { v: 'gate'; choice: GateChoice }
 // drm
 | { v: 'drm-start' }
 | { v: 'drm-episode'; name: string; startHour: number }
 | { v: 'drm-enumerate-done' }
 | { v: 'drm-gate'; choice: GateChoice }
 // harvest review (per proposal, by index; restate is a say)
 | { v: 'approve'; proposal: number }
 | { v: 'trim'; proposal: number; span: [number, number] }
 | { v: 'discard'; proposal: number }
 | { v: 'commit' }
 // wiki
 | { v: 'read'; surface?: string }
 | { v: 'attest' }
 | { v: 'challenge' }
 // piece
 // 'choose' and 'arrangements' died with pieces pass 2 (ruling 2026-08-09);
 // the `arrangement` param died with the ordering subsystem (redesign §9).
 | { v: 'reorder'; entries: string[] }
 | { v: 'gap'; gap: string; question?: string; after?: string }
 | { v: 'gap-accept'; gap: string; snippet: string; version: number }
 | { v: 'remove'; entry: string }
 | { v: 'set-down' }
 | { v: 'pick-up' }
 | { v: 'compose'; snippets: string[] }
 // import
 | { v: 'scan'; folder: string; region?: string }
 | { v: 'survey'; folder: string }
 | { v: 'declare-region'; root: string; dating: DatingRule; authorship: Authorship }
 | { v: 'import-approve'; cut: number }
 | { v: 'import-trim'; cut: number; span: [number, number] }
 | { v: 'import-discard'; cut: number }
 | { v: 'import-commit' }
 // coach
 | { v: 'coach'; name: string }
 | { v: 'uncoach' }
 | { v: 'decline-offer' }
 | { v: 'adopt'; optionId: string }
 | { v: 'decline-option'; optionId: string }
 | { v: 'retire' }
 | { v: 'coach-read' }; // 'decline-reach' died with the reach offer (ruling 2026-08-09).

export type VerbName = Verb['v'];

/** The `view` projections. Every one is side-effect-free (the ruled break). */
export type Scope =
 | 'queue'
 | 'wiki'
 | 'wiki-all'
 | 'snippets'
 | 'pieces'
 | 'piece'
 | 'piece-export'
 | 'harvest-queue'
 | 'harvest'
 | 'import-next'
 | 'import-survey'
 | 'coach-waiting'
 | 'coach'
 | 'cadence'
 // 'reach' and 'anniversary' scopes died with the zero-output offers (2026-08-09).
 | 'activity'
 | 'auth-status'
 | 'stt-status';

/**
 * `refused` is the canon-guard code — trim outside the proposal, commit with
 * undecided proposals, a region rule that cannot date anything. It is
 * DISTINCT from `bad-request` so a persona can tell "I broke the
 * constitution's rule" from "I sent malformed JSON". `unavailable` is
 * today's 503: a compose failure with state restored.
 */
export type ErrorCode =
 | 'bad-request'
 | 'unauthorized'
 | 'not-found'
 | 'gone'
 | 'conflict'
 | 'refused'
 | 'unavailable';

export type V2Error = { error: { code: ErrorCode; message: string } };

/**
 * The turn a living context answers with.
 *
 * `drm` is an addition to the spec's sketch, not a departure from it: the
 * spec declares the `drm-probe` and `drm-gate` kinds but names no carrier for
 * the episode counter, probe step and gate reading the old routes return, and
 * a headless persona cannot walk a reconstruction without them.
 *
 * Provenance stays OFF the wire, exactly as today — a client cannot tell a
 * bank draw from a composed question except via `juxtaposition`. The loop's
 * personas must not see selection internals, for the same reason the person
 * does not.
 */
export type TurnBody = {
 kind: 'probe' | 'saturated' | 'checkpoint' | 'descent-closed' | 'drm-probe' | 'drm-gate' | 'drm-closed';
 text?: string;
 questionForm?: QuestionForm;
 phase?: Phase;
 juxtaposition?: { snippetText: string; snippetDate: string };
 sounding?: { rung: number; of: number; checkpoint: boolean };
 soundingOffer?: { construct: string; allowance: number; sentence: string };
 endedBy?: SoundingEnd | string;
 soundingId?: string;
 pulsePrompt?: string;
 target?: string;
 source?: string;
 context?: string;
 drm?: { episode: number; of: number; step?: string; gate?: unknown };
};

/** The single response shape for `open`/`say`/`act` on living contexts. */
export type TurnEnvelope = {
 re: Re;
 rev: number;
 turn?: TurnBody;
 view?: unknown;
 /** Display sentences only — never machine-parsed. */
 notices?: string[];
};

export type OpenRequest = { re?: unknown; mode?: Mode };

export type SayRequest = {
 re?: unknown;
 text?: unknown;
 channel?: unknown;
 intent?: unknown;
 rev?: unknown;
 /**
  * The non-prose operands a `say` needs to land: the proposal index for a
  * restatement, the pointer and name beside an artifact sentence, the
  * arrangement a paragraph joins. Never harvestable — the `text` is the only
  * field that may become evidence.
  */
 meta?: Record<string, unknown>;
};

export type ActRequest = { re?: unknown; verb?: unknown; rev?: unknown };

/**
 * One internal dispatch against the app's own /api routes. The adapter never
 * reimplements a handler; it translates. `env` is the caller's Hono env,
 * forwarded whole so the internal request meets the same loopback gate the
 * outer one did.
 */
export type Dispatch = (path: string, init: RequestInit, env: unknown) => Promise<Response>;

export interface V2Deps {
 dispatch: Dispatch;
}
