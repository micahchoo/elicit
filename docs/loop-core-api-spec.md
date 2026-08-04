# Core API spec — the four operations

Ratified 2026-08-04 (Q-92, ticket 120). The greenfield surface for
Elicit: four operations, mounted at `/v2` on the existing server. Old
routes stay untouched; eval personas speak ONLY this surface; SPA
migration remains fog. Verified for headless-completeness against the
full route + affordance inventory of src/server.ts (70 routes) and
web/*.ts (2026-08-04 census).

## The one rule that draws the say/act line

**`say` carries words that may become evidence. `act` carries data
that never can.**

The server harvests Snippets ONLY from `say` payloads. No string
arriving through `act` — an episode name, a folder path, an exclusion
reason, a gap question — can ever reach a Snippet, a Piece, or a
claim citation. This makes Sole Authorship (Q-1) and the
agent-prose-never-evidence boundary structural at the API layer, not
a prompt promise.

## The four operations

All JSON over HTTP, loopback-only, `Authorization: Bearer <token>`
(the existing cookie also accepted; the instance plane mints a fresh
token per spawned instance — Q-92).

### `POST /v2/open` — enter or resume a context

```ts
{ re: Re, mode?: Mode }            // Mode = {minutes, energy, topic?, target?}
```

`Re` names every addressable context (the union is closed — no CRUD
escape):

```ts
type Re =
  | { kind: 'sitting' }                      // open: requires mode
  | { kind: 'sitting', id: string }          // an open sitting
  | { kind: 'unprompted' }                   // the blank page (this IS the note sideband — no separate /note exists)
  | { kind: 'parked', queueEntryId: string } // resume a parked sounding or DRM
  | { kind: 'drm', sittingId: string }
  | { kind: 'harvest', sessionId: string }
  | { kind: 'import' }                       // scan/survey/region context
  | { kind: 'import-piece', hash: string }
  | { kind: 'piece', id: string }
  | { kind: 'wiki' } | { kind: 'claim', id: string }
  | { kind: 'coach', slug: string } | { kind: 'quest', id: string }
  | { kind: 'queue' } | { kind: 'waiting' }
```

`open` on a sitting returns the opener in a TurnEnvelope (pulse
prompt included). `open` on anything else returns that context's
projection plus its available verbs.

### `POST /v2/say` — the sole prose channel

```ts
{ re: Re, text: string, channel?: 'typed'|'spoken'|'pasted',
  intent?: SayIntent, rev?: number }
type SayIntent = 'answer'      // default for sitting/drm — the turn
  | 'pulse'                    // sitting pulse (empty text = skip, writes nothing)
  | 'unprompted'               // blank page / note
  | 'restate'                  // harvest proposal restatement (re: harvest + proposal index in meta)
  | 'correct'                  // wiki claim edit — body rewrite + unprompted Snippet (re: claim)
  | 'return'                   // quest return (re: quest)
  | 'artifact'                 // artifact declaration sentence (re: coach; pointer+name ride meta — the sentence is the harvestable part, Q-78)
  | 'exclude'                  // import piece exclusion — the reason is the person's sentence, recorded never logged
  | 'prose'                    // piece trailing paragraph (re: piece, meta.arrangement)
```

Every `say` response is a TurnEnvelope.

### `POST /v2/act` — every non-prose verb, enums and offsets only

```ts
{ re: Re, verb: Verb, rev?: number }
type Verb =
  // sitting
  | { v: 'skip' } | { v: 'defer', need?: 'time'|'energy' }
  | { v: 'end' }                       // harvest begins behind the response
  | { v: 'leave' }                     // client-side today; explicit here: close nothing, keep words
  | { v: 'sounding', accept: boolean }
  | { v: 'gate', choice: 'continue'|'park'|'another-day' }
  // drm
  | { v: 'drm-start' } | { v: 'drm-episode', name: string, startHour: number }
  | { v: 'drm-enumerate-done' } | { v: 'drm-gate', choice: GateChoice }
  // harvest review (per proposal, by index; restate is say)
  | { v: 'approve', proposal: number }
  | { v: 'trim', proposal: number, span: [number, number] }  // offsets into the proposal — exact-substring is structural
  | { v: 'discard', proposal: number }
  | { v: 'commit' }                    // save decisions; refused until every proposal is decided
  // wiki
  | { v: 'read', surface?: string } | { v: 'attest' } | { v: 'challenge' }
  // piece
  | { v: 'reorder', arrangement: string, entries: string[] }
  | { v: 'choose', arrangement: string }
  | { v: 'arrangements' }              // request model candidates; mints nothing
  | { v: 'gap', arrangement: string, gap: string, question?: string, after?: string }
  | { v: 'gap-accept', arrangement: string, gap: string, snippet: string, version: number }
  | { v: 'remove', arrangement: string, entry: string }
  | { v: 'set-down' } | { v: 'pick-up' }
  | { v: 'compose', snippets: string[] }        // re: {kind:'piece'} absent — mints the Piece
  // import
  | { v: 'scan', folder: string, region?: string }
  | { v: 'survey', folder: string }             // writes the snapshot — an act, not a view
  | { v: 'declare-region', root: string, dating: DatingRule, authorship: Authorship }
  | { v: 'import-approve', cut: number } | { v: 'import-trim', cut: number, span: [number, number] }
  | { v: 'import-discard', cut: number } | { v: 'import-commit' }   // restate absent BY CONSTRUCTION (Q-58)
  // coach
  | { v: 'coach', name: string } | { v: 'uncoach' } | { v: 'decline-offer' }
  | { v: 'adopt', optionId: string } | { v: 'decline-option', optionId: string }
  | { v: 'retire' } | { v: 'coach-read' }
  // reach / anniversary
  | { v: 'decline-reach', path: string }
```

Existing enum unions (Facet, Stance, GateChoice, QueueEntry.source,
HarvestDecision.action, ImportDecision.action, Authorship,
DatingRule — src/types.ts, src/import/contract.ts) are reused
verbatim; `/v2` invents no new domain vocabulary.

### `GET /v2/view` — shaped projections, PURE

```ts
GET /v2/view?scope=<Scope>&…params
type Scope = 'queue' | 'wiki' | 'wiki-all' | 'snippets' | 'pieces'
  | 'piece' | 'piece-export'          // piece-export returns text/markdown
  | 'harvest-queue' | 'harvest' | 'import-next' | 'import-survey'
  | 'reach' | 'coach-waiting' | 'coach' | 'cadence' | 'anniversary'
  | 'activity'                        // ?since=ISO; SSE with Accept: text/event-stream
  | 'auth-status' | 'stt-status'
```

**`view` is side-effect-free — a ruled break from the old routes.**
The census found six read-shaped routes that write. Their writes move:

| old side effect | new home |
|---|---|
| `GET /api/wiki` stamps `surfaced()` per claim | explicit `act {v:'read'}` per claim (the SPA's dwell observer maps to it) |
| `GET /api/queue` expires the open-pool tail | docket sweep |
| `GET /api/import/survey` writes survey.json | `act {v:'survey'}` |
| `GET /api/coach/waiting` / `GET /api/reach` log offer evaluations | server logs on its own clock, not on reads |

Projections only (Q-92): `view` shows what the SPA shows — the
interview, never the filesystem. The loop harness reads raw vault
files via the filesystem, outside the API.

## TurnEnvelope

The single response shape for `open`/`say`/`act` on living contexts:

```ts
{
  re: Re,                    // echoed, with ids filled (e.g. minted sitting id)
  rev: number,               // monotonic per-vault event counter
  turn?: {
    kind: 'probe'|'saturated'|'checkpoint'|'descent-closed'|'drm-probe'|'drm-gate'|'drm-closed',
    text?: string, questionForm?: QuestionForm, phase?: Phase,
    juxtaposition?: { snippetText: string, snippetDate: string },
    sounding?: { rung: number, of: number, checkpoint: boolean },
    soundingOffer?: { construct: string, allowance: number, sentence: string },
    endedBy?: SoundingEnd, soundingId?: string,
    pulsePrompt?: string, target?: string,
    source?: 'deck'|'resurfacing', context?: string,
  },
  view?: object,             // the context projection when opening non-sitting contexts
  notices?: string[],        // display sentences only — never machine-parsed
}
```

Provenance stays OFF the wire, exactly as today (a client cannot
tell a bank draw from a composed question except via the
juxtaposition field) — the loop's personas must not see selection
internals, for the same reason the person doesn't.

## IDs, rev, concurrency

All ids are the existing opaque ids, passed through. `rev` is a
monotonic per-vault counter bumped on every committed write; `say`
and `act` accept optional `rev` and are refused with `conflict` when
stale. Single-user local — `rev` is optional everywhere.

## Errors

```ts
{ error: { code: 'bad-request'|'unauthorized'|'not-found'|'gone'
         |'conflict'|'refused'|'unavailable', message: string } }
```

`refused` is the canon-guard code (trim outside the proposal,
gap-accept without provenance, commit with undecided proposals,
region rules) — distinct from `bad-request` so a persona can tell "I
broke the constitution's rule" from "I sent malformed JSON".
`unavailable` = compose failure with state restored (today's 503).
HTTP status mirrors the code.

## Outside the four operations, deliberately

- `POST /api/transcribe` — a device adapter (raw PCM), not part of
  the interview surface; personas send `channel:'spoken'` directly.
- `POST /api/fresh-start`, `/api/setup`, `/api/login` — owner and
  provisioning plane, not persona surface.
- The record plane (ledger, verdicts, demote) — ticket 122's spec.

## Headless-completeness verdicts

Every SPA affordance in the census maps to an op above. Explicit
calls on the census's edge findings:

- **DRM is carried** (`re: drm`, the drm-* verbs) even though the
  SPA reaches it only by hash — the routes are live and persona
  lives may use the instrument.
- **Dead routes stay dead**: `/api/target-suggestion`,
  `/api/piece/:id/remove` (carried as `remove` anyway — it is a real
  arrangement verb), `/api/session/:id/drm/resume` (carried via
  `re: parked` uniformly, closing the SPA's parked-drm gap).
- **`leave` becomes explicit** (today it is a client navigation that
  deliberately calls nothing) so a headless persona can end an
  evening without harvesting, exactly as a person can.
- **The `/note` sideband from the design synthesis is DROPPED as a
  separate operation** — `say {re:{kind:'unprompted'}}` is the note
  sideband; the census confirmed no such route ever existed.
- Client-only conveniences (draft decisions, selection sets, paste
  majority detection) stay client-side; the API takes only decided
  values, as today.
