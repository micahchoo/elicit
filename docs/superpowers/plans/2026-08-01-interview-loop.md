# Interview Loop (First Slice) Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user opens a local web page, declares a Mode, is interviewed by a local model through one Protocol, and ends the session with verbatim Snippets and their Facet+Stance Wiki readings written to disk as markdown.

**Architecture:** A TypeScript Node service owns three modules — elicitor (exchange state machine), harvester (cut proposal + code-enforced verbatim validation), vault (markdown persistence with an in-memory derived index) — behind a small HTTP API, with one focus-friendly Q&A page as the client. All LLM calls go through `@mariozechner/pi-ai` to a local OpenAI-compatible endpoint (Q-2, Q-10). LLM output is never trusted for the Sole Authorship invariant: every proposed cut is substring-checked in code (Q-1).

**Tech Stack:** TypeScript, Node ≥20, Hono (HTTP), Vite + vanilla TS (client), Vitest (tests), `@mariozechner/pi-ai` (LLM), gray-matter (frontmatter).

---

## Flow Map

```
mode-declare → question-select → exchange (loop: probe ⇄ answer) → harvest-propose → review-decide → persist
```

- **mode-declare**: user states time/energy; recorded on the session (Q-7).
- **question-select**: one Protocol in this slice (`reflective-interview`); opener chosen from a starter bank or the user's declared topic.
- **exchange**: multi-turn; agent probes via LLM; every turn appended to the Transcript (Q-8). Ends when the agent judges saturation or the user clicks "harvest now".
- **harvest-propose**: LLM proposes cuts (exact substrings of user turns only) with a Facet+Stance reading each; code validates substring-ness (Q-1); fragments failing standalone become Buds (Q-6).
- **review-decide**: per proposal — approve / trim (must remain a substring) / discard / restate (user's fresh prose).
- **persist**: Snippet `v1` files, Reading files citing `snippet@1` (Q-4), Bud files, final Transcript — all markdown (Q-3).

## File Structure

```
elicit/
  package.json, tsconfig.json, vitest.config.ts
  src/
    types.ts            — domain types + module contracts (Wave 0)
    llm.ts              — pi-ai wrapper: Complete fn type, local provider config
    vault/
      vault.ts          — read/write snippets, readings, buds, transcripts; index rebuild
    elicitor/
      protocol.ts       — reflective-interview Protocol: system prompt, starter bank, stop rule
      elicitor.ts       — exchange state machine, transcript accumulation
    harvester/
      harvester.ts      — cut proposal parsing, substring validation, bud fallback
    server.ts           — Hono app wiring sessions to modules
  web/
    index.html, main.ts, style.css   — Q&A screen (Q-9)
  vault/                — data root (gitignored); created at runtime
  tests/
    vault.test.ts, elicitor.test.ts, harvester.test.ts, e2e.test.ts
    fakes.ts            — scripted fake Complete fn
```

Vault layout (Q-3, Q-4, Q-5):

```
vault/
  snippets/<ulid>/v1.md     frontmatter: id, version, captured, provenance
                            {kind: harvest|restatement, session, question,
                             questionForm, span?}; body = verbatim user prose
  transcripts/<session>.md  frontmatter: session, mode, protocol, started;
                            body = "## agent" / "## user" turn blocks, append-only
  wiki/readings/<ulid>.md   frontmatter: id, facet, stance, cites: ["<id>@1"];
                            body = agent's one-line reading (agent prose is legal here)
  buds/<ulid>.md            frontmatter: id, captured, session, failures: [...];
                            body = verbatim fragment
```

---

### Task 1: Scaffold — repo, toolchain, directories

**Orient:** Everything downstream needs a running TypeScript toolchain with tests; the repo does not exist yet (only docs/).
**Flow position:** Step 0 of 6 — precedes all flow nodes.
**Skill:** `none`
**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (ignore `node_modules/`, `vault/`, `dist/`)

- [ ] **Step 1: Init repo and package**

```bash
cd /mnt/Ghar/2TA/DevStuff/notebook/elicit
git init && npm init -y
npm i hono @mariozechner/pi-ai gray-matter ulid
npm i -D typescript vitest vite tsx @types/node
npx tsc --init --module nodenext --target es2022 --strict --outDir dist
printf 'node_modules/\nvault/\ndist/\n' > .gitignore
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({});\n' > vitest.config.ts
```

- [ ] **Step 2: Verify toolchain**

Run: `npx vitest run --passWithNoTests && npx tsc --noEmit`
Expected: both exit 0

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold elicit toolchain"
```

### Task 2: Contracts — domain types [CHANGE SITE]

**Orient:** Every module consumes these types; they encode the CONTEXT.md domain model so invariants are visible in signatures.
**Flow position:** Wave 0 — contract producer for all later tasks.

<contracts>
**Downstream (types → all modules):**
- `type Facet = 'episode'|'general-event'|'lifetime-period'|'fact'|'construct'|'intention'|'value'|'causal-theory'` (Q-4; open set later, enum now)
- `type Stance = 'avowal'|'self-observation'|'report-of-fact'|'pole-preference'|'commitment'|'uncertainty-marked'|'superseded'`
- `type QuestionForm = 'deliberative'|'theoretical'|'why'`
- `type Mode = { minutes: number; energy: 'low'|'medium'|'high'; topic?: string }`
- `type Turn = { role: 'agent'|'user'; text: string; at: string; questionForm?: QuestionForm }` — present on agent turns; this is how the form survives into the Transcript
- `type CutProposal = { text: string; sourceTurn: number; facet: Facet; stance: Stance; reading: string; question: string; questionForm: QuestionForm }` — `question` and `questionForm` populated by `propose` from the eliciting probe's turn
- `type HarvestDecision = { proposal: number; action: 'approve'|'trim'|'discard'|'restate'; text?: string }`
- `type Complete = (system: string, turns: Turn[], opts?: {temperature?: number}) => Promise<string>` — the ONLY LLM seam; fakes implement it (Q-2 isolation)
- `interface Vault` — the persistence seam Tasks 5 and 6 compile and fake against; its members are exactly the Task 3 contract functions (`saveSnippet`, `saveVersion`, `saveReading`, `saveBud`, `startTranscript`, `appendTurn`, `rebuildIndex`)
- Behavioral invariant: `CutProposal.text` is untrusted until `harvester` substring-validates it (Q-1)
</contracts>

**Skill:** `none`
**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts` with the contract block above plus `Snippet`, `Reading`, `Bud`, `SessionState`, `Provenance` (incl. `questionForm: QuestionForm`), `Index`, and the `Vault` interface**
- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit** — `git commit -am "feat: domain types"`

### Task 3: Vault — markdown persistence [CHANGE SITE]

**Orient:** Persist node of the flow; the invariants live here — immutable versions (Q-5), markdown as truth (Q-3), readings cite snippet@version (Q-4).
**Flow position:** Step 6 of 6 (review-decide → **persist**); no downstream.

<contracts>
**Upstream (review-decide → this):**
- `saveSnippet(prose: string, provenance: Provenance): Snippet` — mints a ULID, writes `vault/snippets/<ulid>/v1.md`
- `saveVersion(snippetId: string, prose: string): Snippet` — writes `v(N+1).md` beside existing versions. NOTE: nothing in this slice calls it in normal operation (restatement is a NEW snippet, per Task 6) — it exists purely to hold Q-5 open and is exercised only by tests. Do not wire restatement into it.
- `saveReading(r: {facet, stance, reading, cites: string[]}): Reading`
- `saveBud(fragment: string, failures: string[], session: string): Bud`
- `startTranscript(session: string, meta: {mode: Mode, protocol: string, started: string}): void` — creates the transcript file with frontmatter (records Mode, Q-7)
- `appendTurn(session: string, turn: Turn): void` — append-only, throws if the transcript does not exist or the file would shrink (Q-8)
- `rebuildIndex(): Index` — scans files; no state survives it (Q-3)
- Behavioral invariant: no function ever mutates an existing snippet version file (Q-5)
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/vault/vault.ts`
- Test: `tests/vault.test.ts`

- [ ] **Step 1: Failing tests** — snippet roundtrip preserves prose byte-for-byte; `saveVersion` creates v2 and leaves v1 byte-identical; snippet file frontmatter contains NO `facet` or `stance` key (Q-4 negative assertion); reading cites `<id>@1`; `appendTurn` before `startTranscript` throws; append twice yields both turns in order; transcript frontmatter carries the Mode; `rebuildIndex` after process restart (new Vault instance) sees all files
- [ ] **Step 2: Run** — Run: `npx vitest run tests/vault.test.ts` Expected: FAIL (module missing)
- [ ] **Step 3: Implement `vault.ts`** (gray-matter frontmatter, ulid ids, tmp-dir root injected in tests)
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: vault persistence with immutable versions"`

### Task 4: [SPIKE] pi-ai against the local endpoint

**Orient:** Q-2 makes the local endpoint the only inference path; this spike answers whether `@mariozechner/pi-ai` can stream from it and pins the config shape for `src/llm.ts`.
**Flow position:** Feeds `exchange` and `harvest-propose` nodes; blocks nothing in Wave 1 except Task 7's real-model path.
**Skill:** `hybrid-research`
**Files:**
- Create: `src/llm.ts` (thin: `makeComplete(baseUrl, model): Complete`)

- [ ] **Step 1: Read pi-ai docs** (`npm view @mariozechner/pi-ai`, `mcp__context__get_docs("@mariozechner/pi-ai", "custom provider baseUrl openai-compatible")`) and identify the provider config for a custom OpenAI-compatible base URL
- [ ] **Step 2: Write `src/llm.ts` and a manual script** `npx tsx scripts/smoke-llm.ts` sending one prompt to the local server. `makeComplete` reads `ELICIT_LLM_BASE_URL` (default `http://192.168.0.229:8088/v1`) and `ELICIT_LLM_MODEL` (default `bonsai-27b`), and accepts per-call temperature: elicitor probes ~0.8, harvester ~0.1. Server params (n_ctx 16384) are sufficient for this slice — do not touch the server.
- [ ] **Step 3: Verify** — Run: `npx tsx scripts/smoke-llm.ts` Expected: a completion string printed from the local model at the default endpoint (llama.cpp serving `bonsai-27b`, verified live 2026-08-01)
- [ ] **Step 4: Commit** — `git commit -am "feat: pi-ai local completion seam"`

### Task 5: Elicitor — exchange state machine [CHANGE SITE]

**Orient:** This is the product's heart (session hypothesis: elicitation produces Snippets worth keeping); it must run fully against a fake `Complete` so tests don't need a model.
**Flow position:** Steps 2-3 of 6 (mode-declare → **question-select → exchange** → harvest-propose).

<contracts>
**Upstream (mode-declare → this):** `startSession(mode: Mode, deps: {complete: Complete, vault: Vault}): SessionState` — calls `vault.startTranscript`, picks opener from `protocol.ts` starter bank (each starter carries its `QuestionForm` tag), or from `mode.topic`.
**Downstream (this → harvest-propose):** `userTurn(s: SessionState, text: string): Promise<{kind:'probe', text: string, questionForm: QuestionForm} | {kind:'saturated'}>` — appends both turns via `s.deps.vault.appendTurn`; LLM-generated probes carry the Protocol's `defaultQuestionForm` (reflective-interview: `'deliberative'`), never model-classified; `'saturated'` after the Protocol's stop rule (max 6 probes, or the model emits the literal token `[SATURATED]`, or caller forces end).
- Behavioral invariant: every turn is in the Transcript before the function returns (Q-8).
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/elicitor/protocol.ts`, `src/elicitor/elicitor.ts`
- Test: `tests/elicitor.test.ts`, `tests/fakes.ts`

- [ ] **Step 1: Failing tests** — opener comes from starter bank when no topic; probe text returned verbatim from fake; transcript contains all turns in order; `[SATURATED]` from fake ends exchange; 7th probe never happens
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** — `protocol.ts` holds the system prompt (reflective interview, clean-language-leaning probes, instruction to emit `[SATURATED]` when the vein is dry), `defaultQuestionForm: 'deliberative'`, and ~10 starter questions each tagged with its `QuestionForm`
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: elicitor exchange loop"`

### Task 6: Harvester — cuts, validation, buds [CHANGE SITE]

**Orient:** Sole Authorship is enforced here in code — the model proposes, the substring check disposes (Q-1); failures become Buds, not edits (Q-6).
**Flow position:** Steps 4-5 of 6 (exchange → **harvest-propose → review-decide** → persist).

<contracts>
**Upstream (exchange → this):** `propose(session: string, transcript: Turn[], complete: Complete): Promise<{proposals: CutProposal[], buds: Bud[]}>` — each proposal carries `questionForm` copied from the eliciting probe's `Turn.questionForm` — prompts for JSON cuts+readings; any `text` not an exact substring of a user turn is DROPPED with a logged warning (never patched); cuts the model flags as not-standalone go to buds with `failures:['standalone']`.
**Downstream (this → persist):** `decide(session: string, proposals: CutProposal[], decisions: HarvestDecision[], vault: Vault): {snippets: Snippet[], buds: Bud[]}` — `trim` text must be a substring of the proposal (else rejected); `restate` saves user text as a NEW snippet with `provenance.kind='restatement'` (never via `saveVersion`); `Provenance` is built from `session` + the proposal's `question` and `questionForm` and goes in the snippet — readings carry only `facet, stance, reading, cites` (Q-4).
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/harvester/harvester.ts`
- Test: `tests/harvester.test.ts`

- [ ] **Step 1: Failing tests** — fake returns one valid cut + one fabricated (not-substring) cut → only valid becomes a proposal, fabricated dropped; not-standalone → bud with failure recorded; trim outside proposal rejected; restate persists with restatement provenance; approve persists reading citing `<id>@1`
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** (JSON-mode prompt in-module; `String.prototype.includes` on raw user turns for validation)
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: harvester with code-enforced verbatim invariant"`

### Task 7: Server — HTTP wiring

**Orient:** Glue only: sessions in memory, modules do the work; no business logic in handlers.
**Flow position:** Spans all nodes; upstream = web client, downstream = elicitor/harvester/vault contracts from Tasks 3, 5, 6.
**Skill:** `tdd`
**Files:**
- Create: `src/server.ts`
- Test: `tests/e2e.test.ts`

<contracts>
**LLM selection (this task defines it; Tasks 8 and 9 consume it):** env var `ELICIT_LLM=fake|local`, default `fake`. `fake` wires `tests/fakes.ts`'s scripted `Complete`; `local` wires `makeComplete` from `src/llm.ts` (Task 4).
</contracts>

Endpoints: `POST /api/session {mode}` → `{sessionId, question}` · `POST /api/session/:id/turn {text}` → probe | saturated `{proposals}` · `POST /api/session/:id/end` → `{proposals}` · `POST /api/session/:id/harvest {decisions}` → `{snippets, buds}` · `GET /api/snippets`

- [ ] **Step 1: Failing e2e test** — full scripted session: mode → opener → 2 turns → end → decisions (one approve, one restate, one discard) → assert files exist on disk with correct frontmatter and byte-identical prose
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement server.ts** (Hono; `serve` on 127.0.0.1:4517; static-serve `web/dist` when built)
- [ ] **Step 4: Run** — Run: `npx vitest run tests/e2e.test.ts` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: http api"`

### Task 8: Q&A screen

**Orient:** The user-facing promise: a quiet writing app that happens to ask questions (Q-9) — one column, focus dimming, typewriter feel, probes in the dimmed layer, harvest review inline.
**Flow position:** Client of every endpoint in Task 7; no downstream.
**Skill:** `interface-design:interface-design`
**Files:**
- Create: `web/index.html`, `web/main.ts`, `web/style.css`, `vite.config.ts`

- [ ] **Step 1: Build the three screen states** — (a) Mode declaration: two quiet selects + optional topic, single column; (b) Exchange: question large at center, growing textarea, previous turns dimmed above, Enter submits, "harvest now" as a marginal action; (c) Harvest review: proposals as blocks with approve/trim/discard/restate, each reading shown dimmed in the margin
- [ ] **Step 2: Style per docs/interface-references.md** — one duospace/serif face, monochrome base, no borders/cards, caret vertically centered while answering
- [ ] **Step 3: Verify** — Run: `npx vite build` Expected: exit 0. Then: `npx tsx src/server.ts & SRV=$!; sleep 2; curl -s localhost:4517 | grep -c elicit; kill $SRV` Expected: ≥1 (note: `$!` is the npx wrapper — if a later run can't bind 4517, kill by port: `fuser -k 4517/tcp`); then manual walkthrough of a full session in the browser with `ELICIT_LLM=fake` (the Task 7 default)
- [ ] **Step 4: Commit** — `git commit -am "feat: focus-friendly q&a screen"`

### Task 9: Real-model session + hypothesis check

**Orient:** The slice exists to test "elicitation with a local model produces Snippets worth keeping" — this task runs it for real and records the verdict.
**Flow position:** End-to-end across all nodes with the Task 4 `Complete` instead of the fake.
**Skill:** `none`
**Files:**
- Create: `docs/superpowers/plans/2026-08-01-interview-loop.RESULTS.md`

- [ ] **Step 1: Run** `ELICIT_LLM=local npx tsx src/server.ts`, complete one genuine session (Micah answering), harvest
- [ ] **Step 2: Verify invariants on disk** — Run: `grep -rL 'version: 1' vault/snippets/*/v1.md | wc -l` Expected: 0. Then: `for c in $(grep -rhoE '[0-9A-HJKMNP-TV-Z]{26}@[0-9]+' vault/wiki/readings/*.md); do test -d "vault/snippets/${c%@*}" || echo "DANGLING $c"; done` Expected: no output, AND `grep -rhoE '[0-9A-HJKMNP-TV-Z]{26}@' vault/wiki/readings/*.md | wc -l` ≥ 1 so the check cannot pass vacuously
- [ ] **Step 3: Record verdict** in RESULTS.md: snippets kept per exchange (the yield metric from research §c), probe quality notes, Facet distribution for this Mode (Q-7), and whether the loop felt worth returning to
- [ ] **Step 4: Commit** — `git commit -am "test: first real-model session results"`

---

## Execution Waves

- Wave 0: Tasks [1, 2] (serial) — scaffold, then contracts
- Wave 1: Tasks [3, 4, 5, 6] (parallel) — depends on Wave 0; 5 and 6 test against `tests/fakes.ts`, not Task 4
- Wave 2: Tasks [7, 8] (parallel) — depends on Wave 1 (7 needs 3+5+6; 8 needs 7's endpoint shapes from types)
- Wave 3: Task [9] (serial) — depends on Waves 1-2 including the Task 4 spike

## Open Questions

### Flow Contracts
- (resolved) `questionForm` travels: Protocol tag → agent `Turn.questionForm` → `CutProposal.questionForm` → snippet `Provenance`. Readings never carry it (Q-4).

### Wave 1
- **Task 4: pi-ai spike**
  - ~~Q (Blocking): Which local model server and model?~~ RESOLVED: llama.cpp server at `http://192.168.0.229:8088/v1`, model id `bonsai-27b` (27B gguf, n_ctx 16384, health 200 verified 2026-08-01). Use as defaults in `src/llm.ts`, overridable via `ELICIT_LLM_BASE_URL` / `ELICIT_LLM_MODEL`.
  - Q: Does pi-ai accept an arbitrary `baseUrl` for its OpenAI-compatible provider, or does it need a custom provider registration? (spike answers)
- **Task 5: Elicitor**
  - Q: Is `[SATURATED]`-token stop reliable on small local models, or does the stop rule need to be probe-count-only? (exploratory; fake-tested either way)
- **Task 6: Harvester**
  - Q: Can the local model produce valid JSON cut lists, or does the prompt need a line-oriented format? (exploratory; parser should tolerate both)

### Wave 2
- **Task 8: Q&A screen** — (none — fully specified by docs/interface-references.md)

### Wave 3
- **Task 9** — Q: What yield (snippets kept per exchange) counts as "working"? Research anchor: structured-interview ≈1 informative proposition/min; record, don't gate.

### Next slice (no action in this plan)
- The `## agent` / `## user` transcript body format has no slot for `questionForm`/`question` metadata. Safe here because sessions live in memory and `propose` gets the live `Turn[]`; the moment anything resumes a session or re-harvests from a stored transcript, the Provenance chain silently degrades. Extend the transcript block format when that work arrives.

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `package.json` | create | `"@mariozechner/pi-ai"` |
| `src/types.ts` | create | `type CutProposal` |
| `src/vault/vault.ts` | create | `rebuildIndex` |
| `src/llm.ts` | create | `makeComplete` |
| `src/elicitor/protocol.ts` | create | `[SATURATED]` |
| `src/elicitor/elicitor.ts` | create | `startSession` |
| `src/harvester/harvester.ts` | create | `failures: ['standalone']` |
| `src/server.ts` | create | `/api/session` |
| `web/index.html` | create | `elicit` |
| `web/main.ts` | create | `harvest` |
| `web/style.css` | create | `--dim` |
| `vite.config.ts` | create | `defineConfig` |
| `.gitignore` | create | `vault/` |
| `tests/fakes.ts` | create | `Complete` |
| `tests/vault.test.ts` | create | `leaves v1 untouched` |
| `tests/elicitor.test.ts` | create | `SATURATED` |
| `tests/harvester.test.ts` | create | `fabricated` |
| `tests/e2e.test.ts` | create | `byte-identical` |
<!-- PLAN_MANIFEST_END -->

## Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-1 | Sole Authorship enforced in code (substring check) | Task 6 (Wave 1), Task 9 Step 2 |
| Q-2 | Local models only | Task 4 (Wave 1), Task 9 |
| Q-3 | Markdown source of truth, rebuildable index | Task 3 (Wave 1) |
| Q-4 | Facet/Stance live in Wiki readings, cite snippet@version | Task 2, Task 6 |
| Q-5 | Immutable snippet versions | Task 3 |
| Q-6 | Failed admissibility → Buds | Task 6 |
| Q-7 | Mode is constraint, not objective; track facet-by-mode | Task 5, Task 9 Step 3 |
| Q-8 | Append-only transcripts | Task 3, Task 5 |
| Q-9 | Focus-friendly editor aesthetic | Task 8 (Wave 2) |
| Q-10 | pi-ai as the only LLM seam | Task 2 (`Complete`), Task 4 |
| Q-11 | No fluency-based quality signals | Task 6 (readings carry no confidence score) |

## Shape Changes

| Date | Role | Change |
|------|------|--------|
| 2026-08-01 | resolver | Task 4 blocking question resolved: endpoint `http://192.168.0.229:8088/v1`, model `bonsai-27b` (llama.cpp, verified live). |
| 2026-08-01 | author | Round-3 (final, plan APPROVED): `question: string` added to `CutProposal`; Task 6 builds `Provenance` from `session` + proposal's `question` + `questionForm`; next-slice note recorded (stored-transcript format lacks a questionForm slot — matters only when sessions resume from disk). |
| 2026-08-01 | author | Round-2 fix: QuestionForm carrier chain completed — `Turn.questionForm?` (agent turns), `CutProposal.questionForm`, `session` param on `propose`/`decide`; stale Flow Contracts question rewritten as resolved chain; `ELICIT_LLM_BASE_URL` name unified; Task 9 cites-check regex made non-vacuous; Task 8 kill-by-port note. |
| 2026-08-01 | author | Review fixes: `Vault` interface added to Task 2 contracts (+`Provenance`, `Index`); Task 3 gains `saveVersion` (tests-only, holds Q-5) and `startTranscript` (records Mode, Q-7); QuestionForm assignment specified (tagged starters + protocol default, never model-classified); Task 6 places `questionForm` in snippet provenance, not readings (Q-4); `ELICIT_LLM=fake\|local` defined in Task 7; Task 4 env defaults inlined; Task 8 skill annotation corrected, codebook ref (disabled skill) dropped; tsx/.gitignore/vitest.config added to Task 1; Task 8/9 verify commands made self-contained; manifest rows added. |
