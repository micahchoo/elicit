# Architecture campaign — system analysis and the round-three plan

Date: 2026-08-08. Companion to the round-two HTML report
(`/tmp/architecture-review-20260807-175201.html`, 9 candidates + 5 minor
frictions). This document is the abstractive layer the report does not
carry: the system-as-a-whole view, the chunk-by-chunk categorization, the
phase-by-phase breakdown of what already ran, and the round-three plan
derived from a fresh five-scout sweep of the post-campaign codebase.

The report reads card by card. This reads system by system, then phase by
phase, and explains why the phases are ordered the way they are — the
domino logic and the composition of second- and third-order effects.

---

## 1. The system as a whole

Elicit is one pipeline with a background loop:

```
Person ──▶ Elicitation ──▶ Evidence ──▶ Model ──▶ Emergent Outputs
           (Sitting,       (Snippets,   (Wiki:      (Pieces,
            Sounding,       Buds,        claims,     Coach
            Protocol        Transcripts) contradictions,  directions)
            machines,                    resonance)
            DRM)
                ▲                              │
                │  Queue (pending questions)   │ Clerk (Docket jobs)
                └─────────── Elicitor ◀────────┘
                (draw → compose → emit gate → ask)
```

Four invariants hold the whole thing together, and every architecture
decision in this campaign ultimately serves one of them:

1. **Sole Authorship** — agent prose can never enter a Piece. The emit
   gate (`guardComposed`), the harvest admissibility pipeline, and the
   wiki's citation discipline all exist to keep this true *by
   construction*, not by prompt.
2. **One truth per rule** — every threshold value, every action
   vocabulary, every format rule has exactly one home. This is the
   register culture: `THRESHOLDS`, the mechanism registry, the
   conformance tests that pin them.
3. **The interface is the test surface** — deep modules (narrow
   interface, wide implementation) beat shallow ones, because the seam is
   where tests bite. The `WebDepsCore` seam, the queue's `draw(mode)`
   seam, the vault adapters.
4. **The docket never contacts the person** — background work waits on
   the Waiting Surface; agent initiative ends at the app's edge.

The architecture work is not about prettiness. It is about making these
four invariants *cheap to verify*: when a rule has one home, the test
that pins it pins the whole system.

## 2. Categorization — progressively smaller chunks

The codebase as chunks, each level an order of magnitude finer:

```
Level 1 — The product        Elicit: local-only agentic elicitation
Level 2 — The pipeline       5 stages: Elicitation · Evidence · Model ·
                              Composition · Emergent Outputs
Level 3 — The loop           Queue ↔ Elicitor ↔ Clerk (Docket) ↔ Wiki,
                              surfaced on the Waiting Surface
Level 4 — Subsystems         16 directories under src/ + web/ + the two
                              composition roots (server.ts, main.ts)
Level 5 — Modules            ~110 files; the deep ones (watermark,
                              engagement, clause, sweep-core, loader,
                              detail.ts) stay; the shallow ones get
                              deepened or deleted
Level 6 — Primitives &       The shared rules: THRESHOLDS register,
   seams                     mechanism registry, emit gate, draw ladder,
                              cite resolution, fence strippers,
                              WebDepsCore, EventKind
```

The subsystem map at level 4:

| Subsystem | Files | Role in the pipeline | State after rounds 1–2 |
|---|---|---|---|
| `src/elicitor/` | elicitor, protocol, facet-intent, bank, target-default | asks the person; composes through the gate | primitives duplicating (opener cascade ×3) |
| `src/language/` | emit-form, guards, disfluency, thin-answer, weak-form | the question's shape and the emit gate | deep — the round-two domino |
| `src/clerk/` | docket, wiki-jobs, composed, contradiction, mint, annotate, arrangements, compose-pattern, sounding-rung, watermark, annotation-store, lineage-mirror, gazetteer, coach-seed, sitting, clause | background work: readings, minting, contradictions | seams good; compose machinery duplicated ×7 |
| `src/wiki/` | store, ops, status, lint, clash, registry, embedding, thresholds | the model | registers single-homed; cite resolution ×4 divergent |
| `src/queue/` | queue, engagement, mode-needs, facet-balance, source-label | pending questions, draw | draw(mode) honest; shared render rules misplaced |
| `src/index/` | lexical, semantic | retrieval | semantic duplicates embedding machinery |
| `src/harvester/` `src/import/` | admissibility, harvester; pipeline, scan, extract, commit, adopt, repair, dating, body, region, store | prose → Snippets; Seeding | pipeline.ts owns the sequence; body.ts owns drop rules |
| `src/sounding/` `src/protocols/` `src/drm/` `src/randomizer/` | instruments | depth descents, phase machines, DRM, serendipity | license honors live flags; machines unified |
| `src/ktg/` | sweep-core, gap-fill, atlas-gap-fill, validator, coverage, loader | territory instruments | sweep-core unifies the sweeps |
| `src/coach/` `src/piece/` `src/vault/` `src/log/` | store, license; store, dormancy; transcripts, marginalia, vault; kinds, format, detail | growth, outputs, storage, audit | EventKind closed; detail.ts one parser; readSittingTags still hand-rolled |
| `src/loop/` `src/v2/` `src/auth/` `src/stt/` | harness, adapter, gate, speech | meta | twins (graduations/demotions) |
| **`src/server.ts`** | **4,951 lines, ~87 routes** | the composition root | thinned, still the god file |
| **`web/main.ts`** | **3,193 lines** | the client shell | thinned, still the biggest client file |
| `src/registry.ts` | mechanism registry | exposure ratchet | honest (live/shadow/unwired) |

## 3. What already ran — phases 0–3 of round two (commit `057dc60`)

The round-two report surfaced 9 candidates + 5 minor frictions. The
campaign executed them in four waves, each verified green before the next
started (tsc clean, 2753 vitest passing, web typecheck clean, vite build
green — re-verified 2026-08-08 for this document).

### Wave 0 — arm the ratchets (the domino)

Thresholds moved into the `THRESHOLDS` table (plan-ledger double-pinned),
the Sounding license honors `live` flags, `writeDRM` deleted, repair
ledger functions renamed, `apiRaw` folded into `api()`, the defer-verb
regression fixed, the mechanism registry repaired (25 entries declared, 2
honest unwired flips, 2 dead exports un-exported).

**Why first.** The ratchets are the verification machinery. Every later
wave's safety is measured against the conformance pins (the
plan-ledger threshold table, the mechanism registry sweep, the canon
strings). Wave 0 was the only candidate where a load-bearing invariant
was *already violated* — the register's own claim was false. Fixing the
safety net before climbing is the whole game: a wave that breaks a
threshold then fails loudly, not silently.

**Second-order effects composed.** Threshold moves land in the plan
ledger in the same change (the double-pin test forces code and decisions
to move together). The mechanism registry declared two honest `unwired`
flips instead of lying "live" — the exposure ratchet records debt with a
name rather than hiding it.

### Wave 1 — thin the server root

`body.ts` owns the drop vocabulary (`classifyDroppedRun`), `mode-needs.ts`
single-homes the energy ladder, queue `draw(mode)` with parked-pointer
kinds owned by their park modules, `guardComposed` becomes the one
compose-through-gate helper (every composed path: composed.ts,
compose-pattern.ts, elicitor.ts, server.ts), `import/pipeline.ts` owns
the Seeding sequences, `isoDay` single-homed.

**Why second.** These are the highest-churn file's rule layers, and they
consume the ratchets Wave 0 re-armed. The queue's `draw(mode)` trim was
safe *because* the parks already declared their kinds — the injection
contract existed before the interface shrank.

**Third-order effects composed.** The queue interface change ripples to
four park modules and the elicitor — done as one wave so the interface
and every caller move together, never a transitional state.

### Wave 2 — unify repeated shapes

`ktg/sweep-core.ts` (one cap/dedupe/coverage sweep core, two question
templates) and `defs/loader.ts` (one frontmatter loader + cache shared by
the patterns and protocols registries).

**Why third.** Pure addition with no behavior change — the safest kind of
change to land mid-campaign between two structural waves.

### Wave 3 — thin the client root

`main.ts` 5035 → 3192 lines; waiting/wiki/piece extracted behind
`WebDepsCore`; territory onto the seam; e2e selectors preserved
byte-for-byte.

**Why last.** The client extraction is the biggest lever (the report's
words), and it only compiles against settled server contracts. Wave 1's
API changes had to land before the extracted screens could be written
against them.

**Composition discipline that made 2nd/3rd-order effects safe:**
- One file-conflict matrix per wave — no two agents touched the same
  file in one wave; shared files were sequenced across waves.
- Every wave gated by the full suite, so a regression is attributed to a
  wave, not to the campaign.
- Extractions were behavioral no-ops: wire shapes byte-identical, e2e
  selectors preserved — verified, not assumed.
- Threshold changes double-pinned to the plan ledger; mechanism changes
  declared in the registry.

## 4. Round three — the fresh sweep

Five read-only scouts walked the post-campaign tree (server, clerk, wiki/
queue/elicitor, web, infra), ~70 evidence-backed findings, every claim
file:line-verified, every "dead" claim cross-checked against the
mechanism registry before being called dead.

### What the sweep found — the next chunk of the system

The composition roots are thinner but still dominate: `server.ts` at
4,951 lines (the session-flow cluster alone is ~1,700 lines of one
coherent domain), `main.ts` at 3,193 (the exchange screen ~1,035).
Under them, the round-two defect class — *one rule, N copies* — is not
exhausted:

- **cite resolution ×4, one divergent** (`lint.fateOf`, `status.resolve`,
  `ops.citeResolves`, `clash.sessionsOf`): the `snippetId@version ≤
  latest` rule lives four times and two copies already disagree about
  absent sessions (Q-50 "evidenced" vs Q-65 "cross-sitting" rank the
  same pair differently).
- **embedding machinery ×2** (`wiki/embedding.ts` ↔ `index/semantic.ts`):
  prime budget loop, `asRecord`, `persist`, `vectorFor`, `EMBED_BATCH`
  — both files document the duplication; every budget fix must land
  twice.
- **opener cascade ×3 in one file** (`elicitor.ts`): shuffle → draw →
  randomizer → bank spelled out three times, one copy silently skipping
  the weak-form gate its own module doc claims.
- **clerk compose machinery ×7**: `stripFences` seven copies (one
  looser), `FRAMING_RULE` three (one drifted), rejection→corrective two
  (drifted), the quote-gate reimplemented behind a stale
  "module-private" comment, and eight near-identical
  attempt→gate→retry→null skeletons in composed.ts.
- **guarded-job plumbing ×19** in docket.ts; **twin key-stores**
  (`loop/graduations.ts` ≡ `loop/demotions.ts`); **~7 JSONL ledger
  reimplementations**; **Facet enumeration ×4 runtime copies**;
  **source-label.ts** still named for its first member (its own doc
  plans `src/labels.ts`); **facet-balance.ts** still the corpus census
  leaking through the vault seam.

### The round-three maximal orthogonal set

Selected by leverage (deletion test + line mass + downstream unlock) and
grouped into waves by the file-conflict matrix. The domino of this round
is the **shared-primitives wave** — every re-declared rule collapses to
one home first, so the structural extractions that follow move code, not
vocabulary. The web-side domino is `pieceWait → beginWait` and
`protocol-meta.ts`, which unblock every remaining screen extraction.

**Wave A — shared primitives (the domino).** A1 wiki cite/merge
primitives (status/lint/ops/clash/registry/thresholds converge; queue's
hand-split reroutes) · A2 embedding↔semantic dedup · A3 elicitor opener
cascade + vestigial protocol table deletion · A4 Facet enumeration
collapse · A5 web primitives (pieceWait fold, protocol-meta.ts).

**Wave B — structural extractions.** B1 session-cluster extraction
(`src/session/`, ~1,700 lines; the repo's biggest single deepening) · B2
clerk compose-gate module (stripFences/FRAMING_RULE/corrective/
composeWithRetry one home) · B3 docket `runJob` primitive (19× guarded
block collapses) · B4 harvest+reviews screen extraction (web).

**Wave C — the second server root pass.** C1 `createClerk` factory
(~480 lines of inline docket wiring returns to src/clerk/) · C2
exchange+dictation extraction (the last big client screen) · C3 server
re-declared-rule batch (VALID_ACTIONS, gate-choice, queue-entry shape,
unprompted-mode, machinePhaseMeta, guard closure, mode validation) · C4
loop twins → one key-store · C5 coach transcript read via the vault
adapter (fixes a latent Date bug).

**Wave D — within-file deepening + ledger truth.** D1 drm+mode screen
extraction · D2 queue store deepening (field-list single source,
disengagement split, distinctFieldKeys wired or deleted) · D3 wiki-jobs
within-file collapse (quoteFor≡firstProse, presweep≡confirmation, graph
memoization) · D4 JSONL ledger consolidation (five non-audit ledgers on
one crash-tolerant helper; log/activity.ts explicitly excluded — the
audit trail is not a convergence target) · D5 import-review seam repair.

**Wave E — sweep-up.** Web misc batch (NavOpts, ActivityEvent dedup,
ageString, double fetch, deps layering, 401 semantics), server last
(auth-sessions, unprompted-sitting-flow), lineage-mirror through the gate,
v2/types union, and the cheap speculative deletions.

**Composition rules for round three** (same as round two, plus):
- At most one server.ts task, one main.ts task, one queue.ts task, one
  elicitor task per wave — shared files sequence across waves.
- Cross-wave contracts (e.g. `resolveCite`'s signature, the writable
  session-state handle) are pinned in the shared task context before
  dispatch, so a wave never compiles against an export a sibling has not
  written.
- Extractions are behavioral no-ops: wire shapes byte-identical, e2e
  selectors preserved.
- Every wave ends with the full gate: `tsc --noEmit`, `vitest run`
  (2753 baseline), `tsc -p tsconfig.web.json`, `vite build`.

## 5. Execution log

Wave-by-wave results appended below as they land (status, files,
verification numbers).

### Wave A — shared primitives (landed, gate green: tsc clean, 2753 passed, web build green)

- **A1 wiki primitives** — one `resolveCite` + `citeParts` (status.ts;
  lint/ops/clash rerouted, queue's three hand-splits rerouted); one
  `sittingsOfCites(cites, snippets, onAbsentSession: 'key-by-snippet' |
  'drop')` with both policies preserved (clash's divergent `sessionsOf`
  deleted); `ThresholdRegister` moved lint → thresholds (7 importers
  migrated); `nameTokens` exported from registry; shared O(n²) sweep
  extracted as `candidatePairs` (named without "merge" — a Q-32
  conformance test the first name tripped; the pin stays).
- **A2 embedding/semantic** — one `embedBatches` + `asRecord` +
  `cachedVector` in wiki/embedding.ts; semantic.ts keeps only its
  keyspace persist (+23/-88). Log strings verified against test
  assertions.
- **A3 elicitor** — one `resolveOpener` + `bankDraw` for greeting, the
  kept pre-135 path (20 test call sites), and drawFallback; weak-form
  now applied in the fallback (the one named behavior fix); vestigial
  PROTOCOLS table + prompt literals deleted, probe-quality reads the
  reflective def; registry entry deleted with the table.
- **A4 facets** — mint/harvester/decks import `FACETS`; two subsets made
  explicit derivations. New lead: `patterns/registry.ts:29 VALID_FACETS`
  is a fifth enumeration — queued for the sweep-up wave.
- **A5 web primitives** — `pieceWait` folded into `WebDepsWithWait.
  beginWait` (shame-gradient constraint verified unreal); NEW
  web/protocol-meta.ts extracted (unblocks the screen waves).

Wave B in flight: session-cluster extraction, clerk compose-gate,
docket runJob primitive, harvest+reviews screen extraction.

### Wave B — structural extractions (landed, gate green: tsc clean, 2754 passed, web build green)

- **B1 session-cluster extraction** — NEW src/session/routes.ts (1,896
  lines): createSessionRoutes(app, SessionCtx) owns all 19 sitting-flow
  routes + helpers, moved verbatim; server.ts −1,795 lines; read-handles
  for the docket-replaced index; machinePhaseMeta single-homed in
  src/protocols/machine.ts (the queue-enrich duplicate deleted).
- **B2 clerk compose-gate** — NEW src/clerk/compose-gate.ts owns
  stripFences (7 copies → one, `{loose}` param for lineage-mirror),
  FRAMING_RULE (3 → one; compose-pattern's drifted shorter copy
  converges — named behavior change, no test pins it), corrective
  (rejection→correction table), composeWithRetry (8 skeletons → one
  helper, every per-path message preserved). arrangements.ts now imports
  the real quote gate (its reimplementation was LOOSER — the stricter
  gate is a named improvement; its tests still pass).
- **B3 docket runJob** — runJob/mintOne primitives collapse 19 guarded
  blocks + 4 mint loops; tripwire keeps its console.error via a sink;
  expired-double-read fixed. The runJob failure kind is a literal at
  each call site so the emitted-kinds sweep can read it (the wave's one
  conformance wrinkle: the scanner now follows arrow-function heads —
  tests/emitted-kinds.ts — and the route-contract test scans all of
  src/, not just server.ts). 'tripwire-failed' became a real audit
  event (kind + sentence + sample added — a named behavior addition).
- **B4 harvest+reviews extraction** — NEW web/harvest.ts + web/reviews.ts
  on the WebDepsCore seam; openEntry re-enters via a bound renderHarvest
  callback; 76 render strings + 28 classes carried over verbatim;
  main.ts −482 lines.

Wave C in flight: createClerk factory, exchange+dictation extraction
(the last big client screen), loop twins key-store, coach transcript via
the vault adapter.

### Wave C — second server-root pass (landed, gate green: tsc clean, 2754 passed, web build green)

- **C1 createClerk factory** — NEW src/clerk/docket-init.ts (645
  lines): the ~26-thunk inline docket wiring becomes
  `createClerk(ClerkBootDeps): ClerkHandles` (19 boot fields, 7
  handles); the ONE server seam is `setIndex` (the docket completion's
  two index writes). server.ts −28 imports; the tripwire/stop-switch
  semantics moved intact. No behavior change.
- **C2 exchange+dictation extraction** — NEW web/exchange.ts (860
  lines, renderExchange + pulse + handlers) + web/dictation.ts (263
  lines, startRecording/stopAndTranscribe/wireDictation + mic globals);
  web/deps.ts grows the writable SessionState handle (17 getters, 15
  setters over the real AppState); the vestigial exchangeTurnCount
  counter deleted; piece.ts types its dictation through the module.
- **C4 loop twins** — NEW src/loop/key-store.ts: one parameterized
  crash-tolerant key-store (root resolver, fileName, entryField,
  removal?) holding both twins; the write-on-change asymmetry
  (add always writes, clear writes only on change) and the stat-token
  cache rule preserved; registry made honest (readGraduations → unwired
  with reason, readDemotions reason fixed).
- **C5 coach transcript** — readSittingTags rerouted through
  vault/transcripts.ts (the transcript-read owner); the Date-vs-string
  started normalization now applies (a named contract fix); SittingTag
  shape preserved exactly.

Wave D in flight: server vocab batch (the surviving re-declared rules),
drm+mode screen extraction, queue store deepening, wiki-jobs within-file
collapse, JSONL ledger consolidation.

### Wave D — within-file deepening (landed, gate green: tsc clean, 2754 passed, web build green)

- **C3 server vocab batch** — HARVEST_ACTIONS/IMPORT_ACTIONS exported
  from their owners (the drifted copy dies), validateGateChoice
  single-homed, NEW src/queue/open-question.ts (the queue-entry shape's
  one home, 4 sites), UNPROMPTED_MODE in mode-needs.ts (5 sites),
  makeRungGuard in the session module (3 sites), isMode enforces the
  energy union at the boundary (the one deliberate change: `energy:
  'banana'` now 400s).
- **D1 drm+mode extraction** — NEW web/drm.ts (402 lines) + web/mode.ts
  (347 lines); main.ts 1,771 → 1,148 lines; SessionState handle +3
  setters; localStorage decision documented (kept direct — no storage
  seam exists to match).
- **D2 queue deepening** — ONE type-derived OPTIONAL_ENTRY_FIELDS list
  drives both #parseEntry and #write (22 keys, exactly the serialized
  set — 6 run-local QueueEntry fields never serialized, documented);
  the ticket-148 per-thread deferral extracted to
  #deferThreadAfterStrikes; distinctFieldKeys WIRED (both gap-fill
  sweeps compose it) and flipped live.
- **D3 wiki-jobs collapse** — quoteFor≡firstProse collapsed;
  presweep/confirmation merged into one pass-parameterized
  confirmAnsweredRemeasures; the graph memoized with invalidation
  proven at exactly the write boundaries (worst case 6 rebuilds/run vs
  10+; the Q-29 contested-read ordering preserved).
- **D4 JSONL ledger** — NEW src/jsonl.ts (appendLine/readLines:
  one-sync-write whole-line appends, missing→[], raw lines to each
  module's own parse); five ledgers delegate (reach-declines, loop
  ledger, repair ledger, repairs, sweep-log+deferral); the audit trail
  (log/activity.ts) excluded by design; per-module grammar preserved.

Wave E (final sweep-up) in flight: import-review seam repair + web
misc, auth-sessions + unprompted-flow extraction, lineage-mirror through
the emit gate, and the cheap deletions (v2 Phase union, VALID_FACETS,
two stripFences copies, wiki/store field list).

### Wave E — sweep-up (landed, final gate green: tsc 0 errors, 2754 passed, web typecheck 0 errors, vite build green)

- **Eweb seam repair + misc** — ImportReviewDeps now extends
  WebDepsWithWait (the one split module still re-declaring the core;
  import-entry inherits); the lone global-document touch (a live
  selection read) is an injected `selection` verb; one shared NavOpts
  (three re-declarations die); ActivityEvent single-homed (harvest-
  failure's copy deleted); ageString → relativeTime (one named rendered
  change: an unparseable timestamp renders '' instead of 'NaNd ago' —
  degenerate, unpinned); the double /api/queue fetch merged to one;
  WebDepsShell layer absorbs the renderShell/clear/setScreen + text +
  document re-declarations; deps.ts header names the two wiring idioms
  honestly. stopAndTranscribe's 401 handled documented as a conscious
  deferral.
- **Eserver last** — createSessionAuth (the inline token map/cookie
  gate moves into src/auth/), startUnpromptedSitting (the five one-turn
  capture flows), the unreachable pre-135 pulse branch deleted (with
  reachability evidence), finishedDRM de-wired (4 writes + 1 read
  removed; the dead type field left for a later touch).
- **Elineage** — composeLineageMirror now runs the shared
  composeWithRetry skeleton + the guardComposed emit gate every other
  composer passes (the last un-gated composition path closed).
- **Emisc** — Phase union exported from types.ts (v2's copy dies),
  VALID_FACETS derived from FACETS (the 5th enumeration closed),
  coach/advise + harvester stripFences copies proven byte-identical and
  converged on compose-gate, wiki/store CLAIM_FIELDS one list driving
  writer + reader tails.

---

## 6. Campaign tally

Rounds 1-2 (commit `057dc60`, verified this session): 49 findings + 9
report cards + 5 minor frictions, waves 0-3, 2753 tests green.

Round three (this session, uncommitted): 5 scouts → ~70 findings → 27
delegated slices in 5 waves, every wave gated. Final state: **tsc 0
errors, 2754 vitest passing (1 skipped), typecheck:web 0 errors, vite
build green**, 68 files changed, +2,395 / −6,772 lines.

The composition roots after round three: server.ts 4,951 → **2,681**
lines (−46%); web/main.ts 3,193 → **1,163** lines (−64%). The session
cluster lives in src/session/routes.ts (1,911); the clerk's boot wiring
in src/clerk/docket-init.ts (644); the big client screens in
web/exchange.ts (860), web/wiki.ts (666), web/waiting.ts (661),
web/piece.ts (484), web/drm.ts (402), web/mode.ts (347),
web/harvest.ts (321), web/reviews.ts (174). The shared
primitives are single-homed: resolveCite, sittingsOfCites with a named
absent-session policy, embedBatches, resolveOpener, candidatePairs,
stripFences, FRAMING_RULE, corrective, composeWithRetry, runJob, mintOne,
OPTIONAL_ENTRY_FIELDS, CLAIM_FIELDS, appendLine/readLines, FACETS,
UNPROMPTED_MODE, HARVEST_ACTIONS, IMPORT_ACTIONS, validateGateChoice,
isMode, Phase, NavOpts, WebDepsShell, ServerEmitFn — every one of them a
copy that used to exist in N places.





