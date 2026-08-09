# Architecture campaign — round four: the system analysis and phase plan

Date: 2026-08-08. Companion to the round-three analysis
(`2026-08-08-architecture-round-three.md`) and the round-two HTML report
(`/tmp/architecture-review-20260807-175201.html`). This document is the
abstractive layer: the system-as-a-whole view, the progressively-finer
categorization, what already ran, the round-four sweep findings, and the
phase-by-phase plan derived from them — the domino logic and the
composition of second- and third-order effects.

The report reads card by card. This reads system by system, then phase by
phase, and explains why the phases are ordered the way they are.

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
decision in this campaign serves one of them:

1. **Sole Authorship** — agent prose can never enter a Piece. The emit
   gate (`guardComposed`), the harvest admissibility pipeline, and the
   wiki's citation discipline exist to keep this true *by construction*.
2. **One truth per rule** — every threshold value, every action
   vocabulary, every format rule has exactly one home. The `THRESHOLDS`
   register, the mechanism registry, and the conformance tests that pin
   them.
3. **The interface is the test surface** — deep modules (narrow
   interface, wide implementation) beat shallow ones, because the seam is
   where tests bite. `WebDepsCore`, `draw(mode)`, the vault adapters.
4. **The docket never contacts the person** — background work waits on
   the Waiting Surface; agent initiative ends at the app's edge.

Rounds 1–3 made these invariants *cheap to verify*: the shared primitives
are single-homed, the composition roots are thin (server.ts 4,951 → 2,681;
main.ts 3,193 → 1,163), and the ratchets (THRESHOLDS double-pin, mechanism
registry, emitted-kinds sweep, route contract) are all armed and green.

## 2. Categorization — progressively smaller chunks

```
Level 1 — The product        Elicit: local-only agentic elicitation
Level 2 — The pipeline       5 stages: Elicitation · Evidence · Model ·
                              Composition · Emergent Outputs
Level 3 — The loop           Queue ↔ Elicitor ↔ Clerk (Docket) ↔ Wiki,
                              surfaced on the Waiting Surface
Level 4 — Subsystems         16 directories under src/ + web/ + the two
                              composition roots (server.ts 2,681,
                              main.ts 1,163)
Level 5 — Modules            ~150 files; the deep ones stay (docket.ts,
                              wiki-jobs.ts, composed.ts, clause.ts,
                              sweep-core.ts); the megafunctions get split
Level 6 — Primitives &       The shared rules: THRESHOLDS, mechanism
   seams                     registry, emit gate, draw ladder, cite
                              parts, WebDepsCore, EventKind, jsonl.ts,
                              key-store
```

The subsystem map at level 4 (round-four inventory, lines at HEAD):

| Subsystem | Files (lines) | Role | Round-4 verdict |
|---|---|---|---|
| `src/server.ts` | 2,681 | composition root | five extractable route clusters (~1,380 lines) + rule batch |
| `src/session/` | routes.ts 1,912 | the /api/session flow | 17× sessionOr404; mtime-scan in close block; state maps still root-owned |
| `src/clerk/` | ~10,450 (23 files) | background work | docket.ts runDocket body 610; wiki-jobs confirmation slice ~330; cite-parse ×7; threshold reads ×11 |
| `src/wiki/` | ~4,200 (9 files) | the model | shape trio ×2; role-taking ×2; store.ts cursor twins; 4 JSONL-parse loops |
| `src/queue/` | 1,344 (6 files) | pending questions, draw | **6 write-only fields (real bug)**; thread-key ×2; park-pointer shape ×3; facet-balance compose ×2 |
| `src/elicitor/` | 1,379 (5 files) | asks the person | opener→turn ×2; askedTexts ×4; skip pick ×2 |
| `src/index/` | 980 (2 files) | retrieval | trigram keying ×3; STOPWORDS/FUNCTION_WORDS ×2; vector-store file pair twin |
| `src/import/` | ~2,600 (14 files) | Seeding | adopt/repair read vault directly; AUTHORS vocab not homed; droppedRegions in root |
| `src/ktg/` `src/sounding/` `src/protocols/` `src/drm/` `src/randomizer/` | instruments | sweep-core owns ktg; clerk/gap-fill re-implements it; coverage status ×2 rules; WORD_RE tokenizer twin |
| `src/vault/` | 473 (3 files) | storage custody | transcripts.ts adapter incomplete (no turnCount/body/mtime); no bud read adapter |
| `src/coach/` `src/piece/` | 1,407 / 589 | growth, outputs | clean; route clusters still rooted in server.ts |
| `src/loop/` `src/v2/` `src/auth/` `src/stt/` `src/log/` `src/jsonl.ts` | meta | key-store shared; v2 CHANNELS twin; CAPTURE_CHANNELS ×2; log floors pin server.ts |
| **web/** | ~10,410 | the client | seam verbs re-declared ×5; session-handle twins; parked rows ×3; /end flow ×3 (wire-type divergence); main.ts infrastructure movable |
| `src/registry.ts` | 1,052 | mechanism exposure | consistent — no dead/missing entries found in scope |

## 3. What already ran — rounds 1–3

Round two (commit `057dc60`): waves 0–3, the ratchets re-armed first,
then the server-root rule layers, the ktg/loader unifications, then the
client-root extraction — 2753 tests green.

Round three (commit `d765204`, 27 delegated slices in 5 waves, every wave
gated): the shared-primitives wave (resolveCite/citeParts/sittingsOfCites,
embedBatches, resolveOpener, PROTOCOLS deletion, FACETS collapse,
pieceWait fold), the structural wave (src/session/routes.ts 1,912,
compose-gate.ts, runJob/mintOne, harvest+reviews), the second server pass
(createClerk factory, exchange+dictation, key-store, coach transcript via
vault adapter), within-file deepening (open-question.ts, drm+mode, queue
field list, wiki-jobs collapse, jsonl.ts), and the sweep-up (import-review
seam, auth-sessions, lineage-mirror through the gate, Phase union,
VALID_FACETS). Final: tsc 0, 2754 vitest passing (1 skipped), web
typecheck 0, vite build green. Committed as `d765204` after the handoff
was written.

## 4. Round four — the fresh sweep

Five read-only scouts walked the post-round-three tree (server roots,
clerk/coach/piece, wiki/queue/elicitor/index, web, instruments/storage/
conformance). ~70 evidence-backed findings, every claim file:line-verified,
every "dead" claim cross-checked against the mechanism registry.

### What the sweep found — the next chunk of the system

The round-2/3 defect class ("one rule, N copies" in the obvious places)
is *mostly* exhausted — but not completely, and a new class dominates:

**The serialization truth is a lie (the one real bug).** Six QueueEntry
fields — `errandKind`, `errandPerson`, `patternId`, `derivedFrom`,
`operatorsUsed`, `lineageMirror` — are declared optional, written by
shipping code (composed.ts:779-780, compose-pattern.ts:52-54,
lineage-mirror.ts:323), and *never serialized*: `OPTIONAL_ENTRY_FIELDS`
(queue.ts:246-303) omits them, so `#write` drops all six and `#parseEntry`
can never read them back. The consequence is a live bug: lineage-mirror
dedupes on `e.lineageMirror` read from disk (lineage-mirror.ts:283-285),
so the "one mirror question per claim, ever" rule (Q-83) can never fire
across runs — the sweep re-mints every run. Because `add()` spreads
`QueueDraft`, TypeScript blesses the loss; only a conformance test can
guard it.

**The runtime rules are still written N ways** (the campaign's own class,
at level 6):

- **cite-parse ×7** — `citeParts`/`citeSnippetId` are canonical in
  wiki/status.ts:57-74 but clerk re-implements: wiki-jobs snippetIdOf
  (303-306), contradiction parseRef (158-165), mint splitCite (227-234,
  stricter `/^\d+$/`), gap-fill split('@')[0] (197-203), docket ×3 inline
  (229/362/881), compose-pattern ref.split('@') (46-47), lint inline
  lastIndexOf (408-410).
- **threshold numeric read ×13 with divergent defaults and unsafe `as
  number` casts** — wiki-jobs bound (313-315, default 0) + its acknowledged
  mirror in clash (546-547); bare `as number` at composed:512,
  lineage-mirror:125, docket:837/862, coach/license:290, coach/reflection:
  65, sounding/license:143/151 (NaN at runtime if unset); inline typeof
  with divergent defaults at docket:104-105 (45), docket-init:616-621 (0),
  import/reach:87 (2), semantic:319-328 (0/−∞), embedding:442-443 (+∞).
- **claim-liveness ×5** — `archived !== true && supersededBy ===
  undefined`: wiki-jobs:318-320, clash:149-151 (exported, unused by
  clerk), server.ts:1478, coach-seed:34 (different spelling),
  docket-init:459 (loosest — only `!supersededBy`).
- **shape trio ×2** (store.ts str/strArray 88-95 vs ops.ts
  filled/asStringArray/asRecord 83-96), **role-taking body check ×2**
  (ops.ts MINT 282-287 vs SUPERSEDE 395-401), **userTurn twin ×2** plus 4
  inline builders, **trigram keying ×3** in lexical.ts, **function-word
  closed class ×2** (lexical STOPWORDS vs lint FUNCTION_WORDS).

**The structural extractions (level 5).** wiki-jobs.ts (1,547) has one
coherent confirmation slice (~330 lines: confirmAnsweredRemeasures,
jobRangeDiscrimination, confirmingReadings, juxtaposition, recomputeStatus,
dissolve, recoverPoles, dissolutionOutcome) sharing one world-load
prologue ×5. docket.ts (1,332) has a 610-line runDocket body plus four
self-contained jobs (annotation trio + template sweep) that only sit
there for history. The expedition twin (docket.ts:1062-1090 vs 1092-1123)
is the same loop skeleton with different predicates — the round-2/3 drift
class alive inside one file. clerk/gap-fill.ts re-implements the cap+
dedupe sweep shape that sweep-core now owns for ktg (the composite
`bud\0failure` key is the one thing GapFillPointerKey cannot express).

**The composition roots still hold ~1,600 lines of domain routes.**
server.ts clusters: piece 413 (1714-2126), import 296 (941-1236), coach
283 (2128-2410), wiki 221 (1460-1680), waiting-surface 166 (774-939) —
each with a domain module ready to receive it (src/piece, src/import,
src/coach, src/wiki, src/session). Plus the server rule batch (17×
sessionOr404, 11× pieceOr404, 6× arrangementOr400, text-required ×5,
channel guard ×4, queueEntryOr404 ×3, loopback ×3, Set-Cookie ×2,
decisions-validation twin, CAPTURE_CHANNELS ×2, AUTHORS not homed, 404
message divergence, dead sweepTripwire import, module-scope pendingProsody
leak across app instances, twin SSE feeds, session-state maps root-owned).
web/main.ts (1,163): five surfaces re-declare the WebDepsShell verbs,
two byte-identical SessionState handle literals, and the movable
infrastructure (api 66, shell 84, wait 61, live 67) plus the material
screen (149 — mis-seamed by piece.ts's own header) and the auth/
unprompted/done screens.

**The vault seam is incomplete.** server.ts listSessions double-parses
transcripts (269-287), readTranscript uses the adapter only as an
existence probe (290-293), session/routes.ts mtime-scans the transcripts
dir (401-424), import/adopt.ts readdir+matter-parses transcripts
(167-204), import/repair.ts hand-rolls bud reads (247-254). The adapter
(transcripts.ts) lacks turnCount/chars/body/most-recently-modified; no bud
read adapter exists.

**The instruments.** Two competing coverage-status rules (explicit
frontmatter vs derived coverageForNode) with a production-dead write path
(writeReading has zero callers → territory gap-fill is inert while atlas
gap-fill mints on 'unprobed'). WORD_RE tokenizer twin (sounding/license
vs lexical TOKEN_RE). Park-pointer shape ×3 + queue kind list ×4. Dead
imports left by the round-3 adapter migration in target-default.ts and
strata.ts (noUnusedLocals is off, so tsc is silent). Region-authorship
stance coercion hardcoded in import/extract.

**Negative findings (registered, healthy):** the mechanism registry is
consistent for auth/stt/v2/log/session/docket-init/clerk/coach/piece;
no dead web exports; createClerk seam clean; jsonl delegation complete
(activity.ts stays direct by design); route-contract and emitted-kinds
scans tolerate extraction; log-format FLOORS (server.ts floor = 8 kinds,
~34 today) survive any single-cluster move.

## 5. The round-four plan — waves and domino logic

### The domino: Wave A — truth the store, single-home the runtime rules

The highest-leverage first move is the **serialization-truth fix** (the
one real bug) plus the **level-6 rule single-homing**. Why first: the
structural waves that follow (route extraction, module splits, web
infrastructure moves) move code, not vocabulary — they are only safe when
the vocabulary has one home. And the serialization fix changes what queue
entries *mean* on disk; everything after must run against the fixed
semantics. This is the same reasoning as round three's Wave A: the
primitives first, the domino that makes the rest dominoes easier.

Second-order effects composed:

- The QueueEntry fix wakes the lineage-mirror dedupe (a named behavior
  change: mints stop duplicating across runs) and makes /api/queue
  payloads carry the six fields — invisible to the UI, pinned by a new
  conformance test (OPTIONAL_ENTRY_FIELDS ⊇ every optional QueueEntry
  key, the CLAIM_FIELDS pattern).
- The threshold-read helper must take an explicit fallback per site —
  the defaults genuinely differ (45 vs 0 vs 2 vs ±∞) and collapsing them
  would be a silent behavior change. The two existing helpers (bound,
  clash's mirror) become the first two callers.
- The cite-parse collapse must preserve both semantics: citeSnippetId
  falls back to the full cite, parseRef/splitCite return null on
  malformed. The split-on-first-`@` sites are equivalent for ULID ids
  but must be verified against the strict form.

Wave A agents (one queue task, one main.ts task, one elicitor task, one
wide clerk/wiki/index task):

- **A1 (queue)** — serialization truth: add the six fields to
  OPTIONAL_ENTRY_FIELDS, document them; conformance test; lineage-mirror
  restart-survival test; plus the draw primitives (threadKeyOf,
  parkPointer helper folding sounding/park + protocols/park + the queue
  kind list, facetBalancedPool folding queue draw + randomizer deck
  draw). Files: queue.ts, types.ts, facet-balance.ts, randomizer.ts,
  sounding/park.ts, protocols/park.ts, registry.ts, tests.
- **A2 (clerk/wiki/index rules)** — cite-parse ×7 → citeParts/
  citeSnippetId; threshold reads ×13 → readNumber(t, fallback);
  isLive ×5 → clash's; shape trio; role-taking; userTurn; trigramsOf ×3;
  isFunctionWord (STOPWORDS/FUNCTION_WORDS). Files: ~24 across
  clerk/wiki/coach/sounding/import/index. registry.ts surgical appends.
- **A3 (web primitives)** — seam collapse: five surfaces extend
  WebDepsShell (exchange also WebDepsWithWait); SessionState handle
  factory (kills the twin literals); protocolLabel; backlogSentence;
  drm wire-shape interface + dead location.hash delete + canonicalOf
  no-op. Files: deps.ts, main.ts, exchange, waiting, wiki, piece, drm,
  mode, reviews, harvest, protocol-meta.
- **A4 (elicitor)** — opener→turn single home (greeting + pre-135),
  askedTexts ×4, pickUnusedBank (skipQuestion + drawFallback). Files:
  elicitor.ts.

### Wave B — vertical slices (structural + adapter)

The vault seam and the within-file megafunctions — the second-order
dominoes: each is a *coherent vertical slice* (server→vault, docket→
sweep, wiki-jobs→confirmation) that the Wave-A vocabulary makes safe.

- **B1** — wiki-jobs confirmation slice → `src/clerk/confirmation.ts`
  (+ loadWorld folding the ×5 world-load prologue; re-export seam keeps
  docket-init and the tests importing unchanged).
- **B2** — docket split: annotation trio + template sweep →
  `src/clerk/sweeps.ts`; expedition twin folded into one
  mintExpedition(predicate, compose); rotation-cursor helper.
- **B3** — sweep-core extension (optional composite keyFn on
  GapFillCandidate, additive so the two ktg wrappers churn zero) +
  clerk/gap-fill folded onto runGapFillSweepCore.
- **B4** — vault adapter vertical slice: transcripts.ts gains
  turnCount/chars/body/mostRecentlyModified; new src/vault/buds.ts;
  import/adopt and import/repair migrate to the adapters (decide the
  unresolved-reporting ownership first — the adapter skips unparseable
  transcripts); server.ts listSessions/readTranscript become two-line
  calls; session/routes.ts close block uses the mtime primitive.
- **B5** — web: three parked-row builders → one parkedRow helper;
  /end→reviews flow unified (one EndResponse wire shape; the drm
  status-gate made an explicit per-screen parameter, the divergence
  documented, not accidental).

### Wave C — composition roots 1 (server batch + web infrastructure)

The extraction wave — code, not vocabulary, moving now.

- **C1** — piece + coach route clusters → src/piece/routes.ts +
  src/coach/routes.ts (server.ts −700). Preserve: coachStore getter
  pattern, isPureRead on /api/coach/waiting, log-format floor.
- **C2** — web infrastructure moves: api() → web/client.ts (the 401/403
  rule's one home — dictation's divergent copy converges onto it),
  shell → web/shell.ts, wait → web/wait.ts (quiet-error single home),
  live → web/live.ts, auth screens → web/auth.ts, material → piece.ts.
  main.ts → ~500.
- **C3** — server rule batch II: CAPTURE_CHANNELS/AUTHORS homed,
  validateDecisions twin merged, 404 message unified ('unknown claim'),
  text-required/channel guards, queue.get(), loopback/cookie factories,
  sweepTripwire import deleted, pendingProsody into createApp closure,
  SSE /api/activity rides onAppend, createSessionState factory +
  sessionOr404 ×17 + DRM guards ×6. Region ownership: C1 owns
  server.ts:1714-2410, C3 owns the rest — disjoint, content-addressed
  edits.

### Wave D — composition roots 2 (import/wiki/waiting extraction) + instruments

- **D1** — import + wiki + waiting-surface clusters → src/import/routes.ts,
  src/wiki/routes.ts (+ src/wiki/page.ts for the ~90-line render),
  src/session/waiting.ts; droppedRegions → import/body.ts. server.ts −520.
- **D2** — instruments batch: WORD_RE → wordsOf (sounding/license +
  lexical); coverage two-rule asymmetry documented + conformance-pinned
  (deliberately NOT merged — merging changes territory rendering and
  sweep behavior simultaneously, a third-order product decision);
  region-authorship stance from the harvester; dead imports in
  target-default.ts/strata.ts; finishedDRM field deletion.

### Wave E — sweep-up and completion

The cheap deletions the gates surfaced (unified 404, dead hash, dead
imports, finishedDRM, any leftovers), then the final gate: tsc --noEmit,
vitest run (2754 baseline), tsc -p tsconfig.web.json, vite build; the
execution log appended to this document; HANDOFF.md refreshed.

### Composition rules (same as rounds 2–3, plus round-four specifics)

- At most one server.ts task, one main.ts task, one queue.ts task, one
  elicitor.ts task per wave — C1/C3 are the one exception, with explicit
  disjoint-region ownership.
- Cross-wave contracts pinned in the shared task context before
  dispatch (citeParts/citeSnippetId, readNumber's signature, the
  TranscriptMeta extension, the WebDepsShell/WithWait layering).
- New exports MUST be declared in src/registry.ts in the same change
  (mechanism-registry.test.ts sweeps src/ + web/); keep cluster
  internals module-private to dodge it.
- Extractions are behavioral no-ops: wire shapes byte-identical,
  e2e selectors preserved. Deliberate behavior changes are named in the
  execution log.
- Every wave ends with the full gate, so a regression is attributed to a
  wave, not the campaign.

## 6. Execution log

Wave-by-wave results appended below as they land (status, files,
verification numbers).

### Wave A — truth the store, single-home the runtime rules (landed, gate green: tsc 0 errors, 2757 vitest passing + 1 skipped, web typecheck 0 errors, vite build green)

- **A1 queue truth + primitives** — OPTIONAL_ENTRY_FIELDS gains the six
  write-only fields (errandKind/errandPerson/patternId/derivedFrom/
  operatorsUsed/lineageMirror); #write/#parseEntry are list-driven, so
  the fields now round-trip. **Named behavior fix: the Q-83 lineage-
  mirror dedupe now fires across restarts** (it read a field that was
  never persisted — re-minted every run; pinned by a new restart-survival
  test in tests/lineage-mirror.test.ts). New tests/queue-serialization
  .test.ts: conformance (OPTIONAL_ENTRY_FIELDS ⊇ every optional
  QueueEntry key, both directions) + six-field round-trip. Draw
  primitives: threadKeyOf (draw deferral filter + #deferThreadAfter
  Strikes), parkPointer in queue.ts (sounding/park + protocols/park
  delegate; the third 'parked-drm' builder was already deleted in slice 6
  — no dead third caller fabricated), facetBalancedPool in facet-balance
  .ts (queue draw + randomizer deckDraw compose through it; pinned log
  strings preserved byte-for-byte). Registry: +2 entries (parkPointer
  live, facetBalancedPool shadow).
- **A2 rule single-homing** — cite-parse ×7 folded onto citeParts/
  citeSnippetId (mint's splitCite deleted outright — its `/^\d+$/`
  strictness was unpinned; status.ts exports citeSnippetId now); readNumber
  added to thresholds.ts, all 18 enumerated threshold reads migrated with
  per-site fallbacks (no default collapsing); isLive ×5 (coach-seed was
  already semantically identical; **named change: docket-init's lineage-
  mirror filter now also excludes archived claims** — was the loosest
  `!supersededBy`-only copy); shape trio homed in ops.ts (store.ts's
  str/strArray deleted, 23 usages migrated); roleTakingBodyProblem in
  ops.ts (MINT/SUPERSEDE comment twin deleted); userTurn in contract.ts
  (8 inline builders collapsed); trigramsOf in lexical.ts (3 sites);
  isFunctionWord exported from lexical.ts, lint's FUNCTION_WORDS becomes
  EXTRA_WORDS composing it (superset preserved for namesOccasion).
  Registry: +7 entries. 26 files, surgical.
- **A3 web primitives** — five surfaces now extend WebDepsShell (Reviews
  /Mode/Drm/Harvest) or WebDepsWithWait+WebDepsShell (Exchange); one
  makeSessionHandle factory (the two literals proven byte-identical
  before folding); protocolLabel in protocol-meta.ts (3 drm-label sites;
  exchange's dynamic label renamed protocolTag to unshadow); backlog
  Sentence in panel-line.ts (waiting offer + wiki door); DrmTurnResponse
  interface (4 inline wire shapes); dead drm.ts hash re-trigger + main.ts
  canonicalOf no-op case deleted. Two inert structural members added
  (reviews beginWait, exchange text — grep-verified never called). No
  registry entries: web exports follow the protocolTitle precedent (the
  sweep scans src/ only).
- **A4 elicitor** — turnFromResolved owns the opener→turn mapping (both
  paths; the envelope difference handled at call sites); askedTexts ×4;
  pickUnusedBank shared by skipQuestion + drawFallback (selection
  semantics preserved: bankDraw vs uniform random stay distinct). One
  gate fix by the campaign owner: the helper's return type widened
  `questionForm` to optional, breaking exactOptionalPropertyTypes at the
  greeting pendingOpener build — narrowed to
  `Turn & { questionForm: QuestionForm }`. No export-surface changes,
  no registry entries.

Deliberate behavior changes this wave: (1) lineage-mirror dedupe now
fires across restarts; (2) /api/queue payloads now carry the six draft-
provenance fields; (3) docket-init's lineage-mirror claim filter now
also excludes archived claims.

Wave A gate: 176 test files, 2757 passed / 1 skipped (baseline 2754 —
the +3 are the serialization conformance + restart-survival tests), 44
files changed, +639/−657.

### Wave B — vertical slices (landed, gate green: tsc 0 errors, 2757 vitest passing + 1 skipped, web typecheck 0 errors, vite build green)

- **B1 wiki-jobs confirmation slice** — NEW src/clerk/confirmation.ts
  (506 lines): confirmAnsweredRemeasures, jobRangeDiscrimination,
  confirmingReadings, juxtaposition, recomputeStatus, dissolve,
  recoverPoles, dissolutionOutcome + a loadWorld helper folding the ×5
  world-load prologue (jobLint/jobCandidates/jobRemeasure now destructure
  from it too — the one deliberate cost: one extra unfiltered
  queue.list() per lint/candidates run, no test pins it). wiki-jobs.ts
  1,538 → 1,155; orchestrator, gates and graph memo untouched. Seam:
  `export { … } from './confirmation.js'` (the mechanism-registry sweep
  enumerates only FN_RE/CONST_RE declarations — re-export lines count as
  caller evidence, verified against the test's derivation). Registry:
  dissolutionOutcome moved + 5 entries added.
- **B2 docket split + folds** — NEW src/clerk/sweeps.ts (444 lines):
  the four self-contained jobs (referent annotations, intention-horizon
  annotations, outcome questions, one-time template sweep) moved
  VERBATIM (agent verified `MOVED BLOCK === ORIGINAL`); docket.ts 1,330 →
  928 with an import-and-re-export seam; the expedition twin folded into
  a module-private mintExpedition (per-draft log strings — 'minted
  expedition…' vs 'minted other-minds expedition…' — preserved
  byte-for-byte; the run-level expeditionMinted flag param'ed);
  rotate<T> extracted (still-true + outcome share the cursor/modulo
  rule). Registry: 4 entries moved to src/clerk/sweeps + rotate added.
- **B3 sweep-core fold** — runGapFillSweepCore extended ADDITIVELY
  (optional deps.pointerKeyFn for composite keys, optional
  deps.countClipped, coverage/pointerKey optional, GapFillCandidate.
  mintLog optional+guarded); the two ktg wrappers churn ZERO lines
  (verified numstat). clerk/gap-fill.ts now delegates both sweeps to the
  core with the bud\0failure composite key; the 'any status blocks
  re-minting' rule proven equivalent before folding; gap-fill-minted/
  clipped log strings byte-identical; one shared `now` per run (no test
  pins `at`).
- **B4 vault adapter slice** — TranscriptMeta gains optional turnCount/
  chars + readTranscriptBody + mostRecentlyModifiedTranscript; NEW
  src/vault/buds.ts (readBud on the marginalia pattern); import/adopt
  migrated (skip-reporting moved into the adapter via an optional onSkip
  callback — unparseable post-* transcripts now report in `unresolved`
  instead of crashing the run, a named behavior fix); import/repair
  readBud via the adapter; server.ts listSessions/readTranscript rerouted
  (output byte-identical; one premise correction: turnCount/chars have
  no writer today, the adapter parses them when the frontmatter declares
  them); session/routes.ts close block mtime-scan →
  mostRecentlyModifiedTranscript (same selection semantics). Registry:
  +3 entries. readVersion left alone (no snippets adapter exists — out
  of scope).
- **B5 web flow unify** — one parkedRow helper + pickUpParked skeleton
  (three rows, DOM byte-identical; the put-back verb uses a real U+2026,
  the pick-up rows a literal \u2026 — both preserved as-is); the
  /end→reviews flow: EndResponse unified to the server truth `{ status:
  string; sessionId: string }` (read from session/routes.ts:1707 — both
  fields; the drm-only {status} and exchange-only {sessionId} shapes
  died), one endAndGoToReviews helper with the drm status gate made an
  explicit gateOnHarvesting param (exchange: false, drm: true — per-
  screen behavior identical, divergence now documented). No registry
  entries (web exports aren't swept).

Deliberate behavior changes this wave: (1) adopt's unparseable post-*
transcripts report in `unresolved` instead of crashing the run; (2)
jobLint/jobCandidates pay one extra queue.list() per run for the unified
loadWorld prologue.

Wave B gate: 176 test files, 2757 passed / 1 skipped, 49 files changed
cumulative, +1,273/−1,829.

### Wave C — composition roots 1 (landed, gate green: tsc 0 errors, 2757 vitest passing + 1 skipped, web typecheck 0 errors, vite build green)

- **C1 piece + coach extraction** — NEW src/piece/routes.ts (497 lines,
  createPieceRoutes: 13 routes + 5 render helpers, 24/24 route paths,
  45/45 error strings, 26/26 emit kinds verified byte-identical) and
  NEW src/coach/routes.ts (365 lines, createCoachRoutes: 13 routes +
  buildCoachFacts + refreshAdviceInBackground). The coachStore GETTER
  pattern preserved (17 sites invoke `coachStore()` at request time);
  isPureRead on /api/coach/waiting verbatim. The piece prose / coach
  text-required + channel guards moved verbatim (single-homing deferred
  to the sweep-up wave). server.ts −715. Registry: +2 entries.
- **C2 web infrastructure moves** — NEW web/client.ts (api + isReadPath +
  GET_PREFIXES + the ONE 401/403 rule, init-wired; additive rawBody
  option), web/shell.ts (renderShell/clear/navWordOf/refreshInboxBadge —
  the WebDepsShell implementation co-located with its deps.ts
  declaration; clear() keeps the releaseWiki + surface + clock contract),
  web/wait.ts (WAIT_FAILED/Wait/showQuietError/beginWait + the quiet-
  error single home — piece.ts's locals deleted), web/live.ts
  (EventSource live-refresh), web/auth.ts (login/setup/done),
  web/unprompted.ts (the last screen with its own wireDictation), and
  the material screen → web/piece.ts (its header's claim made true).
  **F5 closed: dictation's 401 reimplementation converges onto client.ts
  api() — a 401 now throws a handled ApiError and the toggle catch skips
  the quiet mic line** (login replaces the page); non-401 transcribe
  failures throw ApiError instead of plain Error (console-only).
  mode.ts behind the seam (F3: text + storage verbs; localStorage and
  createTextNode through deps). main.ts 1,163 → 506. tests/route-contract
  .test.ts's GET_PREFIXES scan target moved to web/client.ts. No
  registry entries (web exports aren't swept).
- **C3 server rule batch II** — CAPTURE_CHANNELS single-homed in types.ts
  (CONST_RE does not match array literals — verified against the exact
  regex — so no registry entries needed); AUTHORS homed in import/
  contract.ts beside the type; NEW src/guards.ts (validateDecisions
  folding the harvest + import-decisions twin, requireText,
  checkedChannel — both messages byte-identical); 'claim not found' →
  'unknown claim' (the ONE user-visible message change this wave); NEW
  queue.get(id) (3 sites; corrupt entry file now 404s instead of 500);
  requireLoopback + sessionResponse + remoteAddrOf in src/auth/auth.ts;
  sweepTripwire dead import deleted; pendingProsody into createApp's
  closure (no cross-app leak in multi-app test processes); /api/activity
  SSE branch rides onAppend instead of a 2s poll (identical raw payloads
  + heartbeat; events now arrive immediately — the old poll could drop
  same-millisecond events); createSessionState factory + the 17
  sessionOr404 copies folded into one sessionOf + DRM guard family
  (drmRunningOf/drmStartedOf). 13 test files gained `get()` on their
  QueueStore fakes. Registry: +8 entries.

Three gate fixes by the campaign owner after C1/C3 landed: (1) server.ts
was calling createPieceRoutes/createCoachRoutes without importing them —
imports added; (2) sessionOf's bare Hono `Context` types `param(key)` as
`string | undefined` (the old 17 inline copies ran inside handler-typed
`c`) — sessionOf now takes the handler-read `sessionId: string`; (3)
PieceDeps.clerkModelName over-narrowed to `string` where the old inline
code passed the possibly-undefined binding through to
proposeArrangements(modelName?) — widened to `string | undefined`
(behavior identical).

Deliberate behavior changes this wave: (1) claim/read 404 message
'unknown claim' everywhere; (2) /api/activity SSE events arrive
immediately (no 2s poll window); (3) dictation 401 is a handled ApiError
(quiet mic line skipped); (4) a corrupt queue entry file 404s instead of
500ing.

Wave C gate: 176 test files, 2757 passed / 1 skipped, 68 files changed
cumulative, +1,932/−3,479. server.ts 2,681 → 1,943; main.ts 1,163 → 506.

### Wave D — composition roots 2 + instruments (landed, gate green: tsc 0 errors, 2758 vitest passing + 1 skipped, web typecheck 0 errors, vite build green)

- **D1 import+wiki+waiting extraction** — NEW src/import/routes.ts (335
  lines, createImportRoutes: 10 routes + importNext/importSurvey),
  NEW src/wiki/routes.ts (216 lines, createWikiRoutes: GET /api/wiki +
  the 5 claim verbs; direction uses the coachStore() getter for the
  same TDZ-safe late binding as createClerk), NEW src/wiki/page.ts (124
  lines, renderWikiPage — the ~90-line page render's pure seam:
  repair-taint, coreness scoring over the whole graph, FACETS-order
  grouping, open contradictions, lint notes), NEW src/session/waiting.ts
  (224 lines, createWaitingRoutes: anniversary, harvest-queue×2,
  unprompted (mutating the createSessionState maps BY REFERENCE), sweep-
  backlog, events — the streamSSE + onAppend subscription moved verbatim
  with its ssePayload projection). droppedRegions homed in src/import/
  body.ts beside classifyDroppedRun (why field re-typed to DroppedRunKind
  — same three values). server.ts 1,943 → 1,256; its emit-kind count is
  now exactly 8 — AT the log-format floor, which is why the STT/
  transcribe glue (~90 lines) was deliberately NOT extracted (moving it
  would break the floor). 12 dead import blocks pruned. Registry: +5
  entries.
- **D2 instruments + deletions** — wordsOf exported from lexical.ts
  (raw token stream, single-homed on TOKEN_RE); sounding/license's
  WORD_RE + frequencyIn compose through it (WORD_RE ≡ TOKEN_RE proven
  byte-identical; counting semantics unchanged, verified on 10 samples
  incl. the fixture turns). Coverage write-side asymmetry (F2/F12)
  DOCUMENTED + pinned, deliberately not merged: a comment block in
  ktg/coverage.ts + the registry reason name both consequences (territory
  sweep inert — needs 'evidenced'; atlas mints on 'unprobed') and a NEW
  tests/coverage-asymmetry.test.ts pins writeReading's zero shipping
  callers so a future writer-wave flips it deliberately. coerce
  AuthorshipStance exported from the harvester (STANCES owner); import/
  extract's avowal→report-of-fact coercion delegates (both members of
  the vocabulary, sets matched, no reconciliation needed). Dead imports
  deleted (target-default.ts, strata.ts). finishedDRM field + its
  DRMParkedState type import deleted (repo-wide grep: zero references
  after). Registry: +2 entries, 1 reason rewritten.

Deliberate behavior changes this wave: NONE — every change is an
extraction, a deletion of dead code, or an addition.

Wave D gate: 177 test files, 2758 passed / 1 skipped, 74 files changed
cumulative, +2,073/−4,219. server.ts 1,256.

### Wave E — sweep-up (landed, final gate green: tsc 0 errors, 2758 vitest passing + 1 skipped, web typecheck 0 errors, vite build green)

- **E1 readJsonl + cursor factory + store deepening** — src/jsonl.ts
  gains `readJsonl<T>(root, relPath, parse)` (the shared split→trim→
  parse→skip loop; all four copies — sweep lines, sweep deferrals, both
  embedding-cache loads — delegate; skip policies proven identical, no
  parameter needed) and `jsonCursorFile<T>(root, relPath, parse,
  stringify?)` (try/JSON.parse/type-check read, mkdir-parent write; the
  still-true/outcome cursor twins, the resume marker and the engagement
  ledger all delegate). F7 closed too: the four frontmatter readers fold
  onto a requireScalars helper (per-type tails untouched). **One gate
  fix by the campaign owner: requireScalars' `Record<string, string>`
  return indexed as `string | undefined` under noUncheckedIndexedAccess
  — made generic (`{ [P in K]: string }`).** **A second gate fix: the
  offset-cursor wire format broke** — the old writers wrapped the offset
  as `{"offset": N}`; the factory's default stringify wrote the bare
  number, which cursorOffset cannot parse (2 tests caught it: 'expected
  +0 to be 2/7'). The two wrappers now pass the stringify hook,
  restoring the format byte-identically.
- **E2 vector-store file pair** — ONE `vectorStoreFile<T>(path, parse)`
  factory in wiki/embedding.ts (load/save mechanics: missing → [],
  torn-line skip, parse callback, mkdir-parent + final newline) + a
  shared `pruneCache(cached, keepIds, store)` (delete-not-kept, save
  sorted by claimId); both fileEmbeddingStore and fileSnippetVectorStore
  become two-line wrappers; both persists delegate. The keyspace split
  stays deliberate (two files, two prunes — only the IO is shared).
  15/15 programmatic equivalence checks passed. Registry: +2 entries.
- **E3 piece/coach guards** — the 11 inline pieceOr404 + 6 arrangement
  guards in src/piece/routes.ts fold into module-private pieceOf +
  arrangementOf (sessionOf style); the deferred text/channel guards
  (piece prose, coach quest-return, artifact triple) ride guards.ts
  (requireText gained an optional message param — default keeps every
  existing caller byte-identical; the artifact combined message
  parameterized). Zero behavior changes; registry unchanged.

Deliberate behavior changes this wave: NONE (the two gate fixes restored
byte-identical behavior).

### Final gate

tsc 0 errors · 2758 vitest passing / 1 skipped (177 files) · web
typecheck 0 errors · vite build green.

## 7. Campaign tally

Round four: 5 scouts → ~70 findings → 17 delegated slices in 5 gated
waves, every wave verified green before the next started, plus 6 gate
fixes by the campaign owner (elicitor questionForm typing, server.ts
missing imports, sessionOf param typing, clerkModelName widening,
requireScalars generic, cursor wire format). 76 files changed,
+2,302/−4,423 lines.

The composition roots after round four:

| Root | Round 1 | Round 2 | Round 3 | Round 4 | Now |
|---|---|---|---|---|---|
| src/server.ts | 5,365 | 4,951 | 2,681 | 1,943 | **1,256** (−77% from round 1) |
| web/main.ts | 5,035 | 3,193 | 1,163 | 506 | **506** (−90% from round 1) |

The megafunctions split: docket.ts 1,332 → 928 (+ sweeps.ts 444);
wiki-jobs.ts 1,538 → 1,154 (+ confirmation.ts 506); the route clusters
live in src/piece/routes.ts (497), src/import/routes.ts (335), src/coach/
routes.ts (365), src/session/waiting.ts (224), src/wiki/routes.ts (216);
the page render in src/wiki/page.ts (124).

Round four's single-homed additions: OPTIONAL_ENTRY_FIELDS now covers
every QueueEntry key (serialization truth — the lineage-mirror dedupe
works across restarts), readNumber, citeParts/citeSnippetId consumers
everywhere, isLive, userTurn, roleTakingBodyProblem, trigramsOf,
isFunctionWord, threadKeyOf, parkPointer, facetBalancedPool,
validateDecisions, requireText, checkedChannel, requireLoopback,
sessionResponse, readJsonl, jsonCursorFile, vectorStoreFile, pruneCache,
requireScalars, wordsOf, coerceAuthorshipStance, sessionOf, pieceOf,
arrangementOf, createSessionState, CAPTURE_CHANNELS, AUTHORS,
createPieceRoutes, createCoachRoutes, createImportRoutes, createWikiRoutes,
createWaitingRoutes, renderWikiPage, readTranscriptBody,
mostRecentlyModifiedTranscript, readBud, endAndGoToReviews, parkedRow,
protocolLabel, backlogSentence, makeSessionHandle, client/shell/wait/live/
auth/unprompted web modules — every one of them a copy that used to exist
in N places.

Named behavior changes across the round (all deliberate, all pinned or
test-verified): lineage-mirror dedupe fires across restarts; /api/queue
carries the six draft-provenance fields; docket-init's lineage-mirror
filter excludes archived claims; adopt's unparseable post-* transcripts
report in `unresolved` instead of crashing; claim/read 404 is 'unknown
claim'; /api/activity SSE events arrive immediately; dictation 401 is a
handled ApiError; a corrupt queue entry file 404s instead of 500ing.

Deliberately NOT changed (documented with reasons): the coverage two-rule
status (pinned by tests/coverage-asymmetry.test.ts instead), the
STT/transcribe glue in server.ts (server emit-kind count is AT the
log-format floor of 8), the frontmatter reader tails (per-type variance),
the three JSON stores' deliberate mirror contract.
