# Coach Slice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person declares a Direction coached and gets one page for it: a
chronological log half (quests with their returns, artifacts by the name the
person gave them, sittings that touched the Direction) and a margin half holding
at most one unread advice note — a set of 2–3 alternative concrete acts, each
citing claims. Adopting an act mints a quest; coming back with words is ordinary
capture; declaring an artifact is a pointer plus the person's own sentence. The
agent's only moves are offers; the person's only records are their own words.

**Architecture:** The Coach is a new `src/coach/` module family — contract,
store, license, reflection, advise, page — plus routes appended to
`src/server.ts` and one new web page. Nothing in it acts on its own judgment:
every mechanism is either an OFFER (the coached-Direction line, the advice
note's option set — live under Q-62, every evaluation logged) or the person's
own act captured through the ordinary harvest path (quest returns and artifact
sentences reuse `startBackgroundHarvest` and the existing review surface, so
returns become Snippets by the same gate everything else passes). Quest
provenance is carried on the sitting: the return route starts the transcript
with a `quest` tag, and a return-Snippet's `provenance.session` resolves to it —
no harvester change, which matters because `src/harvester/harvester.ts` is
under active edit by ticket 091 and is READ-ONLY to this plan. All coach state
is markdown under `vault/coach/` and every decision is recomputed from disk
(Q-3): a restart resumes, and quest status is derived, never stored, so it
cannot lie.

**Tech Stack:** TypeScript, Node, Hono, gray-matter, vitest. No new dependency.
One model call in the whole slice (`src/coach/advise.ts`); everything else is
zero-LLM.

---

## 1. What is already true, and must stay true

Verified on disk 2026-08-02. **All line numbers in this plan are from that
reading and three slices (058 remainder, 010, 012, 014-Seeding) execute before
this one — re-read every contended file at dispatch; treat line refs as
landmarks, not addresses.**

| Fact | Where |
|---|---|
| `QueueEntry.source` is a closed union; `src/queue/source-label.ts:41` holds `Record<QueueEntry['source'], string>`, so a new member fails `tsc` until its label lands. Five of its six members — all but `user-declared` — read `'from your own words'` on purpose (Q-15; S3 no-self-announcement). | `src/types.ts:256-275`, `src/queue/source-label.ts:31-52` |
| Queue optional fields round-trip through `#parseEntry`/`#write` under presence guards (`matter.stringify` throws on a present-but-undefined key). `expire()` expires only `pending`, never `user-declared`. | `src/queue/queue.ts:176-246, 496-514` |
| `direction?: string` exists on `QueueEntry` and is **written by nothing** (seeding plan verified 0 of 17 entries). Directions are not reified anywhere in `src/`. | `src/types.ts:321`; seeding plan Blocking OQ (Task 11) |
| The live offer shape (Q-62): a GET evaluates, logs every evaluation, and returns at most one dimmed line; silence does nothing. Precedents: the harvest-queue count (`web/main.ts:503`), the randomizer licence (`src/randomizer/license.ts`), and Seeding's Reach (`src/import/reach.ts` + `GET /api/reach`, landing before this slice). | as cited |
| `startBackgroundHarvest` (inside `createApp`) is the ordinary capture path: start transcript, append turn, propose in background, land in the pending-review queue. `POST /api/unprompted` (`src/server.ts:1203-1238`) is the single-turn template this plan copies. | `src/server.ts:1035-1071` |
| `vault.startTranscript(session, meta)` writes `{session, mode, protocol, started}` frontmatter and nothing else — a quest tag needs a vault patch. `saveSnippet` copies `provenance` whole. | `src/vault/vault.ts:153-169, 47-63` |
| Every emitted Activity Log kind needs a `SENTENCES` entry and an `EMITTED` sample; `tests/emitted-kinds.ts` finds kinds mechanically (it follows `serverEmit` and injected `log` fns one hop). A kind with no sentence and a sentence with no kind both go red. | `src/log/format.ts:307`, `tests/log-format.test.ts:35` |
| Every exported `src/` function/object-const needs a `MECHANISM_REGISTRY` entry; `live` requires a caller outside tests, `unwired` forbids one — per commit. **Same-module uses past the declaration line COUNT as callers** (`tests/mechanism-registry.test.ts:236-239`), which decides several registry declarations below. `web/` exports are not swept. | `src/registry.ts:74`, `tests/mechanism-registry.test.ts` |
| Thresholds live in `THRESHOLDS` with `live` + `graduatesWhen` per entry; decisions pass through `shadowDecision`. Q-56 bounds and Q-62 offer licences ship `live: true`; selection mechanisms that ACT stay shadow. | `src/wiki/thresholds.ts:65-197` |
| Claims: `id, body, range, status, cites ("snippetId@version"), facet, referents, attested…` — **no direction field, no skill marker**. Skill is deliberately absent from `Facet`. | `src/wiki/contract.ts:47-82` |
| `LlmRole` is `'elicitor' | 'clerk'` — there is no coach role. Background prose belongs to the clerk Complete (`deps.clerk?.complete ?? deps.complete`). | `src/llm.ts:14` |
| The static catch-all `app.get('/*')` is registered last (`src/server.ts:1633`); "append routes" means insert the coach block immediately ABOVE it. | `src/server.ts:1633` |

### Three findings from reading the code, each of which shaped this plan

**Finding 1 — Directions do not exist yet, and the ticket knows it.** The only
`direction` in `src/` is an optional string on `QueueEntry` that no minting path
populates, and Claims carry no direction at all. Ticket 090's data note says the
slice "is buildable now but its offers fire only as Directions mature" — so this
plan builds the coached-Direction record as the FIRST reification of a
Direction, computes direction-relevance mechanically (name-term overlap, the
same ruling Seeding took for Reach), and lets every evaluator log honestly over
a pool that is small-to-empty today. Empty corpus = quiet, logged, never
blocked; nothing waits on Directions being real elsewhere.

**Finding 2 — the harvester is off-limits, so quest provenance rides the
sitting.** Ticket 091 is editing `src/harvester/harvester.ts` right now.
`decide()` constructs `Provenance` literals at `:701` and `:743`, so stamping a
`quest` field into snippet provenance would mean editing that file. Instead the
return route tags the TRANSCRIPT (`quest`, `direction` in frontmatter, one
vault patch this plan owns), and a return-Snippet's quest provenance is derived:
`snippet.provenance.session → transcript frontmatter`. Q-75's "Snippets with
quest provenance" is satisfied on the lineage plane, recomputable from disk. If
canon later wants the stamp on the snippet itself, that is a one-field
harvester patch — recorded as an Open Question, not smuggled into a task.

**Finding 3 — quest offers would deadlock without a bootstrap rule.** Q-74 says
each offered act cites "the claims that make it relevant"; Q-78 says
skill-claims cite return-Snippets — which exist only after coaching begins. A
strictly evidence-linked claim pool is therefore empty for every first-time
Direction and no option could ever cite anything: the mechanism ships inert,
this repo's most-repeated defect. The pool is therefore
`relevantClaims(direction)` = claims sharing normalized name-terms with the
Direction's name ∪ claims citing snippets from sittings tagged to the
Direction. Mechanical, logged, and it converges on the Q-78 evidence link as
returns produce claims. Recorded as a Blocking Open Question with this as the
recommended default.

---

## 2. What this slice does NOT build, and why

- **No skill-claim machinery.** Returns and artifact sentences become ordinary
  Snippets through the ordinary review; the Clerk's existing jobs mint claims
  from them like anything else. Q-78 constrains what a skill-claim may cite,
  and this slice's whole job there is making the citable things exist.
- **No Direction reification beyond the coached record.** The elicitor minting
  `direction` onto queue entries, emergent Directions, Randomizer injection —
  all out of scope. The coach reads what exists and matures with it (090's
  data note).
- **No global Coach tab.** Q-76 forbids it by name: an aggregate view is a
  report card, the artifact Q-24 exists to prevent. One page per coached
  Direction, reached from the waiting surface's quiet line.
- **No completion rates, deadlines, reminders, streaks, failure states, or
  quest expiry.** Q-74/Q-75/Q-24. These are not omissions to revisit — the
  acceptance suite asserts the record shapes cannot carry them.
- **No artifact read path.** Q-78: the model never opens an artifact. There is
  no function anywhere in `src/coach/` that takes the pointer and returns
  content, and the prompt-input type has no pointer field — impossible by
  construction, verified by the acceptance suite against the fake model's
  recorded prompts.
- **No re-offer scheduler.** A declined coached-offer and a declined option are
  records plus a dedupe check (Q-77, Q-43's discipline) — never a retry queue.
- **No notifications.** Advice is in-app only (Q-24, Q-22): a note waits on the
  page, a quiet line waits on the waiting surface, and nothing walks out.
- **No new offer surface.** The coached offer reuses the waiting surface's
  dimmed-line shape (Q-37) that Reach lands there before this slice executes.
- **No edits to `src/harvester/harvester.ts`, `src/elicitor/elicitor.ts`, or
  `src/clerk/docket.ts`.** Capture reuses existing paths; advice minting runs
  in the background off licensing routes, recomputed from disk, so the docket
  needs no coach job.

---

## 3. Shaping decisions

1. **The advice note IS the option set.** One shape unifies Q-74 and Q-77:
   `AdviceNote = { options: QuestOption[2..3], license, mintedAt, readAt? }`.
   Choice-expansion is structural (a guard refuses a one-option note — "a
   single proposed next step is a prescription wearing a quest costume", Q-74),
   and "one unread note, replaced not stacked" is structural too: one file per
   Direction, overwritten. Silence over an option = it evaporates with the next
   replacement, no residue (Q-74); explicit decline = recorded text, never
   re-offered (Q-77); adopt = quest record minted (Q-74).
2. **Quest status is computed, never stored.** `adopted → returned → retired`
   derives from `retiredAt` and the existence of quest-tagged sittings.
   `offered` is not a record state at all — it lives only in the note, exactly
   as Q-74 rules ("adoption mints the quest record").
3. **All licensing is recomputed from disk facts** — return transcripts,
   artifact records, `answeredAt` on direction-tagged queue entries, the visit
   stamp. Q-77's four licensing events, concretely: (a) a quest return
   (`quest-return`), (b) an artifact registration (`artifact-declared`), (c) a
   sitting touching the Direction (`sitting-touched`: a direction-tagged queue
   entry answered, or a direction-tagged transcript started, after the current
   note's `mintedAt`), (d) opening the Coach page (`page-opened`). Elapsed time
   appears in no predicate anywhere.
4. **Advice minting runs fire-and-forget off the licensing routes**, exactly as
   `startBackgroundHarvest` does — no docket edit, no timer, and a crash loses
   nothing because the next event re-licenses from disk.
5. **All coach Activity Log emission happens in `src/server.ts` routes.** The
   coach modules return outcomes; the route logs them. One consequence: the
   contended `src/log/format.ts` has exactly one owner per wave (T9, then T10),
   and the emitted-kinds sweep finds every kind in one file.
6. **A declined coached-offer is never re-offered for that Direction.**
   Recorded as `offerDeclinedAt` on a direction stub; the only way back is the
   person declaring coached themselves — which Q-73 makes the primary door
   anyway.
7. **Un-coaching flips a boolean and stops the lens.** Page 404s quietly,
   waiting lines stop, minting stops. Every file stays: Q-73, "archives
   nothing".
8. **`page-opened` licenses a mint attempt on the read POST**, after the
   current note is marked read — so the cap (one unread note) holds
   structurally and the person who reads a note may find a fresh one next
   visit. Person-caused, per Q-77.

---

## 4. Flow Map

```
 the waiting surface, between sittings
        │  GET /api/coach/waiting
        ▼
  coach/license.ts#evaluateOffer ── candidate Directions = distinct
        │    QueueEntry.direction values ∪ un-coached direction records
        │    relevantClaims(d) ≥ coach.offerMinClaims → ONE dimmed line
        │    (Q-37 shape, LIVE per Q-62); every evaluation logged (kind
        │    coach-offer); declined → offerDeclinedAt, never re-offered;
        │    silence does nothing. Empty corpus: qualified=0, one log
        │    line, nothing shown, nothing blocked.
        │
        │  the person accepts the offer, or names a Direction themselves
        ▼  POST /api/coach/direction { name }            ← the ONLY door (Q-73)
  vault/coach/directions/<slug>.md  coached: true        the person's declaration (Q-73)
        │
        ▼  GET /api/coach/<slug> ── coach/page.ts#buildCoachPage
        │    log half: quests + returns (quoted), artifacts BY NAME,
        │    direction-tagged sittings, chronological. advice margin:
        │    the one note, unread or read.
        │  POST /api/coach/<slug>/read ── marks note read + visit stamp,
        │    then background runCoachAdvice(license='page-opened')
        │
        ▼  coach/advise.ts ── the ONE model call. Input: relevantClaims,
        │    quest texts, return prose, artifact NAMES. No pointer field
        │    exists on the input type (Q-78). Guard: 2–3 options, each
        │    citing a resolving claim, declined texts dropped; fewer than
        │    2 survivors → withheld, logged, nothing written.
        │    vault/coach/advice/<slug>.md — ONE file, replaced (Q-77).
        │
        ▼  POST /api/coach/<slug>/adopt { optionId } → quest minted (Q-74)
        │  vault/coach/quests/<ulid>.md  { act, cites, adoptedAt }
        │
        ▼  POST /api/coach/quest/<id>/return { text } ── ORDINARY CAPTURE:
        │    startTranscript(meta + {quest, direction}) → appendTurn →
        │    startBackgroundHarvest → pending review → decide() →
        │    Snippets whose provenance.session resolves to the quest (Q-75)
        │    + coach/reflection.ts: ≤ coach.reflectionCap template questions
        │    quoting the return verbatim (Q-12), source 'quest-reflection',
        │    normal queue, normal 30-day expiry
        │
        ▼  POST /api/coach/<slug>/artifact { pointer, name, sentence }
        │    pointer → lineage record, NEVER opened; sentence → the same
        │    ordinary capture path → description-Snippet (Q-78, Q-40)
        │
        ▼  POST /api/coach/quest/<id>/retire        the person's verb (Q-75)
        │
        ▼  the corpus. The Clerk reads return- and description-Snippets
           like any others; skill-claims cite them (Q-78). No coach code
           touches the wiki.
```

---

## 5. Standing rules for every task below

1. **Nothing acts.** Every mechanism is an offer or the person's captured act.
   If a task finds itself writing code that does something when the person is
   silent, stop: that is a Q-62 "acts" mechanism and does not belong here.
2. **A mechanism is not done until a production caller drives it.** This repo
   has shipped six inert mechanisms. Every task's verification exercises the
   new code through its real caller (route → module → disk), and asserts the
   effect on disk or in a response body — never the signature. An optional
   parameter no caller passes is the named failure (MEMORY: wiring, not
   signatures); T4's vault tags and T1's queue field are explicitly wired and
   asserted in T10/T12.
3. **Coach state is on disk or it does not exist.** No module-level cache
   without a file behind it. Quest status and licensing are recomputed from
   disk on every read.
4. **Offer-only ships live and logs every evaluation (Q-62).** The coached
   offer and the advice mint log what they evaluated, not only what they
   offered — kind `coach-offer` fires on every waiting evaluation, and
   `advice-withheld` records a mint that refused itself.
5. **Every new Activity Log kind lands with its sentence and its sample in the
   same task** (`src/log/format.ts` + `tests/log-format.test.ts`), or the
   sweep goes red (Q-23). Suggested sentences in T9/T10 obey Q-15: nothing
   accuses, nothing names dormancy, no identifier reaches the surface.
6. **Contended files are append-only and re-read at dispatch.** `src/types.ts`,
   `src/queue/*.ts`, `src/wiki/thresholds.ts`, `src/log/format.ts`,
   `src/registry.ts`, `src/server.ts`, `web/main.ts`, `web/style.css` are all
   patched by slices that execute before this one (058 remainder, 010, 012,
   014-Seeding — see their plans' ownership tables). Coach edits append; they
   reword nothing. If `src/log/format.ts` still carries foreign unstaged
   hunks, stage hunk-by-hunk (`git add -p`), never `git add` the file whole.
   ONE named carve-out from append-only: T11 Step 1 edits `isReadPath` in
   `web/main.ts` mid-file, because the coach page cannot fetch itself
   otherwise — that edit and no other.
7. **READ-ONLY, no exceptions:** `src/harvester/harvester.ts` (ticket 091 is
   editing it now), `src/elicitor/elicitor.ts`, `src/clerk/docket.ts`,
   `src/clerk/composed.ts`. A task that believes it must edit one of these has
   found a scope change: stop and report.
8. **Guilt-free by construction (Q-24).** No record shape in this plan may
   carry a rate, a streak, a deadline, or a failure state — and T12 asserts
   the absence, so adding one later is a red test, not a review comment.
9. **One commit per task.** Commit messages follow the repo's pattern:
   `coach: <what landed, in the person's terms>`.

---

## 6. File Structure

**Created:**

| File | Responsibility | Task |
|---|---|---|
| `src/coach/contract.ts` | Every coach type; `slugFor`; `adviceGuard` (the option-set gate); `AdvicePromptInput` — the type with no pointer field. The only file that knows the record shapes. | T2 |
| `src/coach/store.ts` | `createCoachStore(vaultRoot)` — directions, quests, artifacts, advice on markdown under `vault/coach/`; `questStatus` computed; `readSittingTags` (transcript frontmatter reader). | T3 |
| `src/coach/license.ts` | Pure: `relevantClaims`, `evaluateOffer`, `licenseState`, `somethingNew`. Zero LLM. | T5 |
| `src/coach/reflection.ts` | `mintReflections` — ≤ cap template questions quoting the return verbatim, deduped per (quest, session). Zero LLM. | T6 |
| `src/coach/advise.ts` | `runCoachAdvice` — the one model call; builds `AdvicePromptInput`, parses, guards, replaces the note or withholds. | T7 |
| `src/coach/page.ts` | `buildCoachPage`, `waitingLines`, `offerSentence` — server-composed prose, testable without a DOM. | T8 |
| `web/coach.ts` | The Coach page renderer, injected deps, document rule. | T11 |
| `tests/coach-contract.test.ts`, `coach-store.test.ts`, `coach-license.test.ts`, `coach-reflection.test.ts`, `coach-advise.test.ts`, `coach-page.test.ts`, `coach-routes.test.ts`, `coach-surface.test.ts`, `coach-acceptance.test.ts` | One suite per module, the route suite, the surface suite, and the end-to-end loop. | per task |

**Modified (all append-only; owner per wave in §8):**

| File | Change | Task |
|---|---|---|
| `src/types.ts` | `QueueEntry['source']` += `'quest-reflection'`; `QueueEntry.quest?: string`. | T1 |
| `src/queue/queue.ts` | Round-trip the `quest` field in `#parseEntry`/`#write`, under presence guards. | T1 |
| `src/queue/source-label.ts` | `'quest-reflection': 'from your own words'` — compile-forced. | T1 |
| `tests/queue-source-label.test.ts`, `tests/queue.test.ts` | `SOURCES` member + Q-15 assertion; round-trip case. | T1 |
| `src/vault/vault.ts` | `startTranscript` meta gains optional `quest`/`direction`, written under guards. | T4 |
| `tests/vault.test.ts` | The tag round-trip and the absent-stays-absent case. | T4 |
| `src/wiki/thresholds.ts` | `coach.offerMinClaims` (3, live), `coach.reflectionCap` (2, live), each with its `graduatesWhen`. | T5 |
| `src/registry.ts` | Entries per new export at each module's landing task; flips as callers land (T3, T7, T8, T9, T10). Same-module callers make three entries live at birth: `normalizeOption` (T2), `relevantClaims` (T5), `buildAdviceInput` (T7). | T2, T3, T5, T6, T7, T8, T9, T10 |
| `src/server.ts` | The coach routes, inserted above the static catch-all. **T9 and T10 only, one wave each.** | T9, T10 |
| `src/log/format.ts` + `tests/log-format.test.ts` | Sentences + samples for the wave's kinds. **One owner per wave: T9, then T10.** | T9, T10 |
| `web/main.ts` | `Screen` += `'coach'`; the render case; waiting-surface additions (offer line + quiet lines). Append-only. | T11 |
| `web/style.css` | Coach page + dimmed line styles. | T11 |

**Not modified, ever, by this plan:** `src/harvester/harvester.ts`,
`src/elicitor/elicitor.ts`, `src/clerk/docket.ts`, `src/clerk/composed.ts`,
anything under `vault/` (the app writes it at runtime; the plan and its tests
use temp dirs and fixtures only).

**Storage layout (Q-3 — markdown is truth, everything else derived):**

```
vault/coach/directions/<slug>.md   frontmatter: slug, name, coached,
                                   coachedAt?, uncoachedAt?, offerDeclinedAt?,
                                   lastVisit?, declinedOptions[]
vault/coach/quests/<ulid>.md       frontmatter: id, direction, cites[],
                                   adoptedAt, retiredAt?   body: the act text
                                   (agent prose, Marginalia-class)
vault/coach/artifacts/<ulid>.md    frontmatter: id, direction, quest?,
                                   pointer, name, sentenceSession, declaredAt
vault/coach/advice/<slug>.md       ONE file per direction, REPLACED:
                                   direction, mintedAt, license, readAt?,
                                   options[{id, text, cites[]}]
```

---

## Wave 0 — the contracts

### Task 1: The reflection source and the quest field on the Queue [MODIFY]

**Orient:** Q-75 makes a return license reflection follow-ups, and those
questions must land in the ordinary Queue under a source the closed union
knows, wearing a label that announces nothing (Q-15) — otherwise the waiting
surface either fails to compile or leaks a machine literal.
**Flow position:** Step 1 of 12 — consumed by T6 (reflection minting), T10 (the
return route), T12 (acceptance).
**Skill:** `tdd`
**Files:**
- Modify: `src/types.ts` (the `QueueEntry` block, ~`:256-330` as of
  2026-08-02 — prior slices append here; re-read first)
- Modify: `src/queue/queue.ts` (`#parseEntry` ~`:176`, `#write` ~`:217`)
- Modify: `src/queue/source-label.ts` (`SOURCE_LABELS`, ~`:41` — will not
  compile without the new member)
- Modify: `tests/queue-source-label.test.ts` (the runtime `SOURCES` array),
  `tests/queue.test.ts` (round-trip)

<contracts>
**Downstream (this-node → reflection, routes, acceptance):**

```ts
// src/types.ts — QueueEntry['source'] gains
  | 'quest-reflection'

// src/types.ts — QueueEntry gains
  /**
   * The quest a reflection question follows (Q-75). Optional, because only
   * 'quest-reflection' entries carry one — and load-bearing, because the
   * (quest, session) pair is the dedupe key: without it a second return
   * would re-mint the same two questions forever.
   */
  quest?: string;
```

- Behavioural invariant: the label is `'from your own words'` — identical to
  `composed`'s. A question that announces itself as quest-tagged tells the
  person their return is being graded, which is the verification Q-15 forbids
  and the shame gradient Q-24 forbids. The existing suite asserts no source
  literal appears in any label; the new member joins `SOURCES` so those
  assertions cover it.
- Behavioural invariant: nothing switches over the union (the union's own
  comment); `draw` and `expire` behavior is untouched. A pending
  `quest-reflection` entry expires at 30 days like any Clerk source — and that
  expiry is queue hygiene, never a quest failure state (Q-75 has none).
- Behavioural invariant: `quest` round-trips through disk under a presence
  guard on both sides; an entry without it parses exactly as today.
</contracts>

- [ ] **Step 1:** Append the union member and the field with the doc comments
  above. Run `npx tsc --noEmit` — expect exactly one failure, at
  `SOURCE_LABELS` in `src/queue/source-label.ts`. Add
  `'quest-reflection': 'from your own words',`. If `tsc` fails anywhere else,
  a prior slice added a second exhaustive check — satisfy it the same way and
  note it in the commit message.
- [ ] **Step 2:** Add the round-trip guards in `src/queue/queue.ts`
  (`...(data.quest ? { quest: data.quest as string } : {})` in `#parseEntry`;
  `if (entry.quest) fm.quest = entry.quest;` in `#write`).
- [ ] **Step 3:** Tests: add `'quest-reflection'` to `SOURCES` in
  `tests/queue-source-label.test.ts` plus one assertion
  `sourceLabel('quest-reflection') === sourceLabel('composed')`; in
  `tests/queue.test.ts` add one case: an entry written with
  `quest: '01ABC…'` reads back with it, and an entry without it reads back
  with no `quest` key.

Run: `npx vitest run tests/queue-source-label.test.ts tests/queue.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 4: Commit** — `coach: the quest-reflection source and its queue field`

---

### Task 2: The coach contract — records, the option guard, and the type with no pointer [NEW FILE]

**Orient:** Ten later tasks read and write one set of record shapes; if each
invents its own, the store and the page disagree about what a quest is. And two
of the design's hard rules — options-never-prescriptions (Q-24/Q-74) and
the-model-never-opens-an-artifact (Q-78) — are cheapest to make structural
here, as a guard function and a prompt-input type with no pointer field.
**Flow position:** Step 2 of 12 (contract → store → license → reflection →
advise → page → routes → web → acceptance).
**Skill:** `tdd`
**Files:**
- Create: `src/coach/contract.ts`
- Create: `tests/coach-contract.test.ts`
- Modify: `src/registry.ts` (entries for the exports; `unwired` with reasons)

<contracts>
**Downstream (contract → everything):**

```ts
// src/coach/contract.ts

/** Q-77's licensing events, enumerated. Elapsed time is not one and never will be. */
export type CoachLicenseEvent =
  | 'quest-return' | 'artifact-declared' | 'sitting-touched' | 'page-opened';

export type DirectionRecord = {
  slug: string;            // slugFor(name); stable identity
  name: string;            // the person's words for it
  coached: boolean;        // the lens (Q-73); flipping off archives nothing
  coachedAt?: string;
  uncoachedAt?: string;
  /** A declined coached-offer; this Direction is never offered again (Q-77 discipline). */
  offerDeclinedAt?: string;
  /** Last page read — what "something new" is measured against (Q-76). */
  lastVisit?: string;
  /** Normalized texts of declined options — never re-offered (Q-77). */
  declinedOptions: string[];
};

export type Quest = {
  id: string;
  direction: string;       // slug
  act: string;             // agent prose, Marginalia-class: never quotable into a Piece (Q-74)
  cites: string[];         // claim ids that made it relevant (Q-74)
  adoptedAt: string;       // adoption MINTS the record (Q-74)
  retiredAt?: string;      // the person's verb (Q-75)
};
/** Computed, never stored (Q-75) — a stored status could lie; a derived one cannot. */
export type QuestStatus = 'adopted' | 'returned' | 'retired';

export type ArtifactRecord = {
  id: string;
  direction: string;
  quest?: string;
  /** Lineage-plane, opaque. NO function in src/coach/ accepts this and returns content (Q-78). */
  pointer: string;
  /** The person's name for it — the only word the Coach may use (Q-78). */
  name: string;
  /** The capture session of the person's sentence — the description-Snippet's home. */
  sentenceSession: string;
  declaredAt: string;
};

export type QuestOption = { id: string; text: string; cites: string[] };
export type AdviceNote = {
  direction: string;
  mintedAt: string;
  license: CoachLicenseEvent;
  /** 2–3 by the guard — choice-expansion is structural (Q-24, Q-74). */
  options: QuestOption[];
  readAt?: string;
};

/** THE prompt-input type. It has no pointer field, so the model cannot be handed one (Q-78). */
export type AdvicePromptInput = {
  directionName: string;
  claims: { id: string; body: string; range: string }[];
  quests: { act: string; returns: string[] }[];  // return PROSE — the person's words
  artifactNames: string[];                        // names only, ever
};

/**
 * lowercase, [^a-z0-9]+ → '-'. The route words 'waiting', 'direction' and
 * 'quest' are RESERVED: a name that would slug to one gets a 'd-' prefix
 * (e.g. 'Waiting' → 'd-waiting'), so a page path can never shadow a coach
 * route — T11's isReadPath rule depends on this.
 */
export function slugFor(name: string): string;
export function normalizeOption(text: string): string;
/**
 * The gate every model-proposed option set passes. Refuses: <2 or >3 options,
 * an option with empty text, an option citing nothing, an option citing a
 * claim `claimExists` denies, an option whose normalized text matches a
 * declined one. Returns the survivors or a named refusal.
 */
export function adviceGuard(
  parsed: unknown,
  opts: { declined: string[]; claimExists: (id: string) => boolean },
): { ok: true; options: QuestOption[] } | { ok: false; reason: string };
```
</contracts>

- [ ] **Step 1:** Write `tests/coach-contract.test.ts` first: `slugFor`
  stability ('Wood Working!' → 'wood-working') and the reserved words
  ('Waiting' → 'd-waiting', 'quest' → 'd-quest', 'direction' →
  'd-direction' — a slug is never a route word); guard refuses one option
  (prescription), refuses four, refuses an unresolvable cite, drops a declined
  text and refuses when <2 survive, passes a clean pair; `QuestStatus` and the
  record types carry no rate/deadline/failure key (a `// @ts-expect-error`
  each on `completionRate`, `deadline`, `failed`).
- [ ] **Step 2:** Implement. Pure module, no I/O, no imports beyond types.
- [ ] **Step 3:** Registry entries: `slugFor` and `adviceGuard` `unwired`,
  reason `'wired by the coach store (T3) and advise (T7); routes land in
  T9/T10'`. `normalizeOption` is **live from birth**: `adviceGuard` calls it
  in this same module, and the sweep counts same-module callers past the
  declaration line — so declare `normalizeOption` ABOVE `adviceGuard` in the
  file and register it `live` with that reason. An `unwired` declaration here
  would fail T2's own gate.

Run: `npx vitest run tests/coach-contract.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: the contract — records, the option gate, and the input the pointer cannot reach`

---

## Wave 1 — the store and the sitting tag

### Task 3: The coach store — every record on disk, every status derived [NEW FILE]

**Orient:** A restart between an adoption and a return must lose nothing, and a
stored quest status could be falsified by a hand edit — so every record is a
markdown file under `vault/coach/` and status is recomputed from disk on every
read.
**Flow position:** Step 3 of 12 (contract → **store** → license/advise/page →
routes). Downstream: every route in T9/T10 reads and writes through this.
**Skill:** `tdd`
**Files:**
- Create: `src/coach/store.ts`
- Create: `tests/coach-store.test.ts`
- Modify: `src/registry.ts`

<contracts>
**Downstream (store → license, advise, page, routes):**
```ts
export type SittingTag = { session: string; started: string; quest?: string; direction?: string };
export type CoachStore = {
  declareCoached(name: string): DirectionRecord;          // idempotent on slug; re-coaching flips coached back on
  uncoach(slug: string): DirectionRecord | null;          // coached=false, uncoachedAt; deletes nothing (Q-73)
  getDirection(slug: string): DirectionRecord | null;
  listDirections(): DirectionRecord[];                    // coached and not — the offer needs both
  recordVisit(slug: string, at: string): void;
  recordOfferDeclined(slug: string): void;                // creates the stub if the Direction was never declared
  addDeclinedOption(slug: string, text: string): void;    // stores normalizeOption(text)

  adoptQuest(input: { direction: string; act: string; cites: string[] }): Quest;
  retireQuest(id: string): Quest | null;
  getQuest(id: string): Quest | null;
  listQuests(direction?: string): Quest[];
  questStatus(q: Quest, tags: SittingTag[]): QuestStatus; // retiredAt → retired; any tag.quest===q.id → returned; else adopted

  declareArtifact(input: { direction: string; quest?: string; pointer: string; name: string; sentenceSession: string }): ArtifactRecord;
  listArtifacts(direction?: string): ArtifactRecord[];

  writeAdvice(note: AdviceNote): void;                    // REPLACES vault/coach/advice/<slug>.md (Q-77 — structural cap)
  readAdvice(slug: string): AdviceNote | null;
  markAdviceRead(slug: string, at: string): void;
};
export function createCoachStore(vaultRoot: string): CoachStore;
/** Frontmatter of every transcript, with the quest/direction tags T4 adds. Derived, cheap, recomputed. */
export function readSittingTags(vaultRoot: string): SittingTag[];
```
- Behavioural invariant: every optional frontmatter key is written under a
  presence guard (`matter.stringify` throws on present-but-undefined — the
  queue store's rule, same reason).
- Behavioural invariant: `writeAdvice` is the ONLY advice write and it
  overwrites — there is no append API, so a stacked second note is
  unrepresentable.
- Behavioural invariant: no store API deletes a file. Un-coaching, retiring,
  declining — all are field writes.
</contracts>

- [ ] **Step 1:** Tests first, against a temp dir: declare → get → uncoach
  round-trip with files still on disk; advice write-then-write leaves ONE file
  whose `mintedAt` is the second's; `questStatus` derives all three states;
  `readSittingTags` reads a transcript written by `vault.startTranscript` and
  returns no `quest` key for untagged ones; declined options accumulate
  normalized.
- [ ] **Step 2:** Implement with `gray-matter`, mirroring
  `src/queue/queue.ts`'s read/write idioms.
- [ ] **Step 3:** Registry: `createCoachStore`, `readSittingTags` — `unwired`,
  reason `'callers land with the coach routes (T9/T10)'`. Flip `slugFor` to
  `live` (the store calls it — an `unwired` entry with a caller fails the
  sweep; `normalizeOption` has been live since T2).

Run: `npx vitest run tests/coach-store.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: the store — records on disk, status derived, one advice file ever`

---

### Task 4: The sitting tag — quest provenance without touching the harvester [MODIFY]

**Orient:** Q-75 wants returns to be Snippets with quest provenance, and the
harvester that builds `Provenance` is being edited by ticket 091 right now — so
the tag rides the transcript instead: the return route starts the sitting with
`quest` and `direction` in frontmatter, and `provenance.session` resolves the
rest. This task is the vault seam; T10 is its caller.
**Flow position:** Step 4 of 12. Upstream: T10's return/artifact routes pass
the tags. Downstream: `readSittingTags` (T3) reads them; license and page
derive returns from them.
**Skill:** `tdd`
**Files:**
- Modify: `src/vault/vault.ts` (`startTranscript`, ~`:153-169`)
- Modify: `tests/vault.test.ts`

<contracts>
**Upstream (routes → vault):**
```ts
startTranscript(session: string, meta: {
  mode: Mode; protocol: string; started: string;
  /** The quest this sitting returns to (Q-75). Absent on every ordinary sitting. */
  quest?: string;
  /** The coached Direction this capture belongs to. Absent means untagged. */
  direction?: string;
}): void;
```
- Behavioural invariant: absent stays absent — the keys are written under
  guards, and a transcript without them parses byte-identically to today's.
  Every existing transcript on disk keeps parsing.
- Behavioural invariant: this is a WIRING liability until T10 lands (an
  optional param no caller passes is inert by definition). T10's verification
  and T12's acceptance both assert a transcript on disk carrying the tags,
  written through the route. If this plan is cut short before T10, this task's
  addition must be reverted rather than shipped dormant.
</contracts>

- [ ] **Step 1:** Test first: `startTranscript` with `quest`/`direction`
  writes both to frontmatter; without them the frontmatter has neither key.
- [ ] **Step 2:** Implement — two guarded lines in the `fm` construction.

Run: `npx vitest run tests/vault.test.ts && npx tsc --noEmit`
Expected: PASS, including every pre-existing vault case untouched.

- [ ] **Step 3: Commit** — `coach: a sitting can carry the quest it returns to`

---

## Wave 2 — licensing (SERIAL: T5 → T6; both append src/registry.ts, and T6 reads T5's threshold)

### Task 5: The licence module — offers, events, and "something new", all from disk [NEW FILE]

**Orient:** Three questions the routes will ask — may we offer coaching on a
Direction (Q-73)? what event, if any, licenses a fresh advice note (Q-77)? does
anything new wait since the last visit (Q-76)? — are answered here, purely,
from injected disk facts, so a restart changes no answer and a test needs no
server.
**Flow position:** Step 5 of 12 (store → **license** → routes T9/T10).
**Skill:** `tdd`
**Files:**
- Create: `src/coach/license.ts`
- Create: `tests/coach-license.test.ts`
- Modify: `src/wiki/thresholds.ts` (two entries, appended)
- Modify: `src/registry.ts`

<contracts>
**Downstream (license → routes):**
```ts
export type CoachFacts = {
  directions: DirectionRecord[];
  quests: Quest[];
  artifacts: ArtifactRecord[];
  sittingTags: SittingTag[];
  queueEntries: QueueEntry[];
  claims: { id: string; body: string; range: string; cites: string[]; archived?: boolean }[];
  snippetSessions: Map<string, string>;   // "snippetId@version"-id part → provenance.session
};

/** Name-term overlap ∪ evidence link — Finding 3's bootstrap rule. Mechanical, no model. */
export function relevantClaims(facts: CoachFacts, direction: { slug: string; name: string }): CoachFacts['claims'];

export type OfferEvaluation = {
  evaluated: { direction: string; claims: number }[];
  qualified: string[];
  /** At most one — top by claim count, ties by name. Null when none qualifies or all are declined/coached. */
  offered: { slug: string; name: string } | null;
};
/** Reads THRESHOLDS['coach.offerMinClaims'] through shadowDecision (log injected by the route). */
export function evaluateOffer(facts: CoachFacts, log: ThresholdLogFn): OfferEvaluation;

/** The newest Q-77 event after the current note's mintedAt (or after coachedAt when no note). Null = nothing licenses. */
export function licenseState(facts: CoachFacts, slug: string): { event: CoachLicenseEvent; at: string } | null;

/** Q-76's quiet line predicate: unread advice, or a quest/return/artifact fact newer than lastVisit. */
export function somethingNew(facts: CoachFacts, slug: string): boolean;
```
- Behavioural invariant: candidate Directions for the offer are the distinct
  non-empty `QueueEntry.direction` values (slugged) plus un-coached
  `DirectionRecord`s; coached and offer-declined Directions are excluded
  before evaluation, and the exclusion is visible in `evaluated` counts.
- Behavioural invariant, stated so nobody files it as a bug: **within this
  slice the queue arm of that candidate pool is dead.** The only writer of
  `QueueEntry.direction` this plan adds is T6's reflection entries, which
  fire only for already-coached Directions — and coached Directions are
  excluded from the pool. Until another slice mints direction-tagged entries,
  candidates come from direction records alone (stubs left by declines and
  un-coachings). Expected per 090's data note, not a defect.
- Behavioural invariant: **empty corpus** — no directions, no claims — returns
  `{ evaluated: [], qualified: [], offered: null }` and never throws. The
  route logs it (Q-62); nothing blocks (090's data note).
- Behavioural invariant: no predicate anywhere reads elapsed time. `grep -n
  "Date.now" src/coach/license.ts` returns nothing; comparisons are between
  recorded event times only (Q-77).
- Threshold entries (both live, both with `graduatesWhen`):
  `coach.offerMinClaims` — value 3, live: true, graduatesWhen: offer-only
  under Q-62 (declining costs a word, silence costs nothing), so it acts from
  day one and every evaluation is logged; the VALUE is provisional and the
  coach-offer log record resizes it. `coach.reflectionCap` — value 2, live:
  true, graduatesWhen: Q-56 bound — a cap protecting the Queue acts from
  birth; clips are logged through shadowDecision(clips=true).
</contracts>

- [ ] **Step 1:** Tests first: a Direction whose name-terms match 3 claim
  bodies qualifies; a coached one is excluded; a declined one is excluded
  forever; empty facts → empty evaluation, no throw; `licenseState` picks the
  newest of the four event kinds and returns null when the note is newer than
  everything; `somethingNew` true on unread advice, false right after a visit
  stamp newer than every fact.
- [ ] **Step 2:** Implement. Term normalization: lowercase, strip
  non-alphanumerics, keep terms of length ≥ 4; a claim is name-relevant on ≥ 1
  shared term, evidence-relevant when any cite's session is a
  direction-tagged sitting.
- [ ] **Step 3:** Append the two `THRESHOLDS` entries. Registry:
  `evaluateOffer`, `licenseState`, `somethingNew` `unwired`, reason
  `'callers are the coach routes (T9/T10) and the page module (T8)'`;
  `relevantClaims` **live from birth** — `evaluateOffer` calls it in this
  same module and the sweep counts that, so an `unwired` declaration would
  fail T5's own gate.

Run: `npx vitest run tests/coach-license.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: the licence — offers, events, and something-new, computed from disk`

---

### Task 6: Reflection follow-ups — two template questions quoting the return [NEW FILE]

**Orient:** Q-75 makes a return license the reflection follow-ups (what broke,
what surprised — 016's own words), and Q-12 requires a composed question to
contain the person's words verbatim — so this is the import-repair pattern: a
zero-LLM template around a code-verified quote, capped, deduped, into the
ordinary Queue.
**Flow position:** Step 6 of 12 (license → **reflection** → return route T10).
**Skill:** `tdd`
**Files:**
- Create: `src/coach/reflection.ts`
- Create: `tests/coach-reflection.test.ts`
- Modify: `src/registry.ts`

<contracts>
**Upstream (return route → this):** the raw return text (the person's turn,
verbatim), the quest, the capture session id, the QueueStore, a ThresholdLogFn.

```ts
export function mintReflections(input: {
  queue: QueueStore;
  quest: Quest;
  session: string;
  returnText: string;
  log: ThresholdLogFn;
}): { minted: QueueEntry[]; clipped: number };
```
- Behavioural invariant: `quotedFragment` is an exact substring of
  `returnText` — take the first complete sentence (up to 200 chars, else the
  first 200 chars cut at a word boundary) and assert
  `returnText.includes(quotedFragment)` in code before `queue.add`; a failed
  check mints nothing rather than minting an unquoted question (Q-12's
  rigidity-in-validation).
- Behavioural invariant: entries carry `source: 'quest-reflection'`,
  `quest: quest.id`, `direction: quest.direction`, `questionForm:
  'theoretical'` (→ self-observation), `sharpness: 'sharp'`, `horizon:
  'session'`, license text naming Q-75. No `target` — absent serves either
  sitting kind.
- Behavioural invariant: dedupe on (quest, session): if the queue already
  holds a `quest-reflection` entry with this quest id whose license names this
  session, mint nothing. The license string must EMBED the session id —
  `license: 'Q-75 quest return quest=<id> session=<session>'` — because the
  dedupe reads it back off disk through `queue.list()`, so it survives a
  restart instead of living in memory. The cap is
  `shadowDecision(THRESHOLDS['coach.reflectionCap'], …, log, true)` per
  question — clip the second when the cap says 1.
- The two templates, in order: `You came back with "«quote»" — what broke
  along the way that these words don't say?` and `You came back with
  "«quote»" — what surprised you?` Both are questions about the doing, never a
  verdict on it (Q-15; no failure state, Q-75).
</contracts>

- [ ] **Step 1:** Tests first: both entries land with quote as exact substring
  and all fields above; second call same (quest, session) mints zero; cap at 1
  clips one and reports it; a return whose text is one long unbroken word still
  yields a valid substring quote.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Registry: `mintReflections` `unwired`, reason
  `'caller is the return route (T10)'`.

Run: `npx vitest run tests/coach-reflection.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: reflection follow-ups — the return quoted, capped, deduped`

---

## Wave 3 — the model call and the page (SERIAL: T7 → T8; both append src/registry.ts)

### Task 7: Advise — the one model call, guarded, and structurally blind to artifacts [NEW FILE]

**Orient:** The advice note is the Coach's only agent prose reaching the person
(Q-24 constitution: Marginalia-class, choice-expanding, guilt-free), and the
one place the model runs in this slice — so the prompt input is built from a
type with no pointer field (Q-78), the output passes `adviceGuard` or nothing
is written, and the note replaces its predecessor by store construction (Q-77).
**Flow position:** Step 7 of 12 (license + store + contract → **advise** →
routes T10, fire-and-forget).
**Skill:** `tdd`
**Files:**
- Create: `src/coach/advise.ts`
- Create: `tests/coach-advise.test.ts`
- Modify: `src/registry.ts`

<contracts>
**Upstream (route → this):** the CoachStore, CoachFacts, a `Complete` (the
clerk's — `deps.clerk?.complete ?? deps.complete`), the slug, the licensing
event from `licenseState`.

```ts
export type AdviceOutcome =
  | { outcome: 'minted'; note: AdviceNote; replaced: boolean }
  | { outcome: 'withheld'; reason: string };   // 'no-claims' | 'guard:<reason>' | 'parse-failed'

export function buildAdviceInput(facts: CoachFacts, slug: string): AdvicePromptInput | null; // null = no relevant claims
export async function runCoachAdvice(deps: {
  store: CoachStore; facts: CoachFacts; complete: Complete;
  slug: string; license: CoachLicenseEvent;
}): Promise<AdviceOutcome>;
```
- Behavioural invariant: `buildAdviceInput` is the ONLY prompt assembly and it
  takes `AdvicePromptInput` fields only — claims from `relevantClaims`, quest
  acts, return prose (person's words), artifact NAMES. The pointer cannot be
  passed because no parameter accepts it (Q-78 by construction, not
  discipline). T12 double-checks against the fake model's recorded prompts.
- Behavioural invariant: no relevant claims → `withheld('no-claims')`, no
  model call at all — Q-74's acts must cite claims, and an uncitable option
  set is not composed and then discarded, it is never requested. This is the
  empty-corpus quiet path (090's data note).
- Behavioural invariant: prompt instructs 2–3 alternative concrete acts as
  JSON with claim-id cites, options never a single prescription and never
  advice about absence or pace (Q-24: dormancy is signal, never named) —
  but the GUARD, not the prompt, is what enforces shape (Q-36: freedom in
  generation, rigidity in validation). Guard failure → withheld, note
  untouched.
- Behavioural invariant: on success, `writeAdvice` replaces; `replaced` is
  true when a note existed. Declined options come from
  `store.getDirection(slug).declinedOptions` into the guard (Q-77).
</contracts>

- [ ] **Step 1:** Tests first, with a scripted fake `Complete`: happy path
  mints 3 guarded options and replaces a prior note (one file, newer
  mintedAt); model returning one option → withheld `guard:…`; garbage JSON →
  withheld `parse-failed`; zero relevant claims → withheld `no-claims` and the
  fake records ZERO calls; a declined option text in the model output is
  dropped and, at <2 survivors, withheld.
- [ ] **Step 2:** Implement. Parse with the same tolerant-JSON posture the
  harvest path uses (fenced block or bare object).
- [ ] **Step 3:** Registry: `runCoachAdvice` `unwired` (reason: routes T10);
  `buildAdviceInput` **live from birth** — `runCoachAdvice` calls it in this
  same module and the sweep counts that; flip `adviceGuard` to `live` —
  advise now calls it from `src/`.

Run: `npx vitest run tests/coach-advise.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: advise — one model call, guarded options, blind to artifacts by type`

---

### Task 8: The page and the waiting lines — server-composed prose [NEW FILE]

**Orient:** Q-76 fixes the surface: one page per coached Direction, log half
plus advice margin, and one quiet waiting-surface line only when something new
waits. The document rule makes these pages of sentences, and the cadence-line
precedent (`src/log/cadence.ts`) puts the wording server-side so it is testable
without a DOM.
**Flow position:** Step 8 of 12 (store + license → **page** → routes T9/T10 →
web T11).
**Skill:** `tdd`
**Files:**
- Create: `src/coach/page.ts`
- Create: `tests/coach-page.test.ts`
- Modify: `src/registry.ts`

<contracts>
**Downstream (page → routes → web):**
```ts
export type CoachLogEntry = {
  at: string;
  kind: 'quest-adopted' | 'quest-return' | 'quest-retired' | 'artifact' | 'sitting';
  /** One sentence, composed here. Identifier-free. */
  sentence: string;
  /** The person's own words, quoted (dark-serif ink on the page): the quest's return prose. */
  quote?: string;
};
export type CoachPage = {
  slug: string; name: string;
  /** Chronological, oldest first — a log reads down the page. */
  log: CoachLogEntry[];
  advice: { mintedAt: string; unread: boolean; options: { id: string; text: string }[] } | null;
  /** The empty-state sentence when the log is empty — quiet, never an exhortation. */
  opening: string;
};
export function buildCoachPage(facts: CoachFacts, snippets: Snippet[], slug: string): CoachPage | null; // null = not coached
export function waitingLines(facts: CoachFacts): { slug: string; sentence: string }[];  // Q-76: only where somethingNew
export function offerSentence(offer: { name: string }): string;  // Q-37 dimmed-line wording
```
- Behavioural invariant: log entries carry no ULID and no completion language;
  a dormant quest simply has no newer entries — dormancy renders as silence,
  never as a sentence (Q-24, Q-77: the Coach cannot comment on absence).
- Behavioural invariant: artifacts appear by `name` only; the pointer never
  enters a sentence (Q-78).
- Behavioural invariant: return quotes are the return-Snippets' prose
  (snippets whose `provenance.session` is a quest-tagged sitting), the
  performance-evidence view 016 names; when review has not landed them yet,
  the return sitting still logs as an entry without a quote.
- Suggested wordings (executor may tune words, not posture):
  opening — `nothing here yet — this page fills as you act`; waiting line —
  `something new waits where you are learning <name>`; offer —
  `coaching is open for <name> — a word declines`.
</contracts>

- [ ] **Step 1:** Tests first: a built page over a fixture facts object is
  chronological, quotes a return snippet, shows the artifact by name with the
  pointer string absent from the ENTIRE serialized page; un-coached slug →
  null; `waitingLines` empty when nothing is new and after a fresh visit
  stamp; empty log → the quiet opening.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Registry: `buildCoachPage`, `waitingLines`, `offerSentence`
  `unwired` (reason: routes T9/T10); flip `somethingNew` to `live` —
  `waitingLines` calls it, and an `unwired` entry with a caller fails T8's
  own gate.

Run: `npx vitest run tests/coach-page.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit** — `coach: the page and the quiet lines, composed server-side`

---

## Wave 4 — routes I

### Task 9: Coached state and the waiting offer — four routes, four kinds [MODIFY — CONTENDED FILE]

**Orient:** This is where the coached verb (Q-73 — a Direction becomes
coached "only by the person's declaration") and the live offer (Q-62) stop
being signatures: the routes are the production callers for the
store and the licence, and the offer logs every evaluation from its first
request. `src/server.ts` is the repo's most contended file and three slices
touch it before this one — re-read it, insert the coach block immediately above
the static catch-all, reword nothing.
**Flow position:** Step 9 of 12 (store + license + page → **routes I** → web
T11). T10 appends the remaining routes next wave.
**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` (append-only: one `// ── Coach (ticket 090) ──`
  block above `app.get('/*')`, ~`:1633` as of 2026-08-02)
- Modify: `src/log/format.ts` (four sentences, appended to `SENTENCES`)
- Modify: `tests/log-format.test.ts` (four `EMITTED` samples)
- Create: `tests/coach-routes.test.ts`
- Modify: `src/registry.ts` (flip `createCoachStore`, `readSittingTags`,
  `evaluateOffer`, `waitingLines`, `offerSentence` to `live` — their callers
  land here. `relevantClaims`, `somethingNew`, `buildAdviceInput`,
  `normalizeOption` are live already on same-module callers. **`licenseState`
  stays `unwired`** — its only callers are T10's `/read` and `/return`
  routes, and flipping it here would fail T9's own gate)

<contracts>
**The routes (all under the existing `/api/*` auth lock):**
- `POST /api/coach/direction { name }` → 200 `{ direction }` — declares
  coached (the person's declaration, Q-73; accepting the offer calls this
  same route — there is no second door). Emits `direction-coached`.
- `POST /api/coach/direction/:slug/uncoach` → 200 — flips the lens off,
  archives nothing. Emits `direction-uncoached`.
- `POST /api/coach/direction/:slug/decline-offer` → 200 — records
  `offerDeclinedAt`; this Direction is never evaluated again. Emits
  `coach-offer-declined`.
- `GET /api/coach/waiting` → `{ offer: { slug, name, sentence } | null,
  lines: { slug, sentence }[] }` — builds `CoachFacts` from disk, runs
  `evaluateOffer` + `waitingLines`, and emits `coach-offer` with
  `directions=N qualified=M offered=<slug|none>` on EVERY call (Q-62). Empty
  corpus: `{ offer: null, lines: [] }`, one log line, 200.

**The four kinds and their suggested sentences (Q-15: no accusation, no ids):**
| kind | sentence |
|---|---|
| `coach-offer` | qualified>0 → `offered coaching where enough has gathered`; else `looked for a direction ready for coaching and found none yet` |
| `direction-coached` | `you took up coaching on a direction` |
| `direction-uncoached` | `you set a coaching direction down` |
| `coach-offer-declined` | `you declined a coaching offer` |
</contracts>

- [ ] **Step 1:** Write `tests/coach-routes.test.ts` through `createApp` with
  the fakes the other route suites use: declare → GET waiting shows a quiet
  line only when something is new (none yet → `lines: []`); uncoach → the
  direction file still on disk (`coached: false`); decline-offer on a
  never-declared name creates the stub; GET waiting on an EMPTY vault returns
  `{offer:null, lines:[]}` and the activity log gains one `coach-offer` line
  with `qualified=0` — the 090 data-note case, asserted.
- [ ] **Step 2:** Implement the block. Build `CoachFacts` in one local helper
  inside the block (store reads + `readSittingTags(deps.vaultRoot)` +
  `claimStore.loadSlice()` claims + `vault.rebuildIndex()` snippets for the
  session map + `queue.list()`), reused by T10.
- [ ] **Step 3:** Sentences + samples for the four kinds. Stage
  `src/log/format.ts` hunk-by-hunk if it carries foreign hunks.

Run: `npx vitest run tests/coach-routes.test.ts tests/log-format.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS — including the emitted-kinds sweep finding exactly the four
new kinds sampled.

- [ ] **Step 4: Commit** — `coach: coached is a user verb, and the offer logs every evaluation`

---

## Wave 5 — routes II

### Task 10: Quests, artifacts, returns, and the note — the capture wiring [MODIFY — CONTENDED FILE]

**Orient:** The whole evidentiary design lands here: a return and an artifact
sentence go through the SAME `startBackgroundHarvest` every sitting uses, so
the person's words reach the corpus through the one review gate that exists —
and the quest tag (T4), the reflection mint (T6), and the advice mint (T7) all
acquire their production callers, which is what the wiring rule demands.
**Flow position:** Step 10 of 12 (routes I → **routes II** → web T11 →
acceptance T12).
**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` (append inside the coach block; T9 finished the
  file's wave-4 pass)
- Modify: `src/log/format.ts` (nine sentences)
- Modify: `tests/log-format.test.ts` (nine samples)
- Modify: `tests/coach-routes.test.ts` (append describe blocks; touch no
  existing case)
- Modify: `src/registry.ts` (flip `mintReflections`, `runCoachAdvice`,
  `licenseState`, `buildCoachPage` to `live` — their callers land here;
  `buildAdviceInput` has been live since T7. Nothing under `src/coach/`
  remains `unwired` after this task)

<contracts>
**The routes:**
- `GET /api/coach/:slug` → the `CoachPage`, or 404 `{ error }` when not
  coached (the lens is off — Q-73). No side effects, no log write: reading a
  page is not an agent act.
- `POST /api/coach/:slug/read` → marks advice read + `recordVisit(now)`,
  emits `coach-page-read`, then fire-and-forget: `licenseState` → if an event
  licenses (page-opened now qualifies, the note being read), `runCoachAdvice`;
  on settle emit `advice-minted` (`license=<event> options=N replaced=<bool>`)
  or `advice-withheld` (`reason=…`). The mint failing is a log line, never a
  5xx — the read already succeeded.
- `POST /api/coach/:slug/adopt { optionId }` → finds the option on the
  CURRENT note, `adoptQuest` (act = option text, cites = option cites), 200
  `{ quest }`. Emits `quest-adopted`. Unknown option id → 404 (the note was
  replaced; nothing is minted from an evaporated option — Q-74).
- `POST /api/coach/:slug/decline-option { optionId }` → `addDeclinedOption`
  with the option's text. Emits `coach-option-declined`.
- `POST /api/coach/quest/:id/return { text, channel? }` → the `/api/unprompted`
  template (`src/server.ts:1203-1238`) with three differences:
  `startTranscript` meta carries `quest: id, direction: quest.direction`
  (T4's seam — THIS is its caller); protocol `'quest-return'`;
  after `startBackgroundHarvest`, call `mintReflections` and then the same
  fire-and-forget advice attempt as `/read`. Emits `quest-returned`
  (`quest= session= chars=` — length, never content) and `reflection-minted`.
- `POST /api/coach/quest/:id/retire` → `retireQuest`, 200. Emits
  `quest-retired`. No reason required, no confirmation step — the person's
  verb (Q-75).
- `POST /api/coach/:slug/artifact { pointer, name, sentence }` → validates all
  three non-empty; captures `sentence` through the unprompted template with
  meta `direction: slug`, protocol `'artifact'`; `declareArtifact` with the
  capture's session as `sentenceSession`; fire-and-forget advice. Emits
  `artifact-declared` (`direction= named=true` — the POINTER never enters a
  detail line: the Activity JSONL is surfaced, and a path is content).
- Behavioural invariant: no route deletes, no route re-offers, no route runs
  on a timer. Every write above happens because a request carried it.

**The nine kinds and suggested sentences:**
| kind | sentence |
|---|---|
| `coach-page-read` | `you read a coach page` |
| `quest-adopted` | `you took up a quest` |
| `coach-option-declined` | `you set an option aside` |
| `quest-returned` | `you came back with something for a quest` |
| `quest-retired` | `you retired a quest` |
| `reflection-minted` | `minted N reflection questions` (via `count`) |
| `advice-minted` | `left a fresh note on a coach page` |
| `advice-withheld` | `held a coach note back for want of grounded options` |
| `artifact-declared` | `you declared an artifact by the name you gave it` |
</contracts>

- [ ] **Step 1:** Append tests: the full loop with a scripted fake model —
  declare → seed a note by driving `/read` with facts that license → adopt →
  `return` leaves (a) a transcript on disk whose frontmatter carries
  `quest` and `direction` (T4 wired — assert the FILE, not the call), (b) two
  `quest-reflection` entries whose `quotedFragment` is a substring of the
  return text and which carry `quest`, (c) a pending harvest; artifact route
  leaves a record whose pointer appears in NO model prompt recorded by the
  fake and in NO activity detail line; retire flips `retiredAt`; adopt on a
  replaced note's option id → 404; declined option text absent from the next
  minted note.
- [ ] **Step 2:** Implement the routes.
- [ ] **Step 3:** Sentences + samples; registry flips.

Run: `npx vitest run tests/coach-routes.test.ts tests/log-format.test.ts tests/mechanism-registry.test.ts && npx tsc --noEmit`
Expected: PASS; `grep -rn "unwired" src/registry.ts | grep coach` returns
nothing.

- [ ] **Step 4: Commit** — `coach: quests, returns, artifacts — the person's words through the ordinary gate`

---

## Wave 6 — the surface

### Task 11: The Coach page and the waiting lines, rendered [NEW FILE + CONTENDED FILES]

**Orient:** Q-76 and the document rule decide everything visual: the page is a
page of text — log sentences with the person's return quotes in dark serif,
advice as dimmed margin options with three small words (take up · not this ·
leave it), no cards, no chips, no counts — and the waiting surface gains at
most one dimmed offer line plus one quiet line per coached Direction with
something new.
**Flow position:** Step 11 of 12 (routes → **web** → acceptance). `web/main.ts`
and `web/style.css` were last touched by the composition slice's waves —
re-read, append.
**Skill:** `none` (DOM; pure helpers tested — see Open Questions on the
harness)
**Files:**
- Create: `web/coach.ts` (renderer with injected `api`/`el` deps, the
  `import-review.ts` pattern)
- Modify: `web/main.ts` (append: `Screen` union += `'coach'` (~`:149`), one
  render case (~`:195-201`), the waiting-surface additions in `renderWaiting`
  (~`:1449` — after the cadence line: offer line + quiet lines from
  `GET /api/coach/waiting`), nav wiring into `renderCoach` — **plus ONE named
  mid-file edit: `isReadPath` (~`:228-237`), Step 1 below**)
- Modify: `web/style.css` (append `.coach-*` rules; advice options reuse the
  dimmed agent-ink treatment the wiki's marginalia uses — all agent prose
  visually agent-plane, Q-76)
- Create: `tests/coach-surface.test.ts` (pure text-assembly helpers exported
  from `web/coach.ts`; no registry entries — `web/` is not swept)

- [ ] **Step 1: The one mid-file edit this plan makes to `web/main.ts` —
  `isReadPath`.** `api()` infers the HTTP verb from `isReadPath`
  (`web/main.ts:228-237`); without an entry, the coach page's GETs go out as
  POSTs and 404. The coach API mixes verbs under one prefix, so a bare
  `GET_PREFIXES` entry would be wrong the other way (it would turn the write
  routes into GETs). Follow the `/api/wiki` exact-match style already in that
  function (`web/main.ts:231-233`):

```ts
// Coach reads: the waiting evaluation, and the page GET. Every other
// /api/coach/* path is a write. 'waiting', 'direction' and 'quest' are
// reserved in slugFor (src/coach/contract.ts, T2), so a one-segment path
// that is none of them can only be a page slug.
if (path === '/api/coach/waiting') return true;
if (/^\/api\/coach\/(?!direction$|quest$|waiting$)[^/]+$/.test(path)) return true;
```

  This is the ONE carve-out from this plan's append-only rule for
  `web/main.ts` (§5 rule 6 names it), so it cannot be mistaken for drift;
  everything else this task does to the file appends.

- [ ] **Step 2:** `web/coach.ts`: `renderCoachPage(deps, slug)` — fetch
  `GET /api/coach/:slug`, paint log then margin, POST `/read` after paint
  (the read is an act; the paint is not), wire the three option words to
  `/adopt`, `/decline-option`, and nothing (leave it = close the page —
  silence does nothing, Q-62). A return box under an adopted quest posts
  `/return`; an artifact form (pointer, name, one sentence) posts
  `/artifact`; `retire` is one small margin word on an adopted quest.
- [ ] **Step 3:** `web/main.ts` appends; the offer line's decline word posts
  `/decline-offer`, its accept word posts `/direction` then navigates to the
  page.
- [ ] **Step 4:** Extract and test the pure helpers (option rows, log line
  assembly) in `tests/coach-surface.test.ts`.

Run: `npx vitest run tests/coach-surface.test.ts && npx tsc --noEmit`
Expected: PASS. Then a by-use check: boot the app against a scratch vault,
declare a direction through the UI, and confirm the page renders its quiet
opening and the waiting surface shows nothing coach-flavored until something
is new.

- [ ] **Step 5: Commit** — `coach: the page — log in the person's ink, advice in the margin`

---

## Wave 7 — acceptance

### Task 12: The whole loop, and the four impossibilities, as tests [NEW FILE]

**Orient:** The slice's hypothesis is 016's unity sentence — every Coach
mechanism is an offer or the person's own captured act — and this suite proves
it end to end through `createApp`, plus proves the four things the design makes
impossible: a second unread note, a re-offered decline, a pointer reaching the
model, and a guilt artifact (rate/deadline/failure) existing anywhere.
**Flow position:** Step 12 of 12.
**Skill:** `tdd`
**Files:**
- Create: `tests/coach-acceptance.test.ts`

- [ ] **Step 1:** The loop, one describe block, scripted fake model: declare →
  license via artifact → note minted → adopt → return → review the pending
  harvest through the EXISTING decisions route → the return-Snippet's
  `provenance.session` resolves to a quest-tagged transcript (Q-75's
  provenance, asserted from disk) → the Coach page quotes it → reflection
  entries answered → retire → uncoach → page 404s, files intact.
- [ ] **Step 2:** The impossibilities: (a) two licensing events in a row leave
  ONE advice file (Q-77); (b) after `decline-offer`, fifty waiting evaluations
  never offer that Direction again, and each wrote a `coach-offer` line
  (Q-62's record); (c) the fake model's every recorded prompt, joined, does
  not contain the pointer string (Q-78); (d) serialized coach records match no
  key in `/rate|streak|deadline|complete|fail/i` (Q-24/Q-75).
- [ ] **Step 3:** The empty-corpus block (090's data note): a fresh vault —
  every coach GET answers 200-shaped quiet, the offer logs `qualified=0`, no
  route blocks, no model call fires (fake records zero).

Run: `npx vitest run tests/coach-acceptance.test.ts && npx vitest run && npx tsc --noEmit`
Expected: acceptance green; the FULL suite green (no pre-existing test
touched by this slice went red); tsc clean.

- [ ] **Step 4: Commit** — `coach: the loop proven — offers and the person's own words, nothing else`

---

## 7. Execution Waves

```
Wave 0: T1 ∥ T2          (disjoint files)
Wave 1: T3 ∥ T4          (disjoint files)
Wave 2: T5 → T6          (SERIAL — both append src/registry.ts; T6 reads T5's coach.reflectionCap)
Wave 3: T7 → T8          (SERIAL — both append src/registry.ts)
Wave 4: T9               (src/server.ts, src/log/format.ts — single owner)
Wave 5: T10              (the same two files, next wave — single owner)
Wave 6: T11              (web/*)
Wave 7: T12              (tests only)
```

The serial pairs follow the seeding exemplar's convention: a shared file
(`src/registry.ts`) gives a wave an internal order instead of splitting into
more waves. Wave 2's order is ALSO a real compile dependency — T6 reads
`THRESHOLDS['coach.reflectionCap']`, which T5 declares. Do not collapse the
serial pairs into parallel dispatch.

**Sequencing against the rest of the session:** ticket 090 queues after the
ruled sequence (058 → 010 → 012 → 014-Seeding), and the composition slice's
ownership table shows its T6/T10/T12 owning `src/server.ts` and its T7/T12
owning `web/main.ts` across its waves. **No Coach wave may start until every
prior slice's waves have landed**; T9–T11 in particular must re-read
`src/server.ts` and `web/main.ts` as they then stand. Every Coach edit to a
contended file is append-only, so landing after is sufficient — there is
nothing to merge, only somewhere later in the file to stand.

### File ownership (one owner per file per wave; serial waves ordered)

| File | Wave | Owning task | Rule |
|---|---|---|---|
| `src/types.ts` | 0 | T1 only | Append the member and the field. Contended (058/012/014 patched it) — re-read first. |
| `src/queue/queue.ts` | 0 | T1 only | Two guarded lines. Contended. |
| `src/queue/source-label.ts` | 0 | T1 only | One label; compile-forced. Contended. |
| `tests/queue-source-label.test.ts`, `tests/queue.test.ts` | 0 | T1 only | Extend; touch no existing case. |
| `src/coach/contract.ts`, `tests/coach-contract.test.ts` | 0 | T2 only | |
| `src/registry.ts` | 0 | T2 only | Coach block appended. Contended. |
| `src/coach/store.ts`, `tests/coach-store.test.ts` | 1 | T3 only | |
| `src/registry.ts` | 1 | T3 only | |
| `src/vault/vault.ts`, `tests/vault.test.ts` | 1 | T4 only | Two guarded frontmatter lines; nothing else in the file. |
| `src/coach/license.ts`, `tests/coach-license.test.ts` | 2 | T5 only | |
| `src/wiki/thresholds.ts` | 2 | T5 only | Two entries with `graduatesWhen`. Contended. |
| `src/coach/reflection.ts`, `tests/coach-reflection.test.ts` | 2 | T6 only | |
| `src/registry.ts` | 2 | T5 then T6 (serial) | Each appends its own block; T6 rebases on T5's commit. |
| `src/coach/advise.ts`, `tests/coach-advise.test.ts` | 3 | T7 only | |
| `src/coach/page.ts`, `tests/coach-page.test.ts` | 3 | T8 only | |
| `src/registry.ts` | 3 | T7 then T8 (serial) | As Wave 2. |
| `src/server.ts` | 4 | T9 only | One appended block above the catch-all. Heavily contended — re-read as landed. |
| `src/log/format.ts`, `tests/log-format.test.ts` | 4 | T9 only | Four kinds. Stage hunk-by-hunk if dirty. |
| `tests/coach-routes.test.ts` | 4 | T9 only | New file. |
| `src/registry.ts` | 4 | T9 only | Flips only. |
| `src/server.ts` | 5 | T10 only | Append inside the coach block. T9 is finished with it. |
| `src/log/format.ts`, `tests/log-format.test.ts` | 5 | T10 only | Nine kinds. |
| `tests/coach-routes.test.ts` | 5 | T10 only | Append blocks; touch no existing case. |
| `src/registry.ts` | 5 | T10 only | Flips only; zero coach `unwired` remain. |
| `web/coach.ts`, `web/main.ts`, `web/style.css`, `tests/coach-surface.test.ts` | 6 | T11 only | `web/main.ts`/`style.css` contended (composition T7/T12) — append only, EXCEPT the named `isReadPath` edit (T11 Step 1). |
| `tests/coach-acceptance.test.ts` | 7 | T12 only | |

**Read freely, write never:** `src/harvester/harvester.ts` (ticket 091 editing
NOW), `src/elicitor/elicitor.ts`, `src/clerk/docket.ts`,
`src/clerk/composed.ts`, `src/wiki/store.ts`, `src/wiki/contract.ts`,
`src/log/activity.ts`, `src/llm.ts`, `docs/interface-references.md`, anything
under `vault/`. A task that must edit one of these has found a scope change:
stop and report.

---

## 8. Open Questions

### Blocking — answer before the wave named

- **T5 (Wave 2) — is name-term overlap an acceptable stand-in for "a Direction
  accumulates skill-claims" (Q-73)?** Verified: Claims carry no direction, no
  skill marker; `QueueEntry.direction` is written by nothing; true skill-claims
  (citing return-/description-Snippets, Q-78) cannot exist before coaching
  begins, so a strict reading gives the offer an empty input forever — the
  inert-mechanism failure this repo has hit six times. Recommended default:
  `relevantClaims` = name-term overlap ∪ evidence-link, the same ruling
  Seeding's Reach took for the same missing noun, converging on the Q-78 link
  as returns produce claims. Rival: ship the evaluator strict-and-silent until
  Directions reify — rejected; Q-62 ships offers live precisely so the record
  accrues. The ticket's own data note ("offers fire only as Directions
  mature") reads as endorsing the quiet-until-mature behavior either way.
- **T7 (Wave 3) — may `page-opened` license a mint on every read?** Q-77 names
  it a licensing event with no cap besides one-unread-note, so a model call per
  page read is canon-compliant but the costliest reading. Recommended default:
  ship it as written (the call is background, the note replaced, the person
  caused it); if RESULTS show visit-driven mints dominating, narrowing
  `page-opened` to fire only when other events also stand is a one-line
  `licenseState` change with evidence behind it.
- **T10 (Wave 5) — does the pending-harvest review surface cope with origin
  `'unprompted'` for quest returns, or does it need a `'quest-return'`
  origin?** The pending record's `origin` union is `'harvest' | 'unprompted'`
  and the review surface may label from it. Recommended default: reuse
  `'unprompted'` (the review is about the prose, and a review that announces
  "this was a quest return" grades the return — Q-15 adjacent); the quest tag
  lives on the transcript regardless. If the review surface turns out to
  branch on origin in a way that misleads, widening the union is a small
  ticket, not a silent edit.
- **T11 (Wave 6) — does a DOM test harness exist by then?** Seeding's plan
  verified none exists and 058's T10 may have introduced one. Recommended
  default: if a harness landed, use it; if not, export pure text-assembly
  helpers from `web/coach.ts` and test those, leaving paint to the by-use run
  — Seeding's ruling, unchanged.

### Exploratory — answerable during implementation

- **T5:** is term length ≥ 4 the right normalization floor for direction-name
  terms? (Assumed yes, matching the spirit of Reach's term overlap; a
  direction named "go" will under-match and that is the safe direction.)
- **T6:** is `questionForm: 'theoretical'` right for reflection questions?
  (Assumed — "what broke" elicits self-observation; the canon mapping fits
  none of the reflection pair perfectly.)
- **T7:** should the advice call get its own `LlmRole` (`'coach'`) with env
  overrides, instead of riding the clerk's `Complete`? (Assumed no for this
  slice — one background model is the current posture; a coach role is a
  two-line `llm.ts` change when someone wants a different model, and `llm.ts`
  is not in this plan's ownership.)
- **T9/T10:** exact wording of the thirteen sentences. (The tables give
  suggestions; Q-15 and the existing `SENTENCES` voice govern; the samples in
  `tests/log-format.test.ts` pin whatever is chosen.)
- **Follow-up, not a task:** should `Provenance` gain a `quest?` field so the
  stamp sits on the snippet rather than the sitting? That is a one-field patch
  to `src/types.ts` plus `src/harvester/harvester.ts:701/:743` — the file
  ticket 091 holds. If canon wants it, file a ticket after 091 lands; this
  plan's derived linkage keeps working either way.

### Assumptions, stated so they can be checked

1. All contended-file line refs are 2026-08-02 readings; 058-remainder, 010,
   012 and 014-Seeding land before any Coach wave and every ref must be
   re-resolved at dispatch.
2. `startBackgroundHarvest` remains an inner function of `createApp` reachable
   from appended routes, with the `origin: 'harvest' | 'unprompted'` shape
   (`src/server.ts:1035-1071`).
3. `claimStore.loadSlice()` exposes the claims a route can hand to
   `CoachFacts` (`src/server.ts:491, 1510` use it today).
4. `THRESHOLDS` accepts new keys without migration (Seeding assumption 4,
   still true at `src/wiki/thresholds.ts:65`).
5. `tests/mechanism-registry.test.ts` sweeps `src/` only, so `web/coach.ts`
   needs no registry entries (Seeding assumption 8).
6. The emitted-kinds sweep follows `serverEmit` by parameter position
   (`tests/emitted-kinds.ts`), so kinds emitted only from the new routes are
   found mechanically.
7. `tests/vault.test.ts` exists (named by `src/vault/vault.ts:28`'s comment).

---

## 9. Per-Wave Verification

| Wave | Gate |
|---|---|
| 0 | `npx tsc --noEmit` clean, **failing at `SOURCE_LABELS` before T1's label lands**; `tests/queue-source-label.test.ts` green with `'quest-reflection'` in `SOURCES`; `tests/coach-contract.test.ts` green; registry sweep green. |
| 1 | `tests/coach-store.test.ts` green (one advice file after two writes; nothing deleted on uncoach); `tests/vault.test.ts` green including absent-stays-absent; registry sweep green. |
| 2 | `tests/coach-license.test.ts` green including the empty-corpus evaluation; `tests/coach-reflection.test.ts` green including the substring assertion and the (quest, session) dedupe; both thresholds present with `graduatesWhen`. |
| 3 | `tests/coach-advise.test.ts` green including zero-model-calls on no-claims and the declined-option drop; `tests/coach-page.test.ts` green including pointer-absent-from-page. |
| 4 | `tests/coach-routes.test.ts` green; `tests/log-format.test.ts` green with the four kinds sampled; the empty-vault `coach-offer qualified=0` line asserted — 090's data note is now a test. |
| 5 | Routes suite green whole; a transcript on disk carries `quest`+`direction` **written through the route** (T4 stops being a signature); `grep -rn "unwired" src/registry.ts \| grep coach` empty. |
| 6 | `tests/coach-surface.test.ts` green; by-use run: declare → quiet page → nothing on the waiting surface until something is new. |
| 7 | `npx vitest run` — full suite green; `npx tsc --noEmit` clean; acceptance's four impossibilities all asserted. |

---

## 10. Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/types.ts` | patch | `'quest-reflection'` |
| `src/queue/queue.ts` | patch | `fm.quest = entry.quest` |
| `src/queue/source-label.ts` | patch | `'quest-reflection': 'from your own words'` |
| `tests/queue-source-label.test.ts` | patch | `'quest-reflection'` |
| `tests/queue.test.ts` | patch | `quest:` |
| `src/coach/contract.ts` | create | `export type AdvicePromptInput` |
| `tests/coach-contract.test.ts` | create | `adviceGuard` |
| `src/coach/store.ts` | create | `export function createCoachStore` |
| `tests/coach-store.test.ts` | create | `createCoachStore` |
| `src/vault/vault.ts` | patch | `meta.quest` |
| `tests/vault.test.ts` | patch | `quest` |
| `src/coach/license.ts` | create | `export function evaluateOffer` |
| `tests/coach-license.test.ts` | create | `evaluateOffer` |
| `src/wiki/thresholds.ts` | patch | `coach.offerMinClaims` |
| `src/coach/reflection.ts` | create | `export function mintReflections` |
| `tests/coach-reflection.test.ts` | create | `mintReflections` |
| `src/coach/advise.ts` | create | `export async function runCoachAdvice` |
| `tests/coach-advise.test.ts` | create | `runCoachAdvice` |
| `src/coach/page.ts` | create | `export function buildCoachPage` |
| `tests/coach-page.test.ts` | create | `buildCoachPage` |
| `src/server.ts` | patch | `/api/coach/waiting` |
| `src/log/format.ts` | patch | `'coach-offer'` |
| `tests/log-format.test.ts` | patch | `direction-coached` |
| `tests/coach-routes.test.ts` | create | `/api/coach/direction` |
| `src/registry.ts` | patch | `src/coach/store` |
| `web/coach.ts` | create | `renderCoachPage` |
| `web/main.ts` | patch | `'coach'` |
| `web/style.css` | patch | `.coach-` |
| `tests/coach-surface.test.ts` | create | `coach` |
| `tests/coach-acceptance.test.ts` | create | `impossibilit` |
<!-- PLAN_MANIFEST_END -->

---

## 11. Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-73 | coached is user-declared; agent may only offer; un-coaching archives nothing | T3, T9, T10 (404 on lens-off), T12; Blocking OQ 1 |
| Q-74 | quest offered as a set of 2–3 cited acts; adoption mints; no deadlines; quest text Marginalia-class | T2 (guard), T7, T10 (adopt/evaporated option), T12 |
| Q-75 | lifecycle offered→adopted→returned→retired; return is ordinary capture with quest provenance; no failure state or completion rate | T1, T2 (derived status), T4, T6, T10, T12 |
| Q-76 | one page per coached Direction; quiet waiting line only when new; no global tab | T5 (`somethingNew`), T8, T11; §2 |
| Q-77 | advice event-licensed only; one unread note, replaced; declined never re-offered | T2, T3 (replace-only write), T5 (`licenseState`), T7, T9 (decline-offer), T12; Blocking OQ 2 |
| Q-78 | artifact = declared pointer + person's sentence; model never opens it; mention by given name only | T2 (`AdvicePromptInput`), T7, T8, T10, T12 |
| Q-24 | advice constitution: Marginalia-class, in-app, choice-expanding, guilt-free | §2, §5 rule 8, T2, T7, T8, T12 |
| Q-33 | analogy only — `attested` is set solely by a user verb; the coach verbs cite Q-73 (coached is the person's declaration) and Q-75 (retired is the person's verb) directly | T9, T10 (analogy) |
| Q-37 | offer shape: one dimmed passive line on the waiting surface | T8 (`offerSentence`), T9, T11 |
| Q-62 | offer-only mechanisms ship LIVE, logging every evaluation | T5 (live thresholds), T9 (`coach-offer` every call), T12(b); §5 rule 4 |
| Q-35 | selection mechanisms shadow-first (as amended by Q-56/Q-62) | T5 threshold declarations and their `graduatesWhen` sentences |
| Q-56 | bounds ship live; clips logged | T5/T6 (`coach.reflectionCap` via `shadowDecision(clips=true)`) |
| Q-43 | decline discipline: recorded signal, never re-asked | Shaping decision 6, T9, T10 |
| Q-12 | composed questions quote the person verbatim, code-verified | T6 |
| Q-15 | never accuse or verify; labels and sentences announce nothing | T1 (label), T9/T10 sentence tables, T6 templates |
| Q-40 | all user prose becomes a Snippet | T10 (return + artifact sentence through the ordinary gate) |
| Q-22 | in-app only; ignoring an offer is never escalated | §2 (no notifications), T11 (leave-it = nothing) |
| Q-23 | the Activity Log is the audit trail; every act logged | §5 rule 5, T9, T10 |
| Q-3 | markdown is truth; derived is derived and recomputed | §6 storage, T3, shaping decisions 2–3 |

---

## Shape Changes

| Date | Role | Finding | Summary |
|---|---|---|---|
| 2026-08-02 | author | — | Initial plan. |
| 2026-08-02 | reviewer r1 | 2 blocking, 9 advisory | Registry status choreography red at four task gates (unwired-with-same-module-caller, live-before-caller); `isReadPath` would send the Coach page GETs as POSTs. Advisories: Q-33 re-cited to Q-73/Q-75, slug reservations, session-id in the T6 license, dead queue-arm stated, landmark drift. |
| 2026-08-02 | author r1 | fixes applied | Three entries born live on same-module callers; flips moved to the tasks whose callers land; T11 Step 1 names the one mid-file `isReadPath` edit with the carve-out in §5; all advisories applied. |
| 2026-08-02 | reviewer r2 | APPROVED | Every gate simulated green; the GET-rule regex tested against every route the plan defines; nothing previously verified broke. |
