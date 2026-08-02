# It Remembers You (Second Slice) Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A returning user's session builds on prior sessions: openers composed from their past snippets, mid-session juxtapositions when the vault echoes or clashes with what they just said, a durable question Queue, a background Clerk docket, Target-aware protocols, a session budget, and the two-move close.

**Architecture:** Three new modules — `src/index/lexical.ts` (derived, rebuildable phrase-echo index), `src/queue/queue.ts` (durable markdown-backed question queue), `src/clerk/` (composed-question generation + docket loop) — plus surgical extensions to the elicitor (opening draw, per-turn resonance, budget, close), protocols (Target-keyed families), server, and web UI. All new invariants are code-enforced, mirroring slice 1: a composed question must contain its quoted snippet fragment as an exact substring (Q-12), and selection is constraints-then-chance (Q-13). (Q-18's Randomizer draws are staged for a later slice — no task here implements them.)

**Tech Stack:** unchanged — TypeScript, Hono, Vite, Vitest, `@mariozechner/pi-ai` → llama.cpp `bonsai-27b` at `http://192.168.0.229:8088/v1`. No embeddings in this slice (Q-17 stages them with the Clerk's semantic channel later).

---

## Flow Map

```
docket (background) ──stocks──▶ queue ──opening draw──▶ exchange ──per-turn──▶ resonance
                                                            │                      │
                                                            │◀── juxtapose/compose ┘
                                                            ▼
                                             budget/saturation → two-move close → harvest (existing)
                                                                                      │
                                             vault ◀── snippets ── readings ──────────┘
                                               └──── reindex (docket) ────▶ lexical index
```

- **lexical index**: derived from vault snippets; finds shared phrases between a query text and past snippets; rebuildable, never source of truth (Q-3).
- **queue**: markdown files under `vault/queue/`; entries carry source, license, question, optional cited snippet, Mode needs, sharpness, horizon, status.
- **docket**: runs in-process on server start and after every harvest; jobs: reindex, mint composed-opener candidates from recent snippets, mint still-true candidates from aged/seeded material, expire stale entries.
- **exchange additions**: session opening draws from queue (composed opener preferred when licensed, bank fallback); every user turn runs resonance; echo/clash offers a juxtaposition; budget counts questions; close runs open-door then bookmark; bookmark answer becomes a user-declared queue entry.
- **Target**: `mode.target: 'self' | 'domain'` selects the protocol family (reflective-interview + sounding-lite for self; CDM + laddered-grid for domain).

## File Structure

```
src/
  types.ts               — extend: Target, QueueEntry, ResonanceHit, RedLight, DocketReport (Wave 0)
  index/lexical.ts       — buildIndex(snippets), resonate(index, text, k?): ResonanceHit[]
  queue/queue.ts         — QueueStore: add/list/draw/markAsked/markAnswered/defer/expire
  clerk/composed.ts      — redLights(turn), composeFollowUp, composeJuxtaposition, composeOpener
                           (all LLM calls substring-validated, Q-12)
  clerk/docket.ts        — runDocket(deps): DocketReport (all collaborators injected; see Task 5)
  elicitor/protocol.ts   — extend: PROTOCOLS keyed by Target; CDM + laddered-grid prompts
  elicitor/elicitor.ts   — extend: opening draw, per-turn resonance hook, budget, close phases
  server.ts              — extend: GET /api/queue, docket trigger post-harvest + on boot
web/main.ts, style.css   — Target toggle; juxtaposition rendering; close-flow UI; waiting surface
tests/
  lexical.test.ts, queue.test.ts, composed.test.ts, docket.test.ts
  elicitor.test.ts (extend), e2e.test.ts (extend)
```

`vault/queue/<ulid>.md` frontmatter: `{id, status: pending|asked|answered|deferred|expired, source: composed|still-true|user-declared, license, question, questionForm, cites?: ["<snippetId>@<v>"], quotedFragment?, modeNeeds?: {minMinutes?, energy?}, sharpness: weak|sharp, direction?, horizon: now|session|days, created}`; body = optional rationale (agent prose, Marginalia-class, never enters the exchange). The source union is the three literals only — exhaustiveness checking is the point. `gap-fill`, `random-resurface`, `random-deck` are staged for later slices and get added to the union when their minting task exists.

---

### Task 1: Contracts — extended domain types [CHANGE SITE]

**Orient:** Every Wave-1 module compiles against these; they encode Q-12/Q-13/Q-18/Q-19/Q-20 so invariants are visible in signatures.
**Flow position:** Wave 0 — contract producer for all later tasks.

<contracts>
**Downstream (types → all modules):**
- `type Target = 'self' | 'domain'` — `Mode` gains `target?: Target` (OPTIONAL — ~15 existing Mode literals in tests/web must stay green); normalized to `'self'` inside `startSession` and at the `/api/session` boundary, nowhere else
- NOTE for every task: `exactOptionalPropertyTypes: true` is on — never assign `undefined` to an optional field; conditionally spread instead (see elicitor.ts:46 for the established pattern). `QueueEntry`'s five optional fields all trip this.
- `type QueueDraft = Omit<QueueEntry, 'id'|'created'|'status'>` — what producers hand to the store; `id`, `created`, `status` are minted by `QueueStore.add` alone
- `SessionState` extended here (Task 6 may NOT edit types.ts): deps become `{complete: Complete; vault: Vault; queue: QueueStore; index: LexicalIndex}`, plus `questionCount: number` and `phase: 'open'|'mid'|'closing-door'|'closing-bookmark'` (the elicitor must know the next user turn answers the bookmark)
- `type LexicalIndex` — opaque structural type declared here, implemented in Task 2
- `type ResonanceHit = { snippetId: string; version: number; sharedPhrase: string; score: number; snippetText: string }` — `sharedPhrase` is an exact substring of BOTH the query text and the snippet (that is what makes a juxtaposition quotable)
- `type RedLight = { kind: 'odd-term'|'unexplored-referent'|'abstraction-no-episode'|'pole-no-contrast'|'cause-no-event'; phrase: string }` — `phrase` is an exact substring of the user turn
- `type QueueEntry = { id, status, source, license: string, question, questionForm, cites?, quotedFragment?, modeNeeds?, sharpness: 'weak'|'sharp', direction?, horizon: 'now'|'session'|'days', created }` (shapes per File Structure frontmatter)
- `interface QueueStore { add(e: QueueDraft): QueueEntry; list(filter?): QueueEntry[]; draw(mode: Mode, phase: 'opening'|'mid'|'late'): QueueEntry|null; markAsked(id): void; markAnswered(id): void; defer(id): void; expire(olderThanDays: number): number }`
- `type DocketReport = { reindexed: number; minted: QueueEntry[]; expired: number; index: LexicalIndex }` — the docket returns the rebuilt index; the server holds the latest report's index and passes it to `startSession`. One owner, no staleness.
- Behavioral invariant: any composed question text is untrusted until code verifies it contains its `quotedFragment` verbatim (Q-12) — same posture as `CutProposal` (Q-1)
</contracts>

**Skill:** `none`
**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the types above; extend `Mode` with `target?: Target` (optional — normalization happens in `startSession` and `/api/session` only)**
- [ ] **Step 2: Verify** — Run: `npx tsc --noEmit` Expected: exit 0 (existing modules unaffected because `target` is optional)
- [ ] **Step 3: Commit** — `git commit -am "feat: slice-2 domain types"`

### Task 2: Lexical resonance index [CHANGE SITE]

**Orient:** The vault becomes a participant in live conversation; this index is how the archive speaks (Q-17 lexical stage). Derived and rebuildable, never truth (Q-3).
**Flow position:** `vault → lexical index → resonance` — upstream vault read API (Task 3 of slice 1), downstream `resonate()` consumed by elicitor (Task 6) and docket (Task 5).

<contracts>
**Upstream:** the vault's existing snippet read (latest version per snippet — old-version indexing is a later slice; do not extend Vault).
**Downstream:** `buildIndex(snippets: Snippet[]): LexicalIndex`; `resonate(index: LexicalIndex, text: string, k?: number): ResonanceHit[]` — scores by shared-phrase length and rarity (longest rare n-gram wins; stopword-only matches excluded); `sharedPhrase` verbatim in both texts; deterministic given same inputs. Diversity rule (the loudest-thought problem): overfetch 3×k internally, then return at most one hit per snippet id and drop hits whose snippet texts are near-identical to an already-returned hit (>80% shared content words) — ten facets of the thinking, never ten versions of the loudest thought.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/index/lexical.ts`
- Test: `tests/lexical.test.ts`

- [ ] **Step 1: Failing tests** — shared 3+-word phrase found across texts with different surroundings; stopword-only overlap ("and then the") yields no hit; rarer phrase outranks common one; `sharedPhrase` is verbatim substring of both query and snippet (assert with `String.includes` both ways); empty vault → empty results; rebuilt index from same files gives identical results; two near-identical snippets (restatement-like) yield ONE hit, not two (diversity rule)
- [ ] **Step 2: Run** — Run: `npx vitest run tests/lexical.test.ts` Expected: FAIL
- [ ] **Step 3: Implement** (pure functions, no LLM, no I/O — caller supplies snippets)
- [ ] **Step 4: Run** — Run: `npx vitest run tests/lexical.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: lexical resonance index"` (add only your files)

### Task 3: Durable Queue store [CHANGE SITE]

**Orient:** Questions stop dying with the session (Q-13, Q-20); markdown under `vault/queue/` is the truth (Q-3).
**Flow position:** `docket → queue → elicitor opening/mid draws`.

<contracts>
**Downstream:** `QueueStore` per Task 1 (`add` takes `QueueDraft`; the store mints id/created/status). `draw(mode, phase)` implements constraints-then-chance (Q-13): filter by status=pending, `modeNeeds` vs mode (hard — a 10-minute low-energy mode excludes entries needing more), phase vs sharpness (`opening` and `mid` → weak only; `late` → sharp allowed), horizon ('days' entries — expeditions — are never drawn into an exchange; they only appear on the waiting surface); then top-k (k=3, sort key: user-declared source first, then recency of creation) and uniform random pick. No scoring function.
- `expire(olderThanDays)` moves old PENDING entries to expired and returns the count — EXCEPT entries with `source: 'user-declared'`, which never expire. This rule lives here, not in the docket.
- Behavioral invariant: `draw` never returns the same entry twice without an intervening `defer` (markAsked immediately).
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/queue/queue.ts`
- Test: `tests/queue.test.ts`

- [ ] **Step 1: Failing tests** — add/list roundtrip via tmp vault dir; draw respects mode hard-filter; opening draw never returns sharp; days-horizon never drawn; drawn entry marked asked and not re-drawn; user-declared source outranks (present in top-k ahead of agent-minted of equal recency); files survive a new QueueStore instance (durability); expire moves old pending agent-minted entries to expired and reports count; user-declared entries SURVIVE expiry
- [ ] **Step 2: Run** — Run: `npx vitest run tests/queue.test.ts` Expected: FAIL (module missing)
- [ ] **Step 3: Implement** (gray-matter, ulid; reuse vault-root injection pattern from slice 1)
- [ ] **Step 4: Run** — Run: `npx vitest run tests/queue.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: durable question queue"`

### Task 4: Composed questions — red lights, follow-ups, juxtaposition, openers [CHANGE SITE]

**Orient:** The unbounded question source (Ashby) and the product's heart for slice 2; Q-12 is enforced here in code exactly as Q-1 is enforced in the harvester.
**Flow position:** `elicitor turn → redLights/resonance → clerk/composed → next question`; also `docket → composeOpener → queue`.

<contracts>
**Upstream:** user `Turn`, `ResonanceHit[]`, prior snippets.
**Downstream:**
- `redLights(turnText: string, complete: Complete): Promise<RedLight[]>` — LLM-assisted detection; each returned `phrase` code-verified as substring of the turn, others dropped with a warning
- `composeFollowUp(turnText, light: RedLight, complete): Promise<string|null>` — returns question containing `light.phrase` verbatim (code-checked; one retry with corrective prompt, then null)
- `composeJuxtaposition(turnText, hit: ResonanceHit, complete): Promise<string|null>` — question containing BOTH the live fragment and the past `sharedPhrase` verbatim, plus the snippet's date framing; same check-retry-null discipline
- `composeOpener(snippet: Snippet, complete): Promise<QueueDraft|null>` — "return to a prior snippet" opener quoting it verbatim; draft carries `cites: [id@v]`, `quotedFragment`, source 'composed', sharpness 'weak' (the QueueStore mints id/created/status on add)
- `composeStillTrue(snippet: Snippet, complete): Promise<QueueDraft|null>` — a still-true draft that quotes the old snippet verbatim but asks a DIFFERENT question than the one that elicited it (Q-14; the original question is in `snippet.provenance.question` — the composed text must not repeat it); source 'still-true', sharpness 'weak', same substring discipline
- Behavioral invariant: a null return is a legitimate outcome; callers fall back (probe rotation / bank). Never patch a failed composition (mirror of Q-1's never-patch).
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/clerk/composed.ts`
- Test: `tests/composed.test.ts` (scripted fake `Complete`)

- [ ] **Step 1: Failing tests** — fake returns valid follow-up containing phrase → accepted; fake returns question missing the phrase → one retry, then null; juxtaposition must contain both fragments or null; fabricated red-light phrase (not in turn) dropped; opener draft carries cites + quotedFragment and quotes the snippet verbatim
- [ ] **Step 2: Run** — Run: `npx vitest run tests/composed.test.ts` Expected: FAIL
- [ ] **Step 3: Implement** (temperature 0.4 for composition; prompts in-module)
- [ ] **Step 4: Run** — Run: `npx vitest run tests/composed.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: composed questions with code-enforced quoting"`

### Task 4b: Activity Log module [CHANGE SITE]

**Orient:** Q-23 — every deterministic and agentic act is logged append-only and rendered on the interface; background autonomy is only trustworthy because its ledger is inspectable.
**Flow position:** standalone Wave-1 module; consumed by Task 5 (injected emitter) and Task 7 (endpoint + UI + server-side emissions).

<contracts>
**Downstream:** `type ActivityEvent = { at: string; actor: 'clerk'|'elicitor'|'harvester'|'system'; kind: string; detail: string; refs?: string[] }` (declared HERE, module-local — not in types.ts, whose task is already in flight); `appendEvent(root: string, e: ActivityEvent): void` — append-only JSONL at `vault/log/YYYY-MM-DD.jsonl` (date from `e.at`); `readEvents(root: string, since?: string): ActivityEvent[]` — chronological, across day files.
- Behavioral invariant: append-only — no function edits or removes an event; malformed lines are skipped on read, never repaired.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/log/activity.ts`
- Test: `tests/activity.test.ts`

- [ ] **Step 1: Failing tests** — two appends preserved in order; read with `since` filters correctly; events span day files and read chronologically; new instance over same root sees all events; malformed line skipped without error
- [ ] **Step 2: Run** — Run: `npx vitest run tests/activity.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — Run: `npx vitest run tests/activity.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: append-only activity log"`

### Task 4c: Cover — bounded-context memory over transcripts [CHANGE SITE]

**Orient:** Clean-room rewrite of the OptMem tiling idea for Elicit's data model (the original is unlicensed and incompatible — do NOT read or port its code; implement from this spec alone). Gives any future LLM call a fixed reading budget over unbounded history: recent sessions verbatim, older ones collapsed to one-line summaries, zoomable.
**Flow position:** standalone Wave-1 module; first consumer is Task 5 (one consolidation per docket run); the Clerk slice consumes `cover()` later.

<contracts>
**Downstream:**
- `type SessionRef = { session: string; started: string; turnCount: number; chars: number }`
- `type Tile = { kind: 'verbatim'; session: string } | { kind: 'summary'; sessions: string[]; line: string } | { kind: 'unsummarized'; sessions: string[] }`
- `cover(sessions: SessionRef[], summaries: RangeSummary[], budgetChars: number): Tile[]` — pure function: newest sessions verbatim until the budget is ~spent, older ranges represented by their largest available summary, ranges with no summary yet appear as `unsummarized` (never silently omitted)
- `type RangeSummary = { sessions: string[]; line: string; model: string; at: string }` — stored as markdown at `vault/marginalia/transcript-summaries/<first>-<last>.md`; agent prose, Marginalia-class, structurally barred from Pieces (the Transcript glossary rule)
- `nextConsolidation(sessions: SessionRef[], summaries: RangeSummary[]): string[] | null` — the ONE next contiguous range (binary bracketing: pairs, then pairs of pairs) that lacks a summary; null when the tree is complete. One at a time — the caller (docket) performs at most one per run.
- `saveSummary(root, s: RangeSummary)` / `loadSummaries(root)` — derived-adjacent but persistent (summaries are expensive); rebuildable in the sense that deleting them only costs re-summarization, never data.
- Behavioral invariant: `cover` never drops a range — every session is inside exactly one tile; summaries supplement, never replace (anti-"keep what matters" rule).
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/memory/cover.ts`
- Test: `tests/cover.test.ts`

- [ ] **Step 1: Failing tests** — every session appears in exactly one tile; newest verbatim within budget; old ranges use largest covering summary; missing summary → `unsummarized` tile, never omission; `nextConsolidation` proposes oldest unsummarized pair first and null on completion; summary files roundtrip; deterministic given same inputs
- [ ] **Step 2: Run** — Run: `npx vitest run tests/cover.test.ts` Expected: FAIL
- [ ] **Step 3: Implement** (pure core + thin persistence; no LLM calls in this module — summarization text arrives from the caller)
- [ ] **Step 4: Run** — Run: `npx vitest run tests/cover.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: cover — bounded-context tiling over transcripts"`

### Task 5: Docket — the Clerk's background loop [CHANGE SITE]

**Orient:** The agent works whether or not the user is present (Q-22); finished work waits, never notifies.
**Flow position:** terminal consumer of vault + composed, producer for queue; triggered on server boot and after each harvest.

<contracts>
**Downstream:** `runDocket(deps: {vault: Vault, queue: QueueStore, complete: Complete, buildIndex: (snippets: Snippet[]) => LexicalIndex, composeOpener: (s: Snippet, c: Complete) => Promise<QueueDraft|null>, composeStillTrue: (s: Snippet, c: Complete) => Promise<QueueDraft|null>, log: (e: {at: string; actor: string; kind: string; detail: string; refs?: string[]}) => void}): Promise<DocketReport>` — collaborators typed STRUCTURALLY (no imports from Tasks 2/4/4b files, which do not exist while Wave 1 runs) so this task compiles and tests alone. Docket emits via `log`: run-started/run-skipped, index-rebuilt (count), opener-minted (refs: cites), still-true-minted, expired (count). Jobs in order: (1) rebuild the lexical index and return it in the report (`report.index` — the server holds it; one owner, no staleness); (2) mint up to 3 composed openers from snippets of the last 2 sessions not already cited by a pending queue entry (dedupe by snippet id); (3) mint still-true drafts for snippets older than 90 days by `captured` date — age is the ONLY trigger this slice (no seeded-provenance kind exists yet) — phrased as a DIFFERENT question than the original (Q-14), quota 2 per run; (4) call `queue.expire(30)` (the user-declared exemption is the store's rule, tested in Task 3); (5) at most ONE transcript consolidation per run: ask injected `nextConsolidation` (structural: `(sessions, summaries) => string[]|null`) and, if a range is due, produce its one-line summary via `complete` and persist via injected `saveSummary` — emit consolidation events to `log`. Serialized: an in-process lock; concurrent invocation returns a skipped report.
- Behavioral invariant: docket never writes Wiki readings or snippets — only queue entries and the derived index.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/clerk/docket.ts`
- Test: `tests/docket.test.ts`

- [ ] **Step 1: Failing tests** (all collaborators faked) — mints openers only for uncited snippets (dedupe works); still-true only for snippets with `captured` > 90 days old, quota 2 respected; `queue.expire(30)` called once per run; concurrent run returns skipped report (lock); report counts match fake-store effects; `report.index` is the freshly built index
- [ ] **Step 2: Run** — Run: `npx vitest run tests/docket.test.ts` Expected: FAIL
- [ ] **Step 3: Implement `src/clerk/docket.ts` only** — `composeStillTrue` belongs to Task 4's file and contract; this task injects and fakes it, never edits `composed.ts`
- [ ] **Step 4: Run** — Run: `npx vitest run tests/docket.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: clerk docket loop"`

### Task 6: Elicitor integration — opening draw, resonance, budget, close [CHANGE SITE]

**Orient:** Where slice 2 becomes visible: the session that builds on prior sessions and ends like an interview instead of a hangup.
**Flow position:** center of the flow map; upstream queue/index/composed (Tasks 2-4), downstream harvest (existing, unchanged).

<contracts>
**Changed:** `startSession(mode, deps)` — deps now per the Task 1 `SessionState` (queue + index added); `mode.target` normalized to `'self'` here. Opening: `queue.draw(mode,'opening')` first; null → bank (existing behavior). `userTurn` — after appending the turn: run `resonate`; a hit with score ≥ threshold offers juxtaposition (priority over red-light compose, which has priority over generic probe rotation); track `questionCount` against budget `min(20, max(10, mode.minutes))`. **The budget REPLACES `MAX_PROBES`** — delete the constant and its gate (elicitor.ts:70-76); rewrite the two slice-1 tests that assert it: `'7th probe never happens — max-probe saturation'` (tests/elicitor.test.ts:167) becomes a budget test, and `'skip does not count toward MAX_PROBES'` (:265) becomes 'skip does not count toward the budget'. Q-16 backs the replacement. When budget-2 reached or saturation: `phase: 'closing-door'` — ask open-door ("Anything else — something we didn't touch?"); next turn → `phase: 'closing-bookmark'` — ask bookmark ("Where should we pick up next time?"); the bookmark answer is written via `queue.add` as a `QueueDraft {source:'user-declared', sharpness:'weak', horizon:'session', question: opener quoting their words}` AND kept in the transcript as a normal turn (harvestable). Then `{kind:'saturated'}` as before.
- Protocols: `PROTOCOLS[target]` — 'self' → reflective-interview (existing); 'domain' → CDM prompt (nonroutine incident → account → timeline → decision-point probes) and laddered-grid prompt (examples-of / how-can-you-tell / key-difference), selection by opener source: domain sittings open with CDM for episode-rich topics, laddered-grid otherwise — keep the choice dumb (alternate), it is data not architecture.
- Behavioral invariant: every asked question still lands in the Transcript before return (Q-8); close-phase questions count inside the budget (Q-20).
</contracts>

**Skill:** `tdd`
**Files:**
- Modify: `src/elicitor/protocol.ts`, `src/elicitor/elicitor.ts`
- Modify (SCOPED): `src/server.ts` — minimal compile fix ONLY: the required deps break `startSession(mode, deps)` at server.ts:51, so construct a `QueueStore` and a `buildIndex`-produced index at the boot path and thread them into deps. The docket boot run, `GET /api/queue`, and re-index-after-harvest are Task 7's — do not implement them here.
- Test: `tests/elicitor.test.ts` (extend; fake index + fake queue)

- [ ] **Step 1: Failing tests** — opening uses queue entry when drawn, bank when null; resonance hit → juxtaposition offered (fake composed returns fixed text) and probe otherwise; budget: session with minutes=10 closes after 10 questions incl. two close moves; skip does not consume budget; bookmark answer lands in queue as user-declared AND in transcript; domain target selects CDM/laddered prompts; absent target normalizes to 'self'. Rewrite the two named MAX_PROBES tests as budget tests. The ~15 existing `startSession` call sites (tests/elicitor.test.ts:56-328) pass `{complete, vault, bank}` and MUST be mechanically updated: add shared `makeFakeQueue()` / `makeFakeIndex()` helpers at the top of the test file and thread them through every call site — deps stay REQUIRED on SessionState (do not make them optional to dodge the edit); assertions stay untouched.
- [ ] **Step 2: Run** — Run: `npx vitest run tests/elicitor.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** — Run: `npx tsc --noEmit && npx vitest run` (typecheck + FULL suite — vitest does not typecheck, and this task touches shared modules) Expected: both pass
- [ ] **Step 5: Commit** — `git commit -m "feat: elicitor remembers — opening draw, resonance, budget, close"`

### Task 7: Server + web — Target, juxtaposition, close flow, waiting surface

**Orient:** The user-visible face of slice 2, still a quiet writing app (Q-9).
**Flow position:** client + glue; upstream Task 6 contracts.

<contracts>
**Upstream (Task 6):** `startSession(mode, deps)` with full deps; `userTurn` responses now include juxtaposition questions (render like probes but with the cited past snippet + its date as a dimmed inset quote) and close-phase questions (render identically to probes — no ceremony).
**This task owns:** boot sequence — construct QueueStore, run `runDocket` (with `appendEvent`-backed log), hold `report.index`; after each `/harvest`, re-run docket and replace the held index (the report is the only index source, per Task 5's contract). `GET /api/queue` → `{pending: QueueEntry[], open: QueueEntry[]}` (open = days-horizon). `/api/session` normalizes absent `target` to `'self'`. Activity: server emits session-started (mode/target), question-asked (source), juxtaposition-offered, close-phase-entered, harvest events (kept/budded/dropped counts) around the elicitor/harvester calls — emission lives at the server seam so Wave-1/2 module contracts stay untouched. `GET /api/activity` — SSE stream of new events plus `?since=` snapshot via `readEvents`. Host binding: entry reads ELICIT_HOST (default 127.0.0.1); print the bound host. Password lock (Q-25): when `ELICIT_PASSWORD` is set, all routes except a minimal login page require a session cookie obtained by posting the password; constant-time compare; no password → no gate (dev mode). Quiet login page, same design language.
</contracts>

**Skill:** `interface-design:interface-design`
**Files:**
- Modify: `src/server.ts` (wire queue/index/docket into deps; `GET /api/queue` → pending + days-horizon entries; run docket on boot and after `/harvest`), `web/main.ts`, `web/style.css`
- Test: `tests/e2e.test.ts` (extend)

- [ ] **Step 1: Failing e2e** — full scripted session: seeded vault with prior snippets → docket on boot mints opener → session opens with composed opener quoting the old snippet → turn triggers juxtaposition (scripted) → budget close: two closing questions → harvest → new user-declared entry in queue → `GET /api/queue` lists it
- [ ] **Step 2: Implement server wiring**
- [ ] **Step 3: Web** — Mode screen: a third quiet control, `self / something I know` (Target); exchange: juxtaposed past snippet rendered as a dimmed inset quote with its date above the question (the one place the archive is visible mid-session); close phase: same screen, no ceremony; waiting surface: a route showing open queue entries (question + source + age), styled per `docs/interface-references.md` — a list that reads like a table of contents, not a task manager; phone-width pass (Q-26): media query for narrow viewports across all screens — touch-sized quiet actions, textarea ergonomics; activity panel: on the waiting-surface route, a reverse-chronological dimmed stream fed by the SSE endpoint — log lines styled like Marginalia (monochrome, small, actor-prefixed), never toasts or badges
- [ ] **Step 4: Verify** — Run: `npx vitest run` Expected: all pass. Run: `npx vite build` Expected: exit 0. Then serve with `ELICIT_LLM=fake` and walk the full flow in browser
- [ ] **Step 5: Commit** — `git commit -m "feat: target, juxtaposition, close flow, waiting surface"`

### Task 8: Real-model session — the slice-2 hypothesis check

**Orient:** The hypothesis: *a session that builds on prior sessions feels like being remembered, and composed/juxtaposed questions outperform bank openers in kept-snippet yield.*
**Flow position:** end-to-end with `ELICIT_LLM=local`.
**Skill:** `none`
**Files:**
- Create: `docs/superpowers/plans/2026-08-01-it-remembers-you.RESULTS.md`

- [ ] **Step 1:** Micah runs ≥2 genuine sessions against the now-populated vault (bonsai-27b), at least one with `target: domain`
- [ ] **Step 2: Verify invariants on disk** — every composed queue entry's `quotedFragment` appears verbatim in its `question` (grep loop, must check ≥1 entry so it cannot pass vacuously); transcripts append-only; user-declared entries present after close
- [ ] **Step 3: Record in RESULTS.md** — kept-snippets-per-exchange split by question source (composed vs bank vs juxtaposition — the Hoffman yield comparison), juxtaposition quality notes, CDM/laddered-grid quality on a domain sitting, close-move yield (did open-door produce a keeper?)
- [ ] **Step 4: Commit** — `git commit -m "test: slice-2 real-model results"`

---

## Execution Waves

- Wave 0: Task [1] — contracts
- Wave 1: Tasks [2, 3, 4, 4b, 4c, 5] (parallel) — 5 injects everything structurally, tests use fakes; disjoint files
- Wave 2: Task [6] — needs real modules from Wave 1
- Wave 3: Task [7] — needs Task 6
- Wave 4: Task [8] — Micah + real model

## Open Questions

### Wave 1
- **Task 2:** Q: minimum shared-phrase length that beats noise on a real personal corpus? (start: 3 content words; tune in Task 8 — exploratory)
- **Task 4:** Q: can bonsai-27b reliably echo the exact fragment in composed questions, or will the retry-then-null path dominate? (exploratory; Task 8 measures the null rate — if >50%, the corrective is a template-assembly fallback where code, not the model, splices the quote into a fixed frame, which is Q-12-safe by construction)
- **Task 5:** Q: "recent snippets" window for opener minting — last session only, or last N? (start: last 2 sessions)

### Wave 2
- **Task 6:** Q: juxtaposition score threshold? (start: any hit whose sharedPhrase ≥ 3 content words; exploratory)

### Wave 4
- **Task 8:** Q: does composed beat bank on yield? This is the slice hypothesis — record, don't gate.

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/types.ts` | patch | `ResonanceHit` |
| `src/index/lexical.ts` | create | `resonate` |
| `src/queue/queue.ts` | create | `constraints-then-chance` |
| `src/clerk/composed.ts` | create | `quotedFragment` |
| `src/clerk/docket.ts` | create | `runDocket` |
| `src/elicitor/protocol.ts` | patch | `laddered` |
| `src/elicitor/elicitor.ts` | patch | `close` |
| `src/server.ts` | patch | `/api/queue` |
| `web/main.ts` | patch | `waiting` |
| `web/style.css` | patch | `inset-quote` |
| `tests/lexical.test.ts` | create | `sharedPhrase` |
| `tests/queue.test.ts` | create | `never drawn` |
| `tests/composed.test.ts` | create | `retry` |
| `tests/docket.test.ts` | create | `quota` |
| `src/log/activity.ts` | create | `appendEvent` |
| `tests/activity.test.ts` | create | `append-only` |
| `src/memory/cover.ts` | create | `nextConsolidation` |
| `tests/cover.test.ts` | create | `unsummarized` |
<!-- PLAN_MANIFEST_END -->

## Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-1/Q-12 | Verbatim invariants, question side | Task 4 (Wave 1), Task 8 Step 2 |
| Q-3 | Markdown truth, derived index | Tasks 2, 3 |
| Q-8 | Append-only transcripts | Task 6 |
| Q-13 | Constraints-then-chance draw | Task 3 |
| Q-14 | Still-true asked differently | Task 5 |
| Q-16 | Session budget 10–20 replaces MAX_PROBES | Task 6 |
| Q-19 | Target declaration, domain instruments | Tasks 1, 6, 7 |
| Q-20 | Two-move close, budget | Task 6 |
| Q-22 | Docket background, zero outbound | Task 5, Task 7 (waiting surface) |
| Q-9 | Focus-friendly UI | Task 7 |
| Q-23 | Append-only Activity Log on the interface | Tasks 4b, 5, 7 |

## Shape Changes

| Date | Role | Change |
|------|------|--------|
| 2026-08-01 | user | Password gate amended (post-dispatch, applies as Task 7b patch): the password is set and asked IN THE APP, not provided when running the server. `ELICIT_PASSWORD` env var is dropped. First run: a set-a-password screen, accepted only from loopback addresses (so a LAN stranger cannot claim it while host-bound); stored as scrypt hash+salt in `vault/.auth.json` (rides vault custody/gitignore/backup, Q-25). Thereafter: login page from anywhere, session cookie, constant-time compare on the derived hash. If bound beyond loopback with no password set, non-loopback requests get a "finish setup from the host machine" page — the ADR-0003 invariant (binding never precedes the gate) holds structurally. Host-bound run becomes `ELICIT_HOST=0.0.0.0 npm start`. |
| 2026-08-01 | author | Dispatch note: Task 1's SessionState extension breaks tsc at existing call sites in Wave 0 (not Wave 2); its gate is amended to "remaining errors are exclusively the new-required-deps class, enumerated" — resolved fully by Tasks 6/7. Task 2 gained the loudest-thought diversity rule (overfetch, one hit per snippet, near-identical dedupe) from research-llm-wiki-gist.md; backlog for all other gist mechanisms at docs/backlog.md. |
| 2026-08-01 | author | Round-3 fixes (plan APPROVED for execution): baseline tsc error in scripts/apply-curation.ts repaired directly (conditional spread, commit ffa1ba5) so the typecheck gates are reachable; Task 6 gains a SCOPED src/server.ts entry — minimal compile fix for the required deps only, docket/queue endpoints stay Task 7. |
| 2026-08-01 | author | Round-2 fixes: Task 1 steps now say `target?: Target` (hedge deleted); Task 5's injected collaborators typed structurally (no imports from unbuilt files); Task 6 names the 15-call-site update with shared fake helpers, deps stay required, `tsc --noEmit` added to Step 4; File Structure signatures synced; source union = three literals only; Q-18 reworded as staged in Architecture. |
| 2026-08-01 | author | Round-1 review fixes: budget explicitly replaces MAX_PROBES (two named tests rewritten in Task 6); SessionState/QueueDraft/LexicalIndex moved to Task 1; `Mode.target?` optional with normalization points named; exactOptionalPropertyTypes note; Task 5 fully injected (parallel restored) incl. composeStillTrue owned by Task 4; user-declared expiry exemption moved to Task 3; still-true trigger scoped to age-only; index ownership unified (DocketReport.index, server holds); latest-versions-only declared for the index; 'mid' phase defined; sort key stated; explicit Run/Expected on all TDD tasks; Task 7 contracts block; source enum trimmed to what's minted. |
