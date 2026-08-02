# Bulk Import and Review Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person points Elicit at a folder of their own writing and it becomes dated sittings — one sitting per piece, `started` set to when the prose was written, every Snippet an exact substring of its source file, nothing written until that piece has been read and accepted, and a second run of the same folder importing nothing twice.

**Architecture:** One new namespace, `src/import/`, owns every concern in this ticket and is created wholesale here. It is a pipeline with four stages and a store between each: **scan** (folder → refusals and identified items, no model), **store** (a staging record per item under `vault/imports/`, which is not corpus), **extract** (the real harvest path, run ahead of review in the docket under 047's single-flight), and **commit** (one accepted item → one dated sitting). The review surface is the harvest review pointed at an imported piece (Q-58), and it lives in a new file `web/import-review.ts` that takes its helpers by injection, so the one edit to `web/main.ts` is three lines.

Nothing in `src/import/` reimplements what already exists. `propose()` and `decide()` are the harvest path unchanged; `quotedSpans` / `isQuotedFromSource` / `admissible` come from `src/harvester/admissibility.ts`; the body pipeline that `scripts/ingest-posts.ts` proved against 47 real posts is **moved** into `src/import/body.ts` and the script re-points at it, so there is one copy of each rule and the script stays the auditable record of what was ingested on 2026-08-02.

**Tech stack:** unchanged — TypeScript (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`), gray-matter, ulid, Hono, Vitest, `node:crypto` for the content hash. No new dependency. No socket: the only input is a path on the local filesystem (Q-57).

---

## What is already true, and must stay true

`scripts/ingest-posts.ts` ran against `/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts` on 2026-08-02 and put **19 dated sittings** in `vault/transcripts/` (`post-<slug>.md`, `protocol: import`, `started` spanning 2017→2026). That is not a rehearsal to be redone. Two consequences run through this plan:

1. **The 19 are already in.** A scan of that same folder must skip them, and the skip must key on the same identity every other skip keys on — the content hash (Q-59). T8 is the task that adopts them; without it the acceptance criterion "re-running imports nothing twice" fails on the first real run, against the one corpus that matters.
2. **The script's manifest does not become a feature.** `MANIFEST` and `EXCLUDED` in the script are 47 hand-written judgements — which sections are a literature review, which post is a portfolio index, which five items are co-authored. Q-57 says that judgement is where it belongs: *assembling the folder* is the manual, explicit, once-only act. So the surface has no `dropSections`, no `keepUntil`, no per-item `keepQuotes`. **The folder is the manifest.** What survives from the script is only what is mechanical: `clean`, `dropCitedParagraphs`, `toTurns`, and the cut-level Q-51 test.

### The seven behaviours the script established

Each appears below as a task that holds it, so none of them can be lost by being nobody's job:

| # | Behaviour | Held by |
|---|---|---|
| 1 | One item, one sitting, dated to when the prose was written | T7 (commit), T3 (the date rule) |
| 2 | Frontmatter is not the person's prose — body only | T2 (body), T3 (hash excludes frontmatter) |
| 3 | Q-51 enforceable here: co-authored items excluded whole, with a reason | T9, T10 (item-level exclude) |
| 4 | Quoted and cited passages excluded at cut level | T2 (paragraph rule), T5 (cut rule, against the raw file) |
| 5 | `channel: 'pasted'` on everything imported | T7 (and the 048 seam — see Open Questions) |
| 6 | Split on paragraph boundaries, never mid-sentence | T2 (`toTurns`) |
| 7 | Dry run before write, always | T4 (the staging record IS the dry run) |

---

## Flow Map

```
a folder of files on disk          ← THE ONLY DOOR (Q-57). No socket, ever.
      │
      ▼  POST /api/import/scan          synchronous, no model call
 import/scan.ts ──frontmatter date?──no──▶ REFUSED, with a reason. Nothing written. Never guessed.
      │ yes
      ▼  hash the BODY (Q-59 identity)
 import/store.ts ──hash already known?──yes──▶ SKIPPED  ("re-running imports nothing twice")
      │ no
      ▼  write vault/imports/<hash>.md, status: pending
      │       ↑ NOT corpus: no transcript, no snippet, no reading. The dry run, as a file.
      │
      ▼  startDocket('import')          extraction runs AHEAD of review, 047 single-flight (Q-58)
 import/extract.ts ── body.ts: clean → dropCitedParagraphs → toTurns (paragraph boundaries)
      │               propose() — the real harvest path: 044 gate, Q-1 substring check
      │               Q-51 at cut level, against the RAW SOURCE FILE
      ▼  status: extracted; cuts + their offsets into the source body
      │                                  the browser may have been closed for a week
      ▼  GET /api/import/next
 web/import-review.ts — the piece renders WHOLE, in order, cuts marked IN PLACE
      │   three verbs at the point of attention:  approve · trim · discard   (NO restate)
      │   one item at a time. No batch accept. No Target control (Q-60).
      │   item level: exclude, with a written reason — "this one is joint" (Q-51)
      ▼  POST /api/import/<hash>/decisions
 import/commit.ts ── re-read the SOURCE FILE; body hash still matches? ──no──▶ stale → a NEW item (Q-59)
      │               every kept text an exact substring of the SOURCE FILE,
      │               never of the transcript the importer itself wrote
      │               any failure → NOTHING is written for this item
      ▼  ONE DATED SITTING: started = frontmatter date, protocol 'import', NO Target
         snippets: kind 'unprompted', channel 'pasted'; readings from the cut's own labels
      │
      ▼  the next item waits. Nothing else has been written.
```

---

## Standing rules for every task below

These repeat the shape the Clerk plan established, because the same failures are available here:

1. **Nothing reaches the corpus before an accepted review.** `vault/imports/` is a staging area. Only `commit.ts` calls `startTranscript`, `appendTurn` or the snippet path, and it is called from exactly one route.
2. **Verify against the source file, never against our own output.** Every substring assertion reads the file on disk. An importer that verifies its own transcript verifies nothing — this is the acceptance criterion, and it is checked twice (extract drops, commit refuses).
3. **A refusal is recorded with its reason and is never a guess.** No date → refused. No mtime, no inference, no per-item prompt (Q-57).
4. **A new Activity Log kind lands with its sentence.** `tests/emitted-kinds.ts` derives every kind emitted from `src/` and `tests/log-format.test.ts` asserts each has a sentence. A task that emits a kind adds its formatter in the same task or turns the suite red (Q-23).
5. **One item per model call.** `propose()` already sends one user turn per `complete()`. Extraction adds no second payload shape.
6. **Every LLM-touching job is try/catch isolated** and records its failure on the item's own record, with an attempts counter. An item that fails extraction three times sorts to the back and stops standing at the door — the head-of-queue rule the Clerk plan established, applied to imports.
7. **Bounds are live, not shadow (Q-56).** The per-run extraction budget ships as a real cap and emits `threshold-clipped` when it clips.
8. **A mechanism is not done until something calls it.** This repo's most repeated defect is code built, tested and reaching nothing — ticket 077 counts five that shipped inert. Two places in this plan are exactly that shape and each carries an explicit wiring assertion rather than a signature: `adoptPriorIngest` (T8, called by T9's scan route, asserted in T8 Step 4) and the `channel` parameter on `decide()` (T7 Step 4, asserted by reading `channel: 'pasted'` back off disk). Where a task adds a parameter or a function, its verification names the caller.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/import/contract.ts` | Types only: `ImportRecord`, `ImportStatus`, `RefusalReason`, `ImportCut`, `ImportDecision`, `ScanResult`. No logic, no imports from the rest of `src/import/`. |
| `src/import/body.ts` | The proven body pipeline, moved out of the script: `clean`, `dropCitedParagraphs`, `toTurns`. Pure functions, no I/O. |
| `src/import/scan.ts` | Folder → `ScanResult`. Reads files, parses frontmatter, computes the body hash, produces refusals with reasons. No model, no writes. |
| `src/import/store.ts` | The staging records under `vault/imports/`. Read, write, list by status, know a hash. The only file that knows the record's on-disk shape. |
| `src/import/extract.ts` | The docket job. Pending records → prepared turns → `propose()` → Q-51 filter → cuts with offsets, written back to the record. |
| `src/import/commit.ts` | One reviewed item → one dated sitting. All-or-nothing. The only writer to the corpus in this namespace. |
| `src/import/adopt.ts` | One-time reconciliation with `scripts/ingest-posts.ts`: the 19 sittings it wrote become `accepted` records, its 12 `EXCLUDED` groups become `excluded` records carrying their reasons. Called from the scan route, idempotent. |
| `web/import-review.ts` | The review surface: the piece whole, cuts marked in place, three verbs, item-level exclude. Takes DOM/API helpers by injection. |
| `tests/import-*.test.ts` | One suite per module, plus `tests/import-acceptance.test.ts` for the five ticket criteria. |
| `tests/fixtures/import-folder/` | A small folder standing in for a corpus: dated, undated, co-authored, quoted, cited. |

**Modified:**

| File | Change | Owner |
|---|---|---|
| `scripts/ingest-posts.ts` | Six local functions deleted; imports three from `src/import/body.ts` and two from `src/harvester/admissibility.ts`. `selectBody` stays — it is manifest judgement. `MANIFEST` and `EXCLUDED` stay and gain an export: they are the record, and T8 reads the reasons out of them. | T2, T8 |
| `src/clerk/docket.ts` | One optional structural dep, `runImportJobs?`, run last and guarded. No import of `src/import/`. | T6 |
| `src/types.ts` | `DocketReport` gains `imports?`. | T6 |
| `src/server.ts` | The import job injection, the re-trigger loop, four routes. | T6, T9 |
| `src/log/format.ts` | Sentences for the new kinds. | T3, T5, T6, T7 |
| `web/main.ts` | Three lines: a `Screen` member, a `navTo` case, the call into `web/import-review.ts`. | T11 |
| `src/harvester/harvester.ts` | `decide()` learns to carry a capture channel — **only if 048 has not already landed that seam.** See Open Questions. | T7 |

---

## Wave 0 — the contract

### Task 1: Import types — the shape every later task writes against [NEW FILE]

**Orient:** Six tasks in three waves write and read one on-disk record; if each invents its own shape, the review surface and the committer will disagree about what a cut is, and the disagreement will surface as a lost snippet rather than as a type error.
**Flow position:** Step 1 of 13 — consumed by every task in Waves 1–4 (**contract** → scan → store → extract → commit → routes → surface).
**Skill:** `none` (types only, no behaviour to test)
**Files:**
- Create: `src/import/contract.ts`

<contracts>
**Downstream (this-node → every other node):**

```ts
export type ImportStatus =
  /** Scanned and identified. No model has seen it. Nothing is in the corpus. */
  | 'pending'
  /** Cuts proposed and written back. Waiting for a person to read it. */
  | 'extracted'
  /** Reviewed and committed as a dated sitting. Terminal. */
  | 'accepted'
  /** Refused whole by the reader, with a reason (Q-51). Terminal. */
  | 'excluded'
  /** Extraction failed `attempts` times. Sorts to the back; never silently retried forever. */
  | 'failed'
  /** The source file changed after scanning. Terminal — the new body is a NEW item (Q-59). */
  | 'stale';

export type RefusalReason =
  | 'no-frontmatter'   // no YAML block at all
  | 'no-date'          // Q-57: never guessed, never mtime
  | 'unparsable-date'  // present but not a date we can read
  | 'empty-body'       // frontmatter only — nothing of the person's prose
  /**
   * A changed file whose source path already has an accepted record, with no
   * frontmatter `lastmod` to date the second sitting (Q-59). Distinct from
   * 'no-date' because the file HAS a date — reusing the first sitting's date
   * is what is refused, and a reader told "no date in its frontmatter" would
   * go looking for a field that is sitting right there.
   */
  | 'no-lastmod';

export type ImportCut = {
  text: string;
  /** Offset of `text` in the SOURCE BODY. Earliest occurrence wins (ticket 024's rule). */
  at: number;
  facet: string;
  stance: string;
  reading: string;
};

export type ImportRecord = {
  /** sha256 of the source BODY, first 12 hex chars. Identity under Q-59. */
  hash: string;
  sourcePath: string;
  /**
   * The sitting date, ISO day, decided once at admit time and never
   * recomputed: frontmatter `date` for a source path seen for the first time,
   * frontmatter `lastmod` for a source path that already has an accepted
   * record (Q-59's second sitting). Never inferred, never an mtime.
   */
  date: string;
  lastmod?: string;
  title?: string;
  status: ImportStatus;
  attempts: number;
  /** Present once extraction has run. */
  cuts?: ImportCut[];
  /** Present on 'accepted'. The session id of the sitting this became. */
  sessionId?: string;
  /**
   * Present on 'accepted'. The exact texts written as Snippets — approvals as
   * proposed, trims as trimmed. Q-59 dedupe reads this: a later import of the
   * same source path does not re-propose what was already kept, so an edited
   * post offers only what is new.
   */
  kept?: string[];
  /** Required on 'excluded'. The reader's words for why. */
  excludeReason?: string;
  /** Present on 'failed'. */
  failure?: string;
};

export type ImportDecision = {
  /** Index into the record's `cuts`. */
  cut: number;
  action: 'approve' | 'trim' | 'discard';
  /** Required for 'trim'; must be a substring of the cut's text. */
  text?: string;
};
```
- Behavioural invariant: `restate` is absent from `ImportDecision['action']` **by construction** (Q-58). It is not a runtime check that can be relaxed; the type has no such member.
- Behavioural invariant: no field on `ImportRecord` carries a Target, and none is added later (Q-60).
- Behavioural invariant: `excludeReason` is the whole of the item-level Q-51 refusal, and it is **not** a fourth `ImportDecision` action. Exclusion is a property of the piece; the three verbs are properties of a cut. Ticket 058 §3 requires the surface to record "this one is joint" and have it mean something; Q-60's caution — that a per-piece control competes with the three verbs for attention — governs *where* that control sits, not whether it exists. It sits in the header region of the review, away from the cuts. See T10.
</contracts>

- [ ] **Step 1: Write the file**

Exactly the block above, with the doc comments. Two comments earn their place and must be written: on `hash`, *why the body and not the whole file*; on the absence of `restate`, *why a 2018 essay cannot be restated*.

- [ ] **Step 2: Verify it compiles and asserts what it claims**

Write `tests/import-contract.test.ts` with one type-level test:

```ts
import { expectTypeOf } from 'vitest';
import type { ImportDecision, ImportRecord } from '../src/import/contract.js';

it('has no restate verb — Q-58 drops it by construction', () => {
  expectTypeOf<ImportDecision['action']>().toEqualTypeOf<'approve' | 'trim' | 'discard'>();
});

it('carries no Target — Q-60', () => {
  expectTypeOf<ImportRecord>().not.toHaveProperty('target');
});
```

Run: `npx vitest run tests/import-contract.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add src/import/contract.ts tests/import-contract.test.ts
git commit -m "import: the record contract — no restate, no Target"
```

---

## Wave 1 — the pipeline, taken from the script that proved it

### Task 2: Body pipeline — move it out of the script, unchanged [MOVE + CHARACTERIZE]

**Orient:** `scripts/ingest-posts.ts` holds three functions measured against 47 real posts and 295 hand-marked cuts; the surface needs them, and a copy would drift from the record on the first bugfix — so they move, and a characterization test proves the move changed nothing.
**Flow position:** Step 2 of 13 in the import flow (folder → **body pipeline** → extract). Consumed by T5.
**Skill:** `characterization-testing`
**Files:**
- Create: `src/import/body.ts`
- Create: `tests/import-body.test.ts`
- Create: `tests/fixtures/import-folder/` (five files, listed in Step 1)
- Modify: `scripts/ingest-posts.ts:269-405` (delete `clean`, `dropCitedParagraphs`, `toTurns`, `quotedSpans`, `isQuotedFromSource`; import the first three from `src/import/body.js` and the last two from `src/harvester/admissibility.js`)

<contracts>
**Downstream (body → extract):**
- `clean(md: string, keepQuotes: boolean): string` — strips Hugo shortcodes, images, link-only lines, bare URLs, raw HTML, and (unless `keepQuotes`) blockquote lines.
- `dropCitedParagraphs(text: string): { kept: string; dropped: number }` — drops whole paragraphs carrying an inline academic citation, plus the `ORPHAN_QUOTES` list.
- `toTurns(text: string, at: string, maxWords?: number): Turn[]` — splits on paragraph boundaries only, packing to ~320 words. **Never mid-sentence:** `propose()` verifies each cut against its own turn, so a split through a sentence destroys any cut spanning it.
- Behavioural invariant: every function is pure. No `fs`, no `process.env`, no clock.
- Behavioural invariant: `keepQuotes` keeps its parameter but **the surface always passes `false`** — the script's per-post override was a manifest judgement, and Q-57 moves that judgement to folder assembly.
</contracts>

- [ ] **Step 1: Build the fixture folder**

`tests/fixtures/import-folder/` — five files, each earning its place by being a case the real corpus contained:

| File | Frontmatter | Body holds |
|---|---|---|
| `dated-essay.md` | `date: 2018-09-01`, `lastmod: 2018-09-01`, `title` | four first-person paragraphs, one image line inside a paragraph |
| `undated.md` | `title` only, no `date` | ordinary prose — the refusal case |
| `co-authored.md` | `date: 2022-01-01` | "we" throughout — the Q-51 item-level case |
| `quoted.md` | `date: 2020-03-01`, `title` | three quotation cases — spelled out below |
| `frontmatter-only.md` | `date: 2021-01-01` | nothing after the YAML block |

`quoted.md` carries the strings that Steps 2 and T5 assert on, so its body is specified here in full rather than described. Write it exactly:

```markdown
I believe technology can play a big role in this practice, and the last four
years have mostly been me testing that against places where it did not.

Care is not a feeling you arrive with. It is “to think of care beyond a moral
disposition, or a good intention, extending its senses to a material doing”,
and holding that has changed how I run a workshop.

The logic of care is better geared to living with a diseased body than the
logic of choice is, which is the argument I keep returning to (Mol 2008).

> “Wikipedia's knowledge gaps are not accidental
and the histories that count as encyclopaedic are chosen, not found.”

The last time I ran an editathon I said as much out loud, and someone asked
me who decides what counts, which I did not have an answer for.
```

Four properties this fixture holds, each load-bearing for a later assertion:

1. **Paragraph 1** is the author's own prose, adjacent to a citation paragraph — it proves `dropCitedParagraphs` drops the cited paragraph and keeps its neighbour rather than the block around it.
2. **Paragraph 2** wraps a curly-quoted passage inside the author's own sentence. This is Q-51 at cut level in its ordinary form: `quotedSpans` finds the span in the raw file *and* in the prepared turn, so the harvester's existing turn-scoped check catches a cut lifted from it.

   **Its line wrap is load-bearing — do not reflow it.** The quoted text is character-for-character the entry in `ORPHAN_QUOTES` (`src/import/body.ts`, moved from the script), and it survives `dropCitedParagraphs` *only* because the fixture breaks the line between `a moral` and `disposition,` where the `ORPHAN_QUOTES` string has a space: `p.includes(q)` is false across the newline. Reflow the paragraph onto one line and the orphan-quote rule fires, the whole paragraph is dropped before extraction, and this case silently stops existing — the test still passes, because no cut is proposed, but it has stopped testing the turn-scoped path it was written for. That is the worst failure available to a fixture, so the wrap is stated here and the fixture rule below forbids editing it.
3. **Paragraph 3** ends in `(Mol 2008)` — the citation form `dropCitedParagraphs` matches (the year sits immediately before the closing paren).
4. **Paragraph 4** is the case only the raw-source check can catch, and it is built deliberately: the opening `“` sits on a **blockquote line**, and the closing `”` sits on the ordinary line under it with **no blank line between them**. In the raw file that is one paragraph, so `quotedSpans(raw)` returns the whole two-line span. `clean(md, false)` then drops the blockquote line, and the prepared text keeps only `and the histories that count as encyclopaedic are chosen, not found.”` — a line carrying a closing mark and no opening one, so `quotedSpans` of the *turn* finds nothing and the turn-scoped check passes it. T5 asserts the raw-source check drops it.

Fixture rule (`.claude/rules/test-fixtures.md`): these are new. No later task edits them to make a test pass; a new case gets a new file. In particular, T5 asserts against paragraph 4 as written here and must not reshape it.

- [ ] **Step 2: Write the characterization test against the CURRENT script behaviour**

Import the three functions *from the script's current location is impossible* (they are module-private), so pin the behaviour by output instead: run each function over `quoted.md`'s body and assert the exact strings.

```ts
it('drops a paragraph carrying an inline citation, keeps the author around it', () => {
  const { kept, dropped } = dropCitedParagraphs(body);
  expect(dropped).toBe(1);
  expect(kept).toContain('I believe technology can play a big role');
  expect(kept).not.toContain('(Mol 2008)');
});

it('splits only on paragraph boundaries', () => {
  const turns = toTurns(body, '2020-03-01T00:00:00.000Z', 40);
  for (const t of turns) expect(body).toContain(t.text.split('\n\n')[0]!);
  expect(turns.every((t) => /[.!?"”]$/.test(t.text.trim()))).toBe(true);
});
```

Run: `npx vitest run tests/import-body.test.ts`
Expected: FAIL — `Cannot find module '../src/import/body.js'`.

- [ ] **Step 3: Move exactly four things, verbatim**

Move **by name, not by line range** — a range drags in neighbours that must not move:

| Move to `src/import/body.ts` | Why |
|---|---|
| `clean` | mechanical: shortcodes, images, link-only lines, bare URLs, raw HTML, blockquotes |
| `dropCitedParagraphs` | mechanical: the paragraph-level citation rule |
| `ORPHAN_QUOTES` | `dropCitedParagraphs` reads it; moving one without the other breaks the function |
| `toTurns` | mechanical: paragraph-boundary splitting |

Move the **code and every comment**, in particular the long comment on `dropCitedParagraphs` explaining why the citation regex stays narrow — widening it was measured: it closes the hole and also drops seven more paragraphs, five of them Micah's own prose. That comment is the reason nobody re-derives the rule from first principles.

**`selectBody` does NOT move.** It implements `dropSections` and `keepUntil`, which are manifest judgement — which headings are a literature review, where a post decays into install steps — and Q-57 keeps that judgement in folder assembly, not in the surface. It stays in the script, which calls it at two sites (`scripts/ingest-posts.ts:507` and `:592`) and is the only caller it will ever have.

**`quotedSpans` and `isQuotedFromSource` do not move either** — they are duplicates. Both already exist, exported, in `src/harvester/admissibility.ts`, measured there at 7 of 7 quoted cuts with zero false positives across the other 288. Step 4 deletes the script's copies and sources them from admissibility; `src/import/body.ts` never defines them.

Run: `npx vitest run tests/import-body.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 4: Re-point the script and prove it still runs**

In `scripts/ingest-posts.ts`: delete `clean`, `dropCitedParagraphs`, `ORPHAN_QUOTES`, `toTurns`, `quotedSpans` and `isQuotedFromSource`; keep `selectBody` and both its call sites; import the first three from `../src/import/body.js` and the last two from `../src/harvester/admissibility.js`.

Verify nothing else referenced the deleted names before deleting: `grep -n 'quotedSpans\|isQuotedFromSource\|ORPHAN_QUOTES\|selectBody' scripts/ingest-posts.ts` — expect `selectBody` at its definition plus `:507` and `:592`, and the two predicates at their definitions plus the dry-run and apply paths.

Run: `npx tsc --noEmit && npx tsx scripts/ingest-posts.ts 2>&1 | head -3`
Expected: typecheck clean; the script prints `Pass --dry or --apply. --dry first; the vault has no backup.` and exits 2. **Do not run `--dry` or `--apply`** — `--dry` costs an hour of model time and `--apply` writes to the vault.

- [ ] **Step 5: Commit**

```bash
git add src/import/body.ts tests/import-body.test.ts tests/fixtures/import-folder scripts/ingest-posts.ts
git commit -m "import: move the proven body pipeline out of the one-off script"
```

---

### Task 3: Scan — a folder becomes items and refusals, and no date is ever guessed [NEW FILE]

**Orient:** This is where Q-57 lives or dies: a file with no frontmatter date must come back refused with a reason, because under Q-50 the date is the only thing that makes an imported sitting independent evidence, and a guessed date corrupts that silently and permanently.
**Flow position:** Step 3 of 13 (folder → **scan** → store). Upstream: a path string from the route. Downstream: `store.ts` writes what this returns.
**Skill:** `tdd`
**Files:**
- Create: `src/import/scan.ts`
- Create: `tests/import-scan.test.ts`
- Modify: `src/log/format.ts` (sentences for `import-scanned`, `import-refused`)

<contracts>
**Upstream (route → scan):** `scanFolder(root: string): ScanResult` — `root` is an absolute path on the local filesystem. Recurses; reads `*.md` and `*.markdown`.

**Downstream (scan → store):**
```ts
type ScannedItem = {
  hash: string; sourcePath: string; date: string;
  lastmod?: string; title?: string;
  /** The body, frontmatter stripped. What the reviewer will read whole. */
  body: string;
};
type ScanResult = { items: ScannedItem[]; refused: { sourcePath: string; reason: RefusalReason }[] };
```
- Behavioural invariant: **the hash covers the BODY only**, never the frontmatter. Two reasons, both load-bearing. Frontmatter is not the person's prose (ruled 2026-08-02), so it cannot be part of that prose's identity; and measured on the real corpus, 6 of 47 files share `lastmod: 2026-02-22` from one site-wide touch — hashing frontmatter would make a generator's timestamp bump look like a new document and mint six duplicate sittings.
- Behavioural invariant: **the sitting date is frontmatter `date`.** `lastmod` is read and carried but is *not* the first-import date. Measured: 11 of 47 files have `lastmod` ≠ `date`, and 6 of those 11 share one bulk-touch day — dating first imports by `lastmod` would collapse six sittings onto 2026-02-22 and quietly narrow the span that Q-50 independence rests on. `lastmod` is used only for Q-59's second sitting on a changed file (T7).
- Behavioural invariant: this function never writes and never calls a model.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a file with no frontmatter date, with a reason, and imports nothing', () => {
  const r = scanFolder(FIXTURE);
  expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'undated.md'), reason: 'no-date' });
  expect(r.items.map((i) => i.sourcePath)).not.toContain(join(FIXTURE, 'undated.md'));
});

it('refuses a file whose body is empty after the frontmatter', () => {
  expect(scanFolder(FIXTURE).refused).toContainEqual({
    sourcePath: join(FIXTURE, 'frontmatter-only.md'), reason: 'empty-body',
  });
});

it('hashes the body, so a frontmatter-only edit is the same item', () => {
  const before = scanFolder(FIXTURE).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
  bumpLastmod(join(FIXTURE_COPY, 'dated-essay.md'), '2026-02-22');
  const after = scanFolder(FIXTURE_COPY).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
  expect(after.hash).toBe(before.hash);
});

it('hashes the body, so a body edit is a different item', () => { /* … expect not.toBe */ });

it('takes the sitting date from `date`, never from `lastmod` or the mtime', () => {
  const item = scanFolder(FIXTURE).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
  expect(item.date).toBe('2018-09-01');
});
```

The frontmatter-bump tests copy the fixture to a tmpdir first — the fixture folder is never mutated.

Run: `npx vitest run tests/import-scan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `scanFolder`**

`readdirSync` recursive → gray-matter each file → `data.date` present and parseable or push a refusal → `createHash('sha256').update(content.trimEnd()).digest('hex').slice(0, 12)`.

Dates arrive from YAML as `Date` objects or strings depending on quoting; normalise both to `YYYY-MM-DD` and refuse anything else as `unparsable-date`.

Run: `npx vitest run tests/import-scan.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Add the log sentences**

`import-scanned` → `read 47 files: 45 to import, 2 refused`. `import-refused` renders **one sentence per reason**, because standing rule 3 makes the reason the point and a wrong reason is worse than a bare count — it sends the reader looking for a field that is already there:

| reason | sentence |
|---|---|
| `no-frontmatter` | `<file> has no frontmatter — not imported` |
| `no-date` | `<file> has no date in its frontmatter — not imported` |
| `unparsable-date` | `<file> has a date that could not be read — not imported` |
| `empty-body` | `<file> is frontmatter and nothing else — not imported` |
| `no-lastmod` | `<file> changed since it was imported, and has no lastmod to date the new version — not imported` |

The detail line carries a path, and `scrubIds` leaves paths alone; keep the basename only, not the full path.

Run: `npx vitest run tests/log-format.test.ts`
Expected: PASS — no kind without a sentence.

- [ ] **Step 4: Commit**

```bash
git add src/import/scan.ts tests/import-scan.test.ts src/log/format.ts
git commit -m "import: scan a folder — body-hash identity, and no guessed dates"
```

---

### Task 4: The staging store — the dry run, as a file [NEW FILE]

**Orient:** "Nothing is written before a review is accepted" is one of the five acceptance criteria, and this is the file that makes it structural: the store is where an unreviewed import lives, and it is not the corpus.
**Flow position:** Step 4 of 13 (scan → **store** → extract → review → commit). Every later stage reads and writes through it.
**Skill:** `tdd`
**Files:**
- Create: `src/import/store.ts`
- Create: `tests/import-store.test.ts`

<contracts>
**Upstream (scan → store):** `ScannedItem[]`.
**Downstream (store → extract / routes / commit):**
```ts
createImportStore(vaultRoot: string): ImportStore
type ImportStore = {
  /**
   * Writes records for items whose hash is unknown, deciding each record's
   * `date` (see the date invariant below). Returns what it did — including
   * refusals, because a second sitting with no `lastmod` is refused here
   * rather than at scan time, where the accepted records are not visible.
   */
  admit(items: ScannedItem[]): {
    added: string[];
    skipped: string[];
    refused: { sourcePath: string; reason: RefusalReason }[];
  };
  knows(hash: string): boolean;
  get(hash: string): ImportRecord | null;
  /** The prepared prose fed to the harvester. Body of the record file. */
  prepared(hash: string): string;
  put(record: ImportRecord, prepared?: string): void;
  list(status?: ImportStatus): ImportRecord[];
  /** Oldest-first by date, so a corpus imports in the order it was written. */
  nextExtracted(): ImportRecord | null;
  nextPending(): ImportRecord | null;
};
```
- Behavioural invariant: records live at `vault/imports/<hash>.md`, gray-matter, frontmatter = `ImportRecord`, body = the prepared prose. Markdown is the truth (Q-3).
- Behavioural invariant: `admit` skips a **known hash at any status** — accepted, excluded, failed and stale all count as known. Re-running imports nothing twice, including things the reader refused.
- Behavioural invariant: **`admit` sets the record's `date`, and it is the only place that decides it.** For a `sourcePath` with no accepted record, `date` is the scanned frontmatter `date`. For a `sourcePath` that already has an accepted record, this is Q-59's second sitting on a changed file, so `date` is the scanned `lastmod` — and where `lastmod` is absent the item is **refused** under Q-57 rather than falling back to `date`, because dating the second sitting to the first sitting's day would put two independently-written versions on one date and destroy exactly the drift evidence Q-59 exists to preserve. The branch lives here rather than in `scan.ts` (which has no store and must stay pure) or in `commit.ts` (which would then hold a second, contradictory date rule).
- Behavioural invariant: nothing in this file touches `vault/snippets/`, `vault/transcripts/` or `vault/wiki/`.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('admits an unknown hash and skips a known one', () => {
  expect(store.admit(items).added).toHaveLength(3);
  // toMatchObject, not toEqual: `admit` also returns `refused`, and an exact
  // match here would red out on a signature change rather than a behaviour one.
  expect(store.admit(items)).toMatchObject({
    added: [], skipped: expect.arrayContaining([items[0]!.hash]),
  });
});

it('dates a repeat source path to lastmod — Q-59 second sitting', () => {
  store.put({ ...record, sourcePath: P, status: 'accepted', date: '2024-01-01' });
  store.admit([{ ...changed, sourcePath: P, date: '2024-01-01', lastmod: '2026-05-17' }]);
  expect(store.get(changed.hash)!.date).toBe('2026-05-17');
});

it('refuses a repeat source path with no lastmod rather than reusing the first date', () => {
  store.put({ ...record, sourcePath: P, status: 'accepted' });
  const r = store.admit([{ ...changed, sourcePath: P, lastmod: undefined }]);
  expect(r.added).toEqual([]);
  // 'no-lastmod', not 'no-date' — the file has a date; what is missing is the
  // one field that can date a SECOND sitting without collapsing it onto the first.
  expect(r.refused).toContainEqual({ sourcePath: P, reason: 'no-lastmod' });
});

it('skips a hash the reader excluded — a refusal is remembered', () => {
  store.put({ ...record, status: 'excluded', excludeReason: 'co-authored with Paul' });
  expect(store.admit([item]).added).toEqual([]);
});

it('writes no snippet, transcript or reading', () => {
  store.admit(items);
  for (const d of ['snippets', 'transcripts', 'wiki']) {
    expect(existsSync(join(root, d))).toBe(false);
  }
});

it('round-trips a record and its prepared prose through disk', () => { /* … */ });
it('returns items oldest-first, so a corpus imports in written order', () => { /* … */ });
```

Run: `npx vitest run tests/import-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement, then pass**

Note the 048 hazard when writing frontmatter: a **present** key holding `undefined` throws in `matter.stringify` (js-yaml: "unacceptable kind of an object to dump") and loses the whole write, not just the field. Conditional spread for every optional field, never `lastmod: record.lastmod`.

Run: `npx vitest run tests/import-store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Decide `vault/imports/` against `.gitignore`**

`vault/.gitignore` excludes only derived, rebuildable things (Q-3) and the credential. An import record is neither: it is the decision record for what entered the corpus and why something did not. It stays **tracked**. Add no ignore line; add a one-line comment in `store.ts` saying so, because the next reader will wonder.

- [ ] **Step 4: Commit**

```bash
git add src/import/store.ts tests/import-store.test.ts
git commit -m "import: the staging store — a dry run that survives a closed browser"
```

---

## Wave 2 — extraction ahead of review, and the one path into the corpus

### Task 5: Extract — the real harvest path, run before anyone sits down [NEW FILE]

**Orient:** Q-58 pays the ~40s-per-chunk cost before the person arrives, so review is instant and resumable; this task is that job, and it is also where Q-51's cut-level rule reads the raw source file rather than the prose the importer prepared.
**Flow position:** Step 5 of 13 (store → **extract** → store → review). Upstream: `ImportRecord` with `status: 'pending'`. Downstream: the same record with `status: 'extracted'` and `cuts`.
**Skill:** `tdd`
**Files:**
- Create: `src/import/extract.ts`
- Create: `tests/import-extract.test.ts`
- Modify: `src/log/format.ts` (`import-extracted`, `import-extract-failed`, `import-quoted-dropped`)

<contracts>
**Upstream (docket → extract):**
```ts
runImportExtraction(deps: {
  store: ImportStore;
  complete: Complete;
  readSource: (path: string) => string;
  log: (e: { at: string; actor: string; kind: string; detail: string }) => void;
  budget?: number;          // items per run; default 5, LIVE (Q-56)
  attemptsBeforeFailed?: number;  // default 3
}): Promise<{ extracted: number; remaining: number; failed: number }>
```
**Downstream (extract → review):** each record gains `cuts: ImportCut[]`, each cut's `at` an offset into the **source body**, and `status: 'extracted'`.
- Behavioural invariant: the prepared prose is `toTurns(dropCitedParagraphs(clean(body, false)).kept, `${date}T00:00:00.000Z`)` — blockquotes always dropped, citation paragraphs always dropped, splits on paragraph boundaries only.
- Behavioural invariant: **Q-51 at cut level reads the RAW SOURCE FILE**, not the turn: `isQuotedFromSource(cut.text, quotedSpans(rawFile))`, the same predicates `propose()` already applies turn-scoped, applied again against a wider source.

  **The route by which the wider source sees more, stated precisely, because the obvious version of it does not exist.** `quotedSpans` discards any span containing a blank line, so a quotation whose opening mark was removed *with its whole paragraph* is not a span in the raw file either — dropping a paragraph cannot create this case. What creates it is `clean` removing lines from **inside** a paragraph: a blockquote line, a link-only line, an image line or a shortcode line carrying the opening `“`, with the rest of the quotation continuing on the ordinary lines under it and **no blank line anywhere in the run**. In the raw file that is one paragraph and one span; in the prepared turn the opening mark is gone, so `quotedSpans(turn)` returns nothing and the turn-scoped check passes a cut that is plainly someone else's sentence. `quoted.md` paragraph 4 (T2 Step 1) is built as exactly this case.
- Behavioural invariant: a cut that is **not** an exact substring of the source body is dropped here with a reason, never carried to review. (`clean` deletes lines from within a paragraph, so the surviving lines can become adjacent when they were not — the same mechanism as above, seen from the substring side.)
- Behavioural invariant: **Q-59 dedupe runs HERE, before review, never after it.** For a record whose `sourcePath` matches an already-`accepted` record, drop any proposed cut whose exact text appears in that record's `kept` list. The edited post then offers only what is new. Doing this before review is what keeps it compatible with T7's all-or-nothing rule: a deduped cut is never shown, so a reviewer can never approve one and have it silently vanish at commit.
- Behavioural invariant: one item at a time, sequentially. The local model is a single GPU.
</contracts>

- [ ] **Step 1: Write the failing tests** (fake `Complete`, no real model)

```ts
it('proposes cuts and marks the record extracted', async () => {
  const r = await runImportExtraction({ ...deps, complete: scripted([cutsFor('dated-essay')]) });
  expect(r.extracted).toBe(1);
  expect(store.get(hash)!.status).toBe('extracted');
});

it('drops a cut whose quotation is only visible in the raw file', async () => {
  // quoted.md paragraph 4: the opening “ sits on a blockquote line that `clean`
  // removes from INSIDE the paragraph, so the prepared turn keeps a closing mark
  // with no opening one. quotedSpans(turn) sees nothing; quotedSpans(raw) sees
  // the whole two-line span. Propose the tail sentence and expect it dropped.
  const ORPHANED_TAIL = 'and the histories that count as encyclopaedic are chosen, not found.';
  await runImportExtraction({ ...deps, complete: scripted([cut(ORPHANED_TAIL)]) });
  expect(store.get(quotedHash)!.cuts!.map((c) => c.text)).not.toContain(ORPHANED_TAIL);
});

it('proves the turn-scoped check alone would have passed that cut', () => {
  // Guards the test above against becoming vacuous: if the prepared turn ever
  // starts yielding a span that COVERS THIS CUT, the raw-source check has
  // stopped doing distinct work and the invariant it defends lives elsewhere.
  //
  // Scoped to this cut's span on purpose. The prepared turn legitimately holds
  // other spans — quoted.md paragraph 2 survives preparation by design, which
  // is what makes it the turn-scoped case — so asserting the turn has NO spans
  // would assert against the fixture rather than against the behaviour.
  expect(quotedSpans(preparedTurnText).some((s) => s.includes(ORPHANED_TAIL))).toBe(false);
  expect(quotedSpans(rawFileText).some((s) => s.includes(ORPHANED_TAIL))).toBe(true);
});

it('does not re-propose a cut already kept from the same source path (Q-59)', async () => {
  store.put({ ...acceptedRecord, status: 'accepted', kept: [FIRST_SITTING_SENTENCE] });
  await runImportExtraction({ ...deps, complete: scripted([cut(FIRST_SITTING_SENTENCE), cut(NEW_SENTENCE)]) });
  const texts = store.get(secondHash)!.cuts!.map((c) => c.text);
  expect(texts).toEqual([NEW_SENTENCE]);
});

it('records every cut at its offset in the source body, earliest occurrence first', async () => {
  const cut = store.get(hash)!.cuts![0]!;
  expect(sourceBody.slice(cut.at, cut.at + cut.text.length)).toBe(cut.text);
});

it('honours the per-run budget and reports what remains', async () => {
  const r = await runImportExtraction({ ...deps, budget: 2 });
  expect(r).toMatchObject({ extracted: 2, remaining: 3 });
});

it('fails an item after three attempts instead of blocking the head of the queue', async () => {
  const throwing = { ...deps, complete: async () => { throw new Error('model down'); } };
  for (let i = 0; i < 3; i++) await runImportExtraction(throwing);
  expect(store.get(hash)!.status).toBe('failed');
  expect(store.get(hash)!.failure).toContain('model down');
});

it('writes nothing to the corpus', async () => { /* snippets/transcripts still absent */ });
```

Run: `npx vitest run tests/import-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Loop pending records oldest-first up to `budget`; prepare; `propose(session, turns, complete)` where `session` is `import-<hash>` (provisional — the committed sitting takes its own id in T7). Then, in this order: drop cuts that are not exact substrings of the source body; drop cuts caught by the raw-source Q-51 check; drop cuts already kept from an accepted record with the same `sourcePath` (Q-59 dedupe); compute offsets; `store.put`. Wrap each item in try/catch, increment `attempts`, set `failed` at the threshold. Emit `threshold-clipped` when the budget clips (Q-56).

The order matters in one place only: dedupe runs last, so a cut that is both a duplicate and inadmissible is logged under the reason that would keep it out on its own merits.

Run: `npx vitest run tests/import-extract.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 3: Log sentences, then commit**

Run: `npx vitest run tests/log-format.test.ts tests/import-extract.test.ts`
Expected: PASS both.

```bash
git add src/import/extract.ts tests/import-extract.test.ts src/log/format.ts
git commit -m "import: extraction ahead of review, Q-51 read against the source file"
```

---

### Task 6: Docket wiring — the cost is paid before the person sits down [MODIFY]

**Orient:** Extraction must run under 047's single-flight so two runs never overlap and a browser that closes mid-import loses nothing; this task is the injection, and it copies the shape `runWikiJobs` already established rather than inventing a second one.
**Flow position:** Step 6 of 13 (extract → **docket** → server). Upstream: `runImportExtraction`. Downstream: `DocketReport.imports`, and a re-trigger when work remains.
**Skill:** `tdd`
**Files:**
- Modify: `src/clerk/docket.ts:23-55` (deps), `:214-235` (the guarded tail)
- Modify: `src/types.ts` (`DocketReport.imports?`)
- Modify: `src/server.ts:376-436` (`runDocketNow` injection and the re-trigger)
- Modify: `src/log/format.ts` (`import-run`)
- Create: `tests/import-docket.test.ts`

<contracts>
**Upstream (server → docket):**
```ts
runImportJobs?: () => Promise<{ extracted: number; remaining: number; failed: number }>;
```
Structural and optional, **exactly** like `runWikiJobs`: `src/clerk/docket.ts` must not import anything from `src/import/`. The docket is the older, smaller thing; the import layer depends on it, not the reverse. Absent means no import work this run, and every existing caller behaves as it did.

**Downstream (docket → server):** `DocketReport` gains `imports?: { extracted: number; remaining: number; failed: number }`.
- Behavioural invariant: the import job runs **last**, after the wiki jobs, and is try/catch isolated. Extraction is the slowest thing in the run and no other job may wait on it. A throw costs the import job only; the index, the minted questions and the expiry are already on disk.
- Behavioural invariant: the server re-triggers `startDocket('import')` when `remaining > 0` **and** `extracted > 0`. The second half is the loop guard: if a run extracts nothing, re-triggering forever burns the GPU on items that will keep failing.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('runs the import job last and carries its counts in the report', async () => {
  const order: string[] = [];
  const report = await runDocket({ ...deps,
    runWikiJobs: async () => { order.push('wiki'); return undefined; },
    runImportJobs: async () => { order.push('import'); return { extracted: 2, remaining: 1, failed: 0 }; },
  });
  expect(order).toEqual(['wiki', 'import']);
  expect(report.imports).toEqual({ extracted: 2, remaining: 1, failed: 0 });
});

it('survives an import job that throws, and still reports the rest of the run', async () => {
  const report = await runDocket({ ...deps, runImportJobs: async () => { throw new Error('boom'); } });
  expect(report.reindexed).toBeGreaterThanOrEqual(0);
  expect(report.imports).toBeUndefined();
});

it('behaves exactly as before when no import job is injected', async () => { /* … */ });
```

Run: `npx vitest run tests/import-docket.test.ts`
Expected: FAIL — `runImportJobs` is not a known dep.

- [ ] **Step 2: Implement in `docket.ts`, mirroring section 7**

Add section 8 after the wiki jobs with the same guarded shape and the same style of comment: say *why last* and *why guarded*.

Run: `npx vitest run tests/import-docket.test.ts tests/docket.test.ts`
Expected: PASS both suites.

- [ ] **Step 3: Wire the server and the re-trigger**

In `runDocketNow`, inject `runImportJobs: () => runImportExtraction({ store: importStore, complete: clerkComplete, ... })`. In the `finally`, after `pendingTrigger` replay, add the re-trigger under both conditions. Emit `import-run` with the counts.

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS — the existing end-to-end suite is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/clerk/docket.ts src/types.ts src/server.ts src/log/format.ts tests/import-docket.test.ts
git commit -m "import: extraction runs in the docket, last and guarded (047)"
```

---

### Task 7: Commit — one accepted item becomes one dated sitting [NEW FILE]

**Orient:** This is the only path from an import into the corpus, and it carries the two acceptance criteria that cannot be checked anywhere else: the sitting's date spans the real range, and every snippet is an exact substring of its **source file** rather than of the transcript the importer wrote.
**Flow position:** Step 7 of 13 (review → **commit** → vault). Upstream: `ImportDecision[]` from the route. Downstream: a transcript, snippets and readings in the vault.
**Skill:** `tdd`
**Files:**
- Create: `src/import/commit.ts`
- Create: `tests/import-commit.test.ts`
- Modify: `src/log/format.ts` (`import-committed`, `import-commit-refused`)
- Modify (conditional): `src/harvester/harvester.ts` `decide()` — see Step 4

<contracts>
**Upstream (route → commit):**
```ts
commitImport(deps: { vault: Vault; store: ImportStore; readSource: (p: string) => string; log: LogFn },
             hash: string, decisions: ImportDecision[]): CommitResult
type CommitResult =
  | { ok: true; sessionId: string; snippets: number }
  | { ok: false; reason: 'stale' | 'not-extracted' | 'unverifiable'; detail: string };
```
**Downstream (commit → vault):**
- `startTranscript(sessionId, { mode: { minutes: 0, energy: 'medium' }, protocol: 'import', started: `${record.date}T00:00:00.000Z` })` — **no `target` key at all** (Q-60), and never a placeholder value.
- `appendTurn` for each prepared turn — the prose exactly as the harvester saw it, so a cut's context is recoverable. The transcript is the lineage plane; it is rebuilt, never invented.
- One snippet per kept decision, provenance `{ kind: 'unprompted', session, question: '', questionForm: 'deliberative', channel: 'pasted', context? }`. `'unprompted'` is exact: nothing was asked for these words. `context` follows ticket 073's landed rule for imported pieces — the preceding paragraph when the cut opens a paragraph — computed from the cut's recorded offset in the source body, conditionally spread, display-only lineage that the Clerk must not mint from.
- One reading per kept decision, from the cut's own facet/stance/reading. (The script wrote none, which is why ticket 062 exists; extraction persists the labels, so this path does not repeat that.)
- On success, the record is written back with `status: 'accepted'`, its `sessionId`, and `kept` — the exact texts written as Snippets, approvals as proposed and trims as trimmed. `kept` is what T5's Q-59 dedupe reads on a later import of the same source path.
- Behavioural invariant: **all or nothing.** Any unverifiable decision refuses the whole item and writes nothing. A partial import leaves a sitting whose transcript claims more than its snippets carry.
- Behavioural invariant: **`started` is always `record.date`, with no branch here.** Commit does not know or care whether this is a first or second sitting for its source path — `store.admit` already decided the date (frontmatter `date` for a new path, `lastmod` for a path with an accepted record) and wrote it to the record. One date rule, in one place. A second branch here would be a second rule, and the two would drift.
- Behavioural invariant: **commit never removes a cut the reviewer approved.** Q-59 dedupe runs in T5, before review, so a duplicate is never shown and never approvable. The only thing commit may refuse is the *whole item*, and only on a verification failure — which keeps "all or nothing" and "an edited post offers only what is new" from ever meeting.
- Behavioural invariant: the source is re-read and re-hashed first. A changed file is `stale`: commit writes nothing, and the changed body is a **new item** the next scan admits under its own hash, dated to `lastmod` by `admit`. Never a new version of these snippets (Q-59). Q-5 versioning does not apply — a file edited on disk is a new document sharing a title, and versioning it would date 2027 prose to 2018.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('writes one dated sitting whose started is the frontmatter date', () => {
  const r = commitImport(deps, hash, [{ cut: 0, action: 'approve' }]);
  const fm = matter.read(join(root, 'transcripts', `${r.sessionId}.md`)).data;
  expect(fm.started).toBe('2018-09-01T00:00:00.000Z');
  expect(fm.protocol).toBe('import');
});

it('offers no Target and stores none — Q-60', () => {
  expect(Object.keys(fm.mode)).toEqual(['minutes', 'energy']);
});

it('asserts every snippet against the SOURCE FILE, not the transcript', () => {
  const raw = readFileSync(sourcePath, 'utf-8');
  for (const s of snippetsOnDisk(root)) expect(raw).toContain(s.prose);
});

it('refuses the whole item when one kept text is not in the source', () => {
  const r = commitImport(deps, hash, [{ cut: 0, action: 'trim', text: 'words I never wrote' }]);
  expect(r).toMatchObject({ ok: false, reason: 'unverifiable' });
  expect(existsSync(join(root, 'transcripts'))).toBe(false);   // nothing at all
});

it('refuses a source that changed since extraction, as stale', () => {
  writeFileSync(sourcePath, changedBody);
  expect(commitImport(deps, hash, decisions)).toMatchObject({ ok: false, reason: 'stale' });
});

it('stamps channel pasted on every imported snippet (048)', () => {
  for (const s of snippetsOnDisk(root)) expect(s.provenance.channel).toBe('pasted');
});

it('stamps the preceding paragraph as context on a cut that opens one (073)', () => {
  const s = snippetsOnDisk(root).find((x) => x.prose === CUT_OPENING_A_PARAGRAPH)!;
  expect(s.provenance.context).toBe(PRECEDING_PARAGRAPH);
});

it('leaves context absent rather than empty when the cut opens the piece', () => {
  const s = snippetsOnDisk(root).find((x) => x.prose === FIRST_CUT_IN_PIECE)!;
  expect('context' in s.provenance).toBe(false);   // absent means absent (048's hazard)
});
```

Run: `npx vitest run tests/import-commit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the verification gate first, the writes second**

Order matters: re-read, re-hash, verify every decision (`raw.includes(text)`; `!isQuotedFromSource(text, quotedSpans(raw))`; trims a substring of their cut), and only then open the transcript. A verification that runs after the first write is not a gate.

Then write, and write `kept` last: `startTranscript` → `appendTurn` per prepared turn → snippet and reading per kept decision → `store.put({ ...record, status: 'accepted', sessionId, kept })`. `kept` records the texts as written, so a trim is stored trimmed. T5's dedupe reads this list and nothing else.

Session id: `import-<hash>`, stable and derived, so a crash between transcript and snippets cannot mint a second sitting for the same item on retry.

Run: `npx vitest run tests/import-commit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 3: Q-59's second sitting — verify it end to end, having built it in three places**

Nothing new is implemented here. The mechanism is already spread across three files by design, and this step exists to prove the three agree, because the shape of this failure is disagreement rather than absence:

| Concern | Lives in | Decided by |
|---|---|---|
| A changed body is a new item | `scan.ts` (T3) | a different body hash, so a different record |
| The second sitting's date is `lastmod` | `store.ts` `admit` (T4) | an accepted record already holds this `sourcePath` |
| Cuts already kept are not re-proposed | `extract.ts` (T5) | the accepted record's `kept` list |
| The first sitting is never touched | `commit.ts` (T7) | it only ever opens a new transcript under a new session id |

Commit therefore has **no `lastmod` branch**, and its `started` line stays `record.date` for both sittings. If a reader expects the branch here, that expectation is the bug — one date rule, in `admit`.

Add the end-to-end test, which is the only place all four rows meet:

```ts
it('imports a changed file as a second sitting at lastmod, not as a new version', async () => {
  // First import: date 2024-01-01. Then the body changes, lastmod moves.
  const first = commitImport(deps, hashV1, [{ cut: 0, action: 'approve' }]);
  writeFileSync(sourcePath, changedBody);          // lastmod: 2026-05-17
  store.admit(scanFolder(folder).items);
  await runImportExtraction(deps);
  const second = commitImport(deps, hashV2, [{ cut: 0, action: 'approve' }]);

  expect(sitting(first).started).toBe('2024-01-01T00:00:00.000Z');
  expect(sitting(second).started).toBe('2026-05-17T00:00:00.000Z');
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(snippetVersions(firstSnippetId)).toEqual([1]);        // untouched forever
  expect(store.get(hashV2)!.cuts!.map((c) => c.text))
    .not.toContain(store.get(hashV1)!.kept![0]);               // only what is new
});
```

Run: `npx vitest run tests/import-commit.test.ts -t 'second sitting'`
Expected: PASS, 1 test — two sittings nine years apart on one source path, the first one byte-identical to what it was before the second existed.

- [ ] **Step 4: The `channel` seam — wire it, do not merely declare it**

`decide()` in `src/harvester/harvester.ts` builds the `Provenance` and does not set `channel`. Ticket 048's landed half declared the field; its remaining half wires the three capture paths and is being built in a parallel wave today.

- If 048's `decide()` seam has landed when this task runs, **use it**. Do not add a second parameter for the same fact.
- If it has not, add exactly one optional parameter, `channel?: Provenance['channel']`, conditionally spread into the provenance (`...(channel ? { channel } : {})` — a **present** key holding `undefined` throws in `matter.stringify` and loses the entire snippet write, verified in 048).

Either way the test in Step 1 asserts the value **on disk**. An optional parameter no caller passes tests as done and ships inert; the assertion is what makes this wiring rather than a signature.

- [ ] **Step 5: Commit**

```bash
git add src/import/commit.ts tests/import-commit.test.ts src/log/format.ts src/harvester/harvester.ts
git commit -m "import: one accepted piece, one dated sitting, verified against its source"
```

---

### Task 8: Adopt what the one-off already decided — nineteen keeps and twenty-eight refusals [NEW BEHAVIOUR, EXISTING DATA]

**Orient:** `vault/transcripts/` already holds 19 `post-*` sittings from the 2026-08-02 script run and `scripts/ingest-posts.ts` already holds the reasons 28 other files were refused; without this task the first real scan re-imports all nineteen and asks the reader to re-refuse the other twenty-eight one piece at a time, and "re-running imports nothing twice" fails on the only corpus anyone has.
**Flow position:** Step 8 of 13 (scan → **adoption** → store). Called from the scan route (T9), once per scan, idempotent.
**Skill:** `tdd`
**Files:**
- Create: `src/import/adopt.ts` (`adoptPriorIngest`)
- Modify: `src/import/store.ts` (only if `put` needs a bulk form — otherwise untouched)
- Create: `tests/import-adopt.test.ts`

<contracts>
**Upstream (scan route → adoption):**
```ts
adoptPriorIngest(deps: { store: ImportStore; vaultRoot: string; folder: string; log: LogFn }): {
  accepted: number; excluded: number; unresolved: string[];
};
```
`folder` is the scanned folder path. **It is known only at request time**, which is why adoption cannot run at store construction and must be called from the route — see T9 Step 2. A function like this that is never called is the defect this plan has already guarded against twice; the test in Step 4 is what makes it wiring rather than a signature.

**Downstream:** `ImportRecord`s that make `admit` skip. Two kinds:
- `status: 'accepted'` with `sessionId`, one per existing `protocol: import` transcript, hashed from its source file's body.
- `status: 'excluded'` with `excludeReason` carried verbatim from the script's `EXCLUDED` table, one per file those entries resolve to.
- Behavioural invariant: adoption **writes no corpus**. It only mints staging records describing corpus that already exists, or refusals that were already made.
- Behavioural invariant: keyed by hash, never by slug. A slug key would let the same prose in a renamed file import twice, which is what Q-59 rules against.
- Behavioural invariant: idempotent — the second call adds nothing.
- Behavioural invariant: **an unresolvable name is reported, never skipped in silence.** The arithmetic in Step 3 is the check: on the real corpus, `accepted + excluded` must equal the file count, or something was lost.
</contracts>

- [ ] **Step 1: Adopt the nineteen accepted sittings**

For each transcript with `protocol: import`, derive the slug from the session id (`post-<slug>`, `-` restored to `/` where a directory exists), find the source file, hash its body, write an `accepted` record with `sessionId`. A source file that no longer exists goes to `unresolved` — logged, never guessed at.

**A slug resolves to two possible file layouts and both must be tried:** `<slug>/index.md` (the Hugo shape the real corpus uses) and `<slug>.md` (a flat folder, which is what `tests/fixtures/import-folder` is and what most people's folders will be). Resolving only the first makes every test in this task depend on the env-gated corpus.

**Which folder each test runs against, stated once for the whole task.** The mechanism is provable on the fixture; the *numbers* — 19, 28, 47 — exist only in the real corpus. So the mechanism tests use `FIXTURE` and always run; the count tests use `ELICIT_IMPORT_CORPUS` and skip with a printed reason when it is unset (Step 3). Nothing in this task asserts a corpus number against the fixture.

```ts
it('adopts an already-imported post so a re-scan skips it', () => {
  seedTranscript(root, 'post-dated-essay', '2018-09-01T00:00:00.000Z');
  adoptPriorIngest({ store, vaultRoot: root, folder: FIXTURE, log });
  expect(store.admit(scanFolder(FIXTURE).items).added).not.toContain(datedEssayHash);
});

it('is idempotent', () => {
  adopt(); const after = store.list('accepted').length;
  adopt(); expect(store.list('accepted')).toHaveLength(after);
});
```

- [ ] **Step 2: Adopt the twenty-eight refusals, and resolve their names carefully**

The script's `EXCLUDED` table is **12 entries** (`scripts/ingest-posts.ts:250-261`) carrying the reason each item stayed out — Q-51 rulings on five co-authored items, a fiction with an invented narrator, catalogue cards whose prose lives on someone else's site, two deferrals. Those reasons are worth more than they cost to keep: without them the reader is asked to re-make twelve judgements they already made, one piece at a time, with the reasoning left behind in a script.

Export `EXCLUDED` from `scripts/ingest-posts.ts` and resolve each `slug` against the folder. **Three of the entries do not name directories, and a naive match loses them silently:**

| Entry form | Example | Resolution |
|---|---|---|
| exact slug | `pune-covid-relief` | one directory |
| glob | `external/*`, `blog/Leaflet/*` | every directory under the prefix **minus any slug in `MANIFEST`** — `external/wikipedia-editathon-dalit-history-month` was kept and must not be excluded |
| slash-separated list in one field | `my-art / graphics-work / … / portfolio-workshops` | split on ` / `, then resolve each; `south-asian-digital-history` resolves to `external/south-asian-digital-history` and `portfolio-workshops` to `portfolio-workshops-classes-panels-and-publications`, so resolution must accept a unique prefix or suffix match and **fail loudly on an ambiguous or empty one** |

The first two tests below assert corpus numbers, so they live behind the same env gate as Step 3. The third asserts the reporting behaviour and runs on a fixture always — it is the one that matters most, because a resolver that loses a name silently is the failure this whole step exists to prevent.

```ts
describe.skipIf(!process.env.ELICIT_IMPORT_CORPUS)('real corpus', () => {
  it('adopts the excluded groups with their reasons', () => {
    const r = adoptPriorIngest({ store, vaultRoot: root, folder: CORPUS, log });
    expect(r.excluded).toBe(28);
    expect(store.get(imposterHash)!.excludeReason).toContain('Q-51');
  });

  it('does not exclude the one external that was kept', () => {
    expect(store.get(wikipediaEditathonHash)!.status).toBe('accepted');
  });
});

it('reports a name it cannot resolve instead of dropping it', () => {
  // A two-file fixture folder plus a one-entry EXCLUDED naming a third.
  const r = adoptPriorIngest({ ...deps, folder: FOLDER_MISSING_ONE });
  expect(r.unresolved).toEqual(['jingle-tales']);
});
```

Run: `npx vitest run tests/import-adopt.test.ts`
Expected: PASS, 3 tests, 2 skipped (`real corpus`) — and 5 passed when `ELICIT_IMPORT_CORPUS` is set.

- [ ] **Step 3: Verify the arithmetic against the real corpus, read-only**

The corpus holds 47 files. Measured 2026-08-02: `MANIFEST` covers 19, and the 12 `EXCLUDED` entries resolve to the other 28 — 8 named singly, 10 more from `external/*` (12 externals, minus the one kept, minus `tweaking-the-education-system` already counted singly), 3 from `blog/Leaflet/*`, `poems`, and 6 from the slash-separated index-page entry. **19 + 28 = 47, exactly**, which is what makes this checkable: any resolution failure shows up as a short count rather than as a file quietly re-offered for review months later.

Run: `ELICIT_IMPORT_CORPUS=/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts npx vitest run tests/import-adopt.test.ts -t 'real corpus'`
Expected: `19 accepted, 28 excluded, 0 unresolved` and `19 + 28 === 47`. The test skips with a printed reason when the env var is unset — that path exists on one machine.

- [ ] **Step 4: Prove it is called, not merely defined**

The assertion that matters is in T9's suite, because that is where the wiring is. Cross-check it here so a later refactor that drops the call turns this suite red too:

```ts
it('the scan route adopts before it admits', async () => {
  // One seeded sitting, asserted against the fixture folder — the counts that
  // hold only on the 47-post corpus belong in Step 3, not here.
  seedTranscript(root, 'post-dated-essay', '2018-09-01T00:00:00.000Z');
  const r = await post('/api/import/scan', { folder: FIXTURE });  // no adopt() call in the test
  expect(r.adopted).toBeGreaterThan(0);
  expect(pendingPaths(store)).not.toContain(join(FIXTURE, 'dated-essay.md'));
});
```

Run: `npx vitest run tests/import-adopt.test.ts tests/import-routes.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/import/adopt.ts src/import/store.ts scripts/ingest-posts.ts tests/import-adopt.test.ts
git commit -m "import: adopt the one-off's nineteen keeps and twenty-eight refusals"
```

---

## Wave 3 — the surface

### Task 9: Routes — four, and none of them writes without a decision [MODIFY]

**Orient:** The surface needs exactly four things from the server — scan a folder, hand me the next piece to read, take my decisions on it, and take my reason for refusing it whole — and no fifth route may exist that writes without a review behind it.
**Flow position:** Step 9 of 13 (store/commit → **routes** → surface). Upstream: the import modules. Downstream: `web/import-review.ts`.
**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` (four routes, near `/api/unprompted` at `:789-820`)
- Create: `tests/import-routes.test.ts`

<contracts>
**Downstream (routes → surface):**

| Route | Body | Answer |
|---|---|---|
| `POST /api/import/scan` | `{ folder: string }` | `{ pending, refused: [{ file, reason }], skipped, adopted }` — **adopt, then admit**, then `startDocket('import')` |
| `GET /api/import/next` | — | `{ item: { hash, file, title, date, source, cuts, marks }, remaining }` or `{ item: null, waiting }` |
| `POST /api/import/:hash/decisions` | `{ decisions }` | `{ sessionId, snippets }` or a 409 with the refusal reason |
| `POST /api/import/:hash/exclude` | `{ reason }` | `{ ok: true }`; 400 when `reason` is empty |

- `source` is the **whole source body**, re-read from disk at request time and hash-checked. The surface renders the piece whole; it cannot do that from the prepared prose, because what preparation removed is exactly what the reader must see to judge excision.
- `marks` names the regions preparation dropped: `[{ at, length, why: 'quoted' | 'cited' | 'not-prose' }]`. The reader sees *why* a paragraph carries no cuts.
- Behavioural invariant: all four sit behind the same auth as every other route (Q-25). The folder path is read from the request and off local disk by design — that is the door Q-57 chose — so the lock on the app is the control, and there is no traversal check to write.
- Behavioural invariant: `GET /api/import/next` returns items oldest-first and is **read-only**. Opening the review writes nothing.
- Behavioural invariant: **the scan route calls `adoptPriorIngest` before `admit`, in that order, every time.** T8's adoption needs the folder path, and the folder path exists nowhere before this request — not at boot, not at store construction. Adoption is idempotent, so calling it on every scan costs a directory read and buys the guarantee that it cannot be skipped.
</contracts>

- [ ] **Step 1: Write the failing tests** (Hono app under test, as `tests/wiki-routes.test.ts` does)

```ts
it('scan answers with refusals by reason and writes no corpus', async () => {
  const r = await post('/api/import/scan', { folder: FIXTURE });
  expect(r.refused).toContainEqual({ file: 'undated.md', reason: 'no-date' });
  expect(existsSync(join(root, 'transcripts'))).toBe(false);
});

it('adopts prior ingest before admitting, so an already-imported post never queues', async () => {
  seedTranscript(root, 'post-dated-essay', '2018-09-01T00:00:00.000Z');
  const r = await post('/api/import/scan', { folder: FIXTURE });
  expect(r.adopted).toBeGreaterThan(0);
  expect(pendingPaths(store)).not.toContain(join(FIXTURE, 'dated-essay.md'));
});

it('next hands back the whole source, not the prepared prose', async () => {
  const { item } = await get('/api/import/next');
  expect(item.source).toContain(CITED_PARAGRAPH);       // dropped from extraction, present to read
  expect(item.marks.some((m) => m.why === 'cited')).toBe(true);
});

it('exclude requires a reason', async () => {
  expect((await postRaw(`/api/import/${hash}/exclude`, { reason: '' })).status).toBe(400);
});

it('decisions on a changed file answer 409 stale and write nothing', async () => { /* … */ });

it('there is no batch route', () => {
  expect(routePaths(app)).not.toContain('/api/import/accept-all');
});
```

- [ ] **Step 2: Implement the scan route in its required order**

```ts
app.post('/api/import/scan', async (c) => {
  const { folder } = await c.req.json<{ folder: string }>();
  // Adoption FIRST, and with this folder: the nineteen sittings the one-off
  // wrote and the twenty-eight files it refused are only recognisable once
  // their source paths are known, and the path arrives here or nowhere (T8).
  const adopted = adoptPriorIngest({ store: importStore, vaultRoot: deps.vaultRoot, folder, log });
  const scanned = scanFolder(folder);
  const { added, skipped, refused } = importStore.admit(scanned.items);
  startDocket('import');
  return c.json({
    pending: added.length,
    skipped: skipped.length,
    adopted: adopted.accepted + adopted.excluded,
    refused: [...scanned.refused, ...refused].map((r) => ({ file: basename(r.sourcePath), reason: r.reason })),
  });
});
```

Note the two refusal sources merging: `scanFolder` refuses on the file alone (no frontmatter, no date, unparsable date, empty body), and `admit` refuses on what the store knows (a second sitting with no `lastmod` — T4). The surface shows one list, because to the reader they are one thing: a file that did not come in, and why.

Run: `npx vitest run tests/import-routes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts tests/import-routes.test.ts
git commit -m "import: four routes, adoption before admission, no batch accept"
```

---

### Task 10: The review surface — your own essay, with the cuts marked where they sit [NEW FILE]

**Orient:** The only failure this review can catch is misleading excision — a sentence exactly yours that means something else lifted out — and judging that needs the words on either side, so the piece renders whole, in order, with the proposed cuts marked in place.
**Flow position:** Step 10 of 13 (routes → **surface** → routes). Upstream: `GET /api/import/next`. Downstream: `POST /api/import/:hash/decisions`.
**Skill:** `interface-design:interface-design`
**Files:**
- Create: `web/import-review.ts`
- Modify: `web/style.css` (the marked-cut and margin-verb styles)

<contracts>
**Upstream (main.ts → import-review):**
```ts
renderImportReview(deps: {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string,string>, ...kids: (string|Node)[]) => HTMLElementTagNameMap[K];
  api: <T>(path: string, body?: unknown) => Promise<T>;
  beginWait: (slot: HTMLElement, msg: string) => Wait;
  navTo: (screen: string) => void;
}): void
```
Injection rather than import, for two reasons: `el`, `api` and `beginWait` are module-private in `main.ts`, and `web/main.ts` is being edited concurrently by the ticket-073 agent — a shared-helper refactor there would collide. The seam costs one object literal at the call site.

**Downstream (surface → routes):** `ImportDecision[]`, one per proposed cut, all present before the piece can be accepted.
</contracts>

- [ ] **Step 1: Build the render**

The document rule (`docs/interface-references.md`): every surface is a page of text, controls only at the point of attention. Concretely:

- The piece renders as continuous prose from `item.source` — its own paragraphs, its own order, nothing reflowed.
- A proposed cut is **underlined in place** (`.import-cut`), not lifted into a card. Its facet/stance/reading sit as dimmed marginalia, revealed on focus.
- A dropped region carries one dimmed margin word — `quoted`, `cited` — so silence has a stated reason.
- Focusing a cut dims the page around it and reveals three margin words: **approve · trim · discard**. There is no fourth. `restate` does not exist here: you cannot restate a 2018 essay without producing prose from today wearing an eight-year-old date.
- Trim edits the marked span in place, and the confirm is refused unless the result is a substring of the cut (the same guard `renderProposal` uses at `web/main.ts:1129-1137`).
- **No Target control** anywhere on this surface (Q-60). Nothing to leave blank, nothing to get wrong.
- One item fills the screen. There is no list, no checkbox and no accept-all: a control that skips reading converts the gate into theatre.
- At the foot: `save this piece`, enabled only when every cut has a decision.

**The header region** — above the prose, before any cut is in view — carries two things and only two:

- The date, as a sentence: *"written 2018-09-01; it will be saved as a sitting on that date."* The date is the highest-value property of the material and the easiest to throw away in silence, so it is stated before anything else is decided.
- The piece-level refusal: *"this one is not mine alone"* → a one-line reason field → `POST /exclude`.

Ticket 058 §3 requires the surface to have somewhere to record "this one is joint" and have that mean something, and Q-51 makes co-authorship an **item-level** exclusion — the whole thing stays out, rather than being sampled carefully. So the control exists; the only question Q-60 leaves open is where it sits, and the answer is: in the header, at the level of the object it acts on, never as a fourth word beside approve · trim · discard. Two reasons it belongs at the top rather than the foot. Authorship is the first judgement a reader makes about a piece and the cheapest to act on before reading 60 cuts; and a refusal control at the foot sits exactly where a tired reader looks for the way out, which is the one place a whole-item refusal must not be.

- [ ] **Step 2: Prove the structural claims**

`tests/import-review.test.ts` with the DOM built by the same helpers (no browser needed for these):

```ts
it('renders the piece whole — every source paragraph is on the page', () => {
  const text = surface.textContent!;
  for (const para of sourceParagraphs) expect(text).toContain(para);
});

it('offers three verbs and never restate', () => {
  expect(verbLabels(surface)).toEqual(['approve', 'trim', 'discard']);
});

it('puts the piece-level refusal in the header, not among the cut verbs', () => {
  expect(surface.querySelector('.import-header .import-exclude')).not.toBeNull();
  expect(surface.querySelector('.import-cut .import-exclude')).toBeNull();
});

it('sends the reason with the exclusion and refuses an empty one', async () => {
  clickExclude(surface); await confirmExclude(surface, '');
  expect(sent).toHaveLength(0);
  await confirmExclude(surface, 'co-taught with Paul; no cut of it is mine alone');
  expect(sent[0]).toMatchObject({ path: `/api/import/${hash}/exclude` });
});
```

Run: `npx vitest run tests/import-review.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add web/import-review.ts web/style.css tests/import-review.test.ts
git commit -m "import review: the piece whole, cuts marked in place, three verbs"
```

---

### Task 11: The way in, and the way back in [MODIFY — SMALL, CONTENDED FILE]

**Orient:** An import runs across weeks and the browser may close at any point, so the entry point must say what waits and put the reader back at the next unread piece — and this task touches `web/main.ts`, which another agent is editing today, so it stays surgical.
**Flow position:** Step 11 of 13 (mode screen → **entry** → review). Downstream: `renderImportReview`.
**Skill:** `interface-design:interface-design`
**Files:**
- Modify: `web/main.ts` — `Screen` union (`:98`), `navTo` (`:133-146`), and one line on the mode screen
- Create: `web/import-entry.ts` (the folder prompt and the manifest page)

<contracts>
**Upstream (mode screen → entry):** a click on one dimmed margin word.
**Downstream (entry → review):** `navTo('import')` once a piece is extracted.
- Behavioural invariant: the three edits to `web/main.ts` are additive — one union member, one `case`, one nav word. No existing function is re-shaped. Expect the ticket-073 agent's context-rendering changes to be landed in `renderProposal`; do not touch that function.
- Behavioural invariant: the entry surface is sentences, not a dashboard. *"Nineteen pieces are ready to read. Two files had no date and were not imported: undated.md, notes.md."* The refusals are named with their reasons, because a refusal the reader never sees is a silent loss.
</contracts>

- [ ] **Step 1: Add the folder prompt**

One line of text, typed, in the same idiom as the mode sentence: *"the folder:"* and a path field. No file picker (the app never opens a socket and a picker adds nothing a path does not).

- [ ] **Step 2: The manifest page, in sentences**

After scan: counts as prose, refusals named with reasons, and one line about what happens next — *"reading them takes a while; you can close this and come back."*

- [ ] **Step 3: Resume**

On entry, if any record is `extracted`, go straight to the next one. If all are `pending`, say how many are still being read and offer nothing to click.

- [ ] **Step 4: Verify by use**

Run: `npm run build && ELICIT_LLM=fake npx tsx src/server.ts` then open the app, scan `tests/fixtures/import-folder`.
Expected: the manifest names `undated.md — no date in its frontmatter` and `frontmatter-only.md — nothing but frontmatter`; three pieces queue; `vault/transcripts/` is still absent until a piece is saved.

- [ ] **Step 5: Commit**

```bash
git add web/main.ts web/import-entry.ts
git commit -m "import: the way in, and the way back in"
```

---

## Wave 4 — acceptance, and the door that stays shut

### Task 12: The five criteria, as tests [NEW FILE]

**Orient:** The ticket's acceptance list is five sentences, and every one of them becomes an executable assertion here rather than a claim in a commit message — including the fifth, which is a design property and therefore becomes the four structural claims the document rule reduces to; a plan that ends without them ends on "looks right".
**Flow position:** Step 12 of 13 — reads the whole flow end to end.
**Skill:** `tdd`
**Files:**
- Create: `tests/import-acceptance.test.ts`

<contracts>
- Runs against `tests/fixtures/import-folder` always, with a scripted `Complete`.
- Runs additionally against `process.env.ELICIT_IMPORT_CORPUS` when set, and **skips with a printed reason** when it is not. The 47-post corpus lives outside the repo on one machine; a hardcoded absolute path would be a test that fails everywhere else.
</contracts>

- [ ] **Step 1: One test per criterion**

```ts
it('an archive imports as dated sittings whose started values span the real range', () => {
  const started = sittings(root).map((s) => s.started).sort();
  expect(started[0]).toBe('2018-09-01T00:00:00.000Z');
  expect(started.at(-1)).toBe('2022-01-01T00:00:00.000Z');
  expect(new Set(started).size).toBe(started.length);   // no two pieces share a date by accident
});

it('every snippet is an exact substring of its SOURCE file', () => {
  for (const s of snippetsOnDisk(root)) {
    const raw = readFileSync(sourceOf(s.provenance.session), 'utf-8');
    expect(raw).toContain(s.prose);
  }
});

it('nothing is written before a review is accepted', async () => {
  await scan(); await extractAll();
  expect(existsSync(join(root, 'transcripts'))).toBe(false);
  expect(existsSync(join(root, 'snippets'))).toBe(false);
});

it('re-running imports nothing twice', async () => {
  const first = await scanAndCommitAll();
  const second = await scan();
  expect(second.pending).toBe(0);
  expect(sittings(root)).toHaveLength(first.sittings);
});

// The fifth criterion — "obeys the document rule, or the ticket records why it
// cannot and what replaced it" — is a design property, so it is asserted as the
// four structural claims the rule reduces to on THIS surface. Each is a thing
// the rule forbids or requires, and each is visible in the rendered DOM.
describe('the review surface obeys the document rule', () => {
  it('is a page of text: the whole piece is present, unreflowed and in order', () => {
    const rendered = paragraphsOf(surface);
    expect(rendered).toEqual(paragraphsOf(sourceBody));   // same content, same order
  });

  it('has no list furniture — no table, no checkbox, no per-row button set', () => {
    for (const sel of ['input[type=checkbox]', 'table', 'ul.proposal-list', '.proposal-block']) {
      expect(surface.querySelector(sel)).toBeNull();
    }
  });

  it('carries controls only at the point of attention: none visible until a cut has focus', () => {
    expect(visibleVerbs(surface)).toEqual([]);
    focusCut(surface, 0);
    expect(visibleVerbs(surface)).toEqual(['approve', 'trim', 'discard']);
  });

  it('offers nothing that accepts without reading, and no Target', () => {
    expect(surface.textContent).not.toMatch(/accept all|approve all|select all/i);
    expect(surface.querySelector('[name=target], .target-control')).toBeNull();
  });
});
```

If any of the four cannot be written as stated — for instance because focus-dependent visibility needs a real browser rather than the DOM shim — **do not delete it and do not leave it as a comment.** Record in this plan's Shape Changes what replaced it and why, which is the escape hatch the ticket's own wording ("or the ticket records why it cannot and what replaced it") already provides.

Run: `npx vitest run tests/import-acceptance.test.ts`
Expected: PASS, 8 tests (four criteria plus the four document-rule claims).

- [ ] **Step 2: The model-in-the-loop run, by hand**

Automated tests use a scripted model; extraction against a real model is ~40s per chunk and belongs to a person, once.

Run: `ELICIT_LLM=local npm start`, scan `/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts`, watch the Activity Log.

Expected: **`read 47 files: 0 to import, 0 refused, 47 already known`** — nothing queues, and that is the correct and slightly startling result. T8 adopts 19 as `accepted` (the sittings the one-off wrote) and 28 as `excluded` (the refusals it recorded), and 19 + 28 = 47. The one real corpus is fully decided, so the surface's first honest act is to say so rather than to re-ask.

Two things to write down rather than infer, because both are absences that look like successes:

- **`0 refused` is not evidence the refusal path works.** Every file in this corpus has a frontmatter `date` (measured 2026-08-02: 47 of 47). The path is proven on `undated.md` in the fixture and nowhere else.
- **A live end-to-end run needs a folder this corpus cannot provide.** To exercise scan → extract → review → commit against the real model, point the importer at a folder of writing that has never been ingested. If none exists yet, copy two or three posts to a scratch folder and edit their bodies — which also exercises Q-59's second sitting, since the source paths differ but the prose does not.

- [ ] **Step 3: Commit**

```bash
git add tests/import-acceptance.test.ts
git commit -m "import: the five acceptance criteria, as tests"
```

---

### Task 13: Leaflet and Pixelfed — a named stub, and the reason it is only that [NEW FILE]

**Orient:** Q-57 rules that Leaflet and Pixelfed become export *scripts* that write a folder and never importers, and the risk is that the ruling erodes quietly into "just this one fetcher" — so the stub exists to name the shape and record the reason where the next person will look.
**Flow position:** Step 13 of 13 — outside the flow by design. It writes a folder; the importer reads folders.
**Skill:** `none`
**Files:**
- Create: `scripts/export-leaflet.ts` (stub, does not run)

<contracts>
- The stub declares one function, `exportToFolder(out: string): Promise<void>`, and throws `not built — see Q-57`.
- The file's header comment carries the reason, not a TODO: a feed hands over rendered HTML, and the three quotations that nearly entered the 2017-2026 corpus were catchable only because the markdown source preserved inline citation structure — one of them had neither quote marks nor its own citation and survived scrutiny only because the adjacent paragraph was still a paragraph. Rendered output flattens the structure the catch depends on, so a fetcher would import someone else's sentence as the user's and be structurally incapable of noticing.
- It also records what the script owes: each source's authorship question is answered by the human who writes that script (Q-51), which is why there is no generic exporter.
</contracts>

- [ ] **Step 1: Write the stub, then commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add scripts/export-leaflet.ts
git commit -m "import: name the export-script door, and why it is not a fetcher (Q-57)"
```

---

## Execution Waves

| Wave | Tasks | Runs in parallel? | Gate before the next wave |
|---|---|---|---|
| **0** | T1 | — | `npx tsc --noEmit` clean; the contract file exists and asserts no-restate / no-Target |
| **1** | T2, T3, T4 | T3 and T4 after T2 (both import from `body.ts`); T3 ∥ T4 | Full suite green; the script still typechecks |
| **2** | T5, T6, T7, T8 | T5 → T6; T7 ∥ T5; T8 after T4 | Extraction writes no corpus; commit refuses on any unverifiable cut |
| **3** | T9, T10, T11 | **T8's Step 4 closes here**, then T9 → T10 → T11 | The fixture folder scans, queues, reviews and saves through the real UI |
| **4** | T12, T13 | ∥ | The acceptance tests pass; the manual model run is recorded |

**One step deliberately spans a wave boundary.** T8 writes `adoptPriorIngest` in Wave 2, but the only caller is T9's scan route in Wave 3 — the folder path does not exist before that request. So T8 Step 4 (the assertion that adoption is actually *called*) closes with T9, not with T8, and Wave 3's gate covers it. This is the one place in the plan where a mechanism sits finished and unwired across a wave, and it is called out here because that is precisely the state in which a mechanism gets forgotten.

Waves 2 and 3 carry the contention risk: **T6 and T9 touch `src/server.ts`, which ticket 043 has held before, and T11 touches `web/main.ts`, which the ticket-073 agent is editing today.** Sequence T11 last within its wave and rebase before starting it.

## Open Questions

Tiered: **[BLOCKING]** must be answered before the task runs; **[EXPLORATORY]** can be answered while implementing.

### Assumptions this plan makes (all of them, stated)

- **A1 — ~~assumption~~ VERIFIED 2026-08-02: ticket 073 has landed.** `Provenance.context` and `CutProposal.context` are declared (`src/types.ts:129`, `:162`) and `decide()` stamps context by conditional spread (`src/harvester/harvester.ts:609`, `:686`). Ticket 080 carries its named remainder (the wiki surface and the randomizer draw), which this plan does not touch. Two consequences, both now concrete rather than conditional:
  - T10 and T11 build against a `renderProposal` that already renders context with the cut's boundary marked inside it. **Do not touch that function**; the import review is a separate renderer, and the whole-piece rendering subsumes what it does.
  - **T7 must stamp `Provenance.context` on imported snippets.** 073's rule for imported pieces is "the preceding paragraph when the cut opens a paragraph", the field and its conditional-spread idiom already exist, and T5 already records each cut's offset in the source body — which is exactly what computing the preceding paragraph needs. This is now a required step in T7, not a maybe. Reuse 073's rule; do not invent a second one.
- **A2 — ~~assumption~~ VERIFIED 2026-08-02: 048's `decide()` channel seam has NOT landed.** `grep -n channel src/harvester/harvester.ts` returns nothing. So T7 Step 4 takes its second branch: this plan adds the one optional parameter itself, with conditional spread, and 048 adopts it. Re-check before starting T7 — a parallel wave may have landed it in between, and adding a second parameter for the same fact is the failure to avoid.
- **A3 — `src/log/format.ts` and `tests/log-format.test.ts` are mid-edit** (ticket 071 work is in the tree). Every task adding a formatter rebases first.
- **A4 — Q-61's git-commit-per-docket-run is decided but not built.** `vault/.git` exists and was initialised by hand; no code in `src/` commits it. `vault/imports/` is therefore tracked-by-default, which is what T4 Step 3 wants anyway.
- **A5 — The 19 existing sittings are correct and stay.** This plan adds records that describe them; it never rewrites them.
- **A6 — The importer reads `.md` and `.markdown` only.** A folder of `.txt` is named in Q-57 as a source the folder door serves; plain text has no frontmatter and would therefore refuse every file. Reading `.txt` is not in scope, and the refusal reason `no-frontmatter` says so honestly rather than silently ignoring them.
- **A7 — The seeds DAG is not materialised.** TASK-FORMAT asks for `sd create` per task where `.seeds/` exists. It exists. The DAG was not created because this session's brief was to write one file and nothing else. Materialise it before dispatch.

### Wave 0

- **Task 1**
  - ~~**[BLOCKING]** Is item-level `exclude` a violation of Q-58's "three verbs"?~~ **RESOLVED 2026-08-02, from ticket 058's own spec.** §3 of the ticket *mandates* the control — "Q-51 has to be enforceable HERE… The surface needs somewhere to record 'this one is joint' and have that mean something" — so its existence was never open. Q-58's three verbs and Q-60's caution both govern **placement**: no fourth control beside approve · trim · discard, because a control competing for attention at the point of a cut is the failure they name. Exclusion therefore sits at **piece level, in the header region** (T10 Step 1), acts on the whole item, and requires a written reason. Wave 0 is unblocked.
  - **[EXPLORATORY]** Should `ImportRecord.cuts` live in frontmatter or in a sibling `.json`? Frontmatter is chosen for Q-3 consistency; long prose in YAML is ugly but round-trips. Revisit only if gray-matter mangles a real cut.

### Wave 1

- **Task 2**
  - **[EXPLORATORY]** Does `clean()` ever join two lines that were not adjacent in the source, breaking the substring guarantee? *(Assumed yes, rarely — it filters lines inside a paragraph block.)* T5 drops such cuts before review and T7 refuses them at commit, so the answer changes nothing structurally. Worth measuring on the real corpus during T12: if the count is zero, say so; if it is not, the number belongs in the results note.
- **Task 3**
  - **[BLOCKING]** Does identity hash the body or the whole file? *(Assumed body.)* Measured basis: 6 of 47 files share `lastmod: 2026-02-22` from one site-wide touch; hashing frontmatter turns that touch into six new documents. Contrary reading: Q-59 says "content hash" unqualified, and a title change is arguably a new document.
  - **[BLOCKING]** Is the first-import date `date` or `lastmod`? *(Assumed `date`; `lastmod` is reserved for Q-59's second sitting, and the branch lives in `store.admit` — T4.)* Measured: 11 of 47 differ; 6 of those share the bulk-touch day. But **Micah's own hand-calls used the body's last-written date for two posts** — `kishori-film-festival` (frontmatter `date` 2021-02-01, dated 2026-02-22 with the note "the project is 2021, the prose is not") and `blog/mapping-history-of-cinema` (2024-01-01 → 2026-05-17). So this rule contradicts 2 of his 19 decisions. It is still the right default, because the failure it prevents is silent and collective (six sittings collapsing onto one date narrows Q-50's independence span invisibly) while the failure it causes is visible and per-item (one essay dated to its project rather than its prose). If it is wrong, the correction is a per-item date control at review — which Q-57 forbids ("never asked per item"), so the real correction is a note in the folder-assembly step.
- **Task 4**
  - **[EXPLORATORY]** A second sitting whose source has no `lastmod` is refused rather than dated from `date`. Nothing in the real corpus exercises this (47 of 47 carry `lastmod`), so it is proven on a fixture. The alternative — reusing the first sitting's date — was rejected because two sittings sharing a date are not independent under Q-50, which would silently defeat the whole reason Q-59 makes a changed file a new item.

### Wave 2

- **Task 5**
  - **[EXPLORATORY]** Is a per-run budget of 5 right? Unmeasured. At ~40s per chunk and several chunks per piece, 5 items is roughly 10–20 minutes of GPU per docket run. Ships live (Q-56) and emits `threshold-clipped`, so re-tuning after one real run is one line with evidence behind it.
  - ~~**[EXPLORATORY]** Should extraction dedupe cuts across items from the same source path?~~ **RESOLVED — yes, and only there.** Dedupe at commit would let a reviewer approve a cut that then vanishes, which contradicts T7's all-or-nothing rule; dedupe before review means the duplicate is never shown and never approvable. The cost is that the reviewer does not see what the model re-proposed, which is acceptable — they already read that sentence in the first sitting, and the Activity Log records the count.
- **Task 6**
  - **[BLOCKING]** Does `startDocket` re-trigger from inside `runDocketNow`'s `finally` without racing `pendingTrigger`? *(Assumed yes — the existing replay does exactly this at `src/server.ts:409-411`.)* Verify by reading that block before writing the re-trigger; do not add a second mechanism beside it.
- **Task 7**
  - **[BLOCKING]** Has 048 landed the `decide()` channel seam? Check `src/harvester/harvester.ts` before Step 4. Adding a second parameter for the same fact is the failure to avoid.
  - **[EXPLORATORY]** Should commit write Readings, given the script wrote none? *(Assumed yes.)* Extraction persists facet/stance/reading per cut, so they are recoverable here where they were not for the script — and Q-28 mints a Claim from every reading on the next docket run, which is what ticket 062 exists to backfill for the 19. Confirm that importing 28 pieces with readings does not flood the first docket run past its quotas.
- **Task 8**
  - **[EXPLORATORY]** Do all 19 session ids map back to a source path unambiguously? The script's rule was `post-` + slug with `/` → `-`, and `blog/koramangala` → `post-blog-koramangala` is reversible only by trying each candidate split against the filesystem. Unresolvable ones are logged, never guessed. The 19 + 28 = 47 arithmetic in Step 3 is what catches a failure here.
  - **[BLOCKING]** Does exporting `EXCLUDED` from `scripts/ingest-posts.ts` drag the script's module side effects into `src/`? The script runs top-level code on import (it reads `process.argv` and can call `process.exit`). **Check before importing it.** If it does, the fix is to move `MANIFEST` and `EXCLUDED` into a data-only module the script and adoption both import — which is the better shape anyway, since they are a record rather than behaviour.
  - **[EXPLORATORY]** Two `EXCLUDED` entries are deferrals rather than refusals — `blog/Leaflet/*` ("Micah is fetching the originals later — this is a deferral, not a rejection") and `poems` ("Deferred with the Leaflet originals"). Adopting them as `excluded` means a later scan skips them silently. *(Assumed acceptable: the reason string says "deferral" in the record, and the originals will arrive as different files with different hashes.)* If it is wrong, they want a distinct `deferred` status, which the contract does not have.

### Wave 3

- **Task 9**
  - **[EXPLORATORY]** Should `GET /api/import/next` re-read the source on every poll? *(Assumed yes.)* It is one file read and it is what makes the stale check honest.
- **Task 10**
  - **[BLOCKING]** Can `renderImportReview` take injected helpers without a circular import? *(Assumed yes — injection is chosen precisely to avoid `main.ts` ↔ `import-review.ts` cycles.)* If `beginWait`'s `Wait` type must be exported from `main.ts` to type the parameter, move the type to a shared `web/types.ts` rather than exporting from `main.ts`.
  - **[EXPLORATORY]** How is a cut marked when it spans a paragraph break? Cuts come from `propose()` against one turn, and a turn may hold several paragraphs, so this is reachable. Assumed: mark each paragraph's portion, one control cluster for the cut.
- **Task 11**
  - **[BLOCKING]** What is `web/main.ts`'s state after ticket 073? Rebase and read `renderProposal` before editing. Three additive lines only.

### Wave 4

- **Task 12**
  - **[EXPLORATORY]** The fixture folder's date span (2018→2022) is small. Is a three-sitting span enough to prove "spans the real range"? The real proof is the manual run in Step 2; the fixture proves the mechanism.
- **Task 13**
  - (none — fully specified)

## Per-Wave Verification

| Wave | Command | Expected |
|---|---|---|
| 0 | `npx tsc --noEmit && npx vitest run tests/import-contract.test.ts` | clean; 2 passed |
| 1 | `npx vitest run tests/import-body.test.ts tests/import-scan.test.ts tests/import-store.test.ts && npx tsc --noEmit` | 14 passed (2 + 5 + 7); clean |
| 2 | `npx vitest run tests/import-extract.test.ts tests/import-docket.test.ts tests/import-commit.test.ts tests/import-adopt.test.ts tests/docket.test.ts tests/e2e.test.ts` | all passed, existing suites unchanged. T8's Step 4 cross-check is the one test expected to be absent until Wave 3 |
| 3 | `npx vitest run tests/import-routes.test.ts tests/import-review.test.ts tests/import-adopt.test.ts && npm run build` | 10 passed plus the adoption suite now complete, Step 4 included; build clean |
| 4 | `npx vitest run` (full suite) | all green. The only skips are the `ELICIT_IMPORT_CORPUS`-gated blocks in `import-adopt` and `import-acceptance`; every mechanism is proven on the fixture and only the corpus *numbers* are gated |

**Standing gate for every wave:** `npx vitest run tests/log-format.test.ts` — a new Activity Log kind without a sentence turns it red, and that is the intent (Q-23).

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/import/contract.ts` | create | `export type ImportStatus` |
| `src/import/body.ts` | create | `export function dropCitedParagraphs` |
| `src/import/scan.ts` | create | `export function scanFolder` |
| `src/import/store.ts` | create | `export function createImportStore` |
| `src/import/extract.ts` | create | `export async function runImportExtraction` |
| `src/import/commit.ts` | create | `export function commitImport` |
| `src/import/adopt.ts` | create | `export function adoptPriorIngest` |
| `web/import-review.ts` | create | `export function renderImportReview` |
| `web/import-entry.ts` | create | `export function renderImportEntry` |
| `scripts/export-leaflet.ts` | create | `not built — see Q-57` |
| `scripts/ingest-posts.ts` | patch | `from '../src/import/body.js'` |
| `src/clerk/docket.ts` | patch | `runImportJobs?:` |
| `src/types.ts` | patch | `imports?: { extracted: number` |
| `src/server.ts` | patch | `adoptPriorIngest(` |
| `src/log/format.ts` | patch | `import-refused` |
| `web/main.ts` | patch | `renderImportReview` |
| `tests/import-contract.test.ts` | create | `no restate verb` |
| `tests/import-body.test.ts` | create | `splits only on paragraph boundaries` |
| `tests/import-scan.test.ts` | create | `never from \`lastmod\` or the mtime` |
| `tests/import-store.test.ts` | create | `writes no snippet, transcript or reading` |
| `tests/import-extract.test.ts` | create | `only visible in the raw file` |
| `tests/import-docket.test.ts` | create | `runs the import job last` |
| `tests/import-commit.test.ts` | create | `asserts every snippet against the SOURCE FILE` |
| `tests/import-adopt.test.ts` | create | `adopts the excluded groups with their reasons` |
| `tests/import-routes.test.ts` | create | `adopts prior ingest before admitting` |
| `tests/import-review.test.ts` | create | `three verbs and never restate` |
| `tests/import-acceptance.test.ts` | create | `re-running imports nothing twice` |
| `tests/fixtures/import-folder/undated.md` | create | `title:` |
<!-- PLAN_MANIFEST_END -->

Not materialised as a seeds DAG (see assumption A7). Before dispatch: `sd create` per task with `--label plan:bulk-import,wave:<N>`, `sd dep` on each contract edge (T3→T2, T4→T1, T5→T4, T6→T5, T7→T4, T8→T4, **T9→T8**, T9→T7, T10→T9, T11→T10, T12→T11), `sd block` per wave pair. The `T9→T8` edge is the one added after review: the scan route is adoption's only caller, so scheduling T9 before T8 would produce a route with nothing to call.

## Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-1 | Sole Authorship: cuts are exact substrings, enforced in code | Task 5 (extract), Task 7 (commit), Task 12 (acceptance) |
| Q-3 | Markdown is the source of truth; indexes are derived | Task 4 (store on disk), Open Question Task 1 |
| Q-5 | Snippet versions are immutable | Task 7 Step 3 (why an edited file is not a version) |
| Q-23 | Every act is logged to an inspectable Activity Log | Standing rule 4; Tasks 3, 5, 6, 7 (formatters) |
| Q-25 | The app is password-locked | Task 9 (routes sit behind the same auth) |
| Q-28 | Claim minting is immediate from readings | Task 7 (why commit writes Readings), Open Question Task 7 |
| Q-50 | Two cites are independent only across sittings | Task 3 (the date rule and its measured basis), Task 7, Task 12 |
| Q-51 | Inseparable authorship is not admissible corpus | Task 2 (citation paragraphs), Task 5 (cut level, against the raw source), Task 8 (adopting the script's exclusions with their reasons), Task 10 (piece-level exclude in the header), Task 13, Open Question Task 1 |
| Q-55 | Target is a filter that never relaxes | Task 1 (why no Target field), via Q-60 |
| Q-56 | Bounds ship live, not shadow | Task 5 (per-run budget), Standing rule 7 |
| Q-57 | One door: a folder on disk; frontmatter dates or refusal | Task 3 (refusals), Task 9 (the folder route), Task 11 (no picker), Task 13 (export stubs) |
| Q-58 | The import review IS the harvest review, whole, three verbs | Task 1 (no restate in the type), Task 5 (extraction ahead of review), Task 6 (in the docket), Task 10 (the surface), Open Question Task 1 |
| Q-59 | Identity is the content hash; a changed file is a new item | Task 3 (body hash), Task 4 (skip on known hash; the `lastmod` date branch), Task 5 (dedupe against `kept`, before review), Task 7 Step 3 (the four-file end-to-end proof), Task 8 (adoption keys on hash) |
| Q-60 | Imported items carry no Target and no Target control | Task 1 (the type), Task 7 (the transcript), Task 10 (the surface, and where the piece-level exclude sits) |
| Q-61 | The vault is a git repository | Task 4 Step 3 (`vault/imports/` stays tracked), Assumption A4 |
| 047 | The docket runs off the response path, single-flight | Task 6 (injection, re-trigger, the existing replay) |
| 048 | `channel` records how the words arrived | Task 7 Step 4 (wired and asserted on disk), Assumption A2 |
| 073 | Antecedent context on every snippet (LANDED — verified 2026-08-02) | Task 7 (imported snippets stamp `context` by 073's own rule, asserted on disk), Task 10 (builds beside the landed `renderProposal`, never touching it), Assumption A1 |

## Shape Changes

| Date | Role | Finding | Summary |
|---|---|---|---|
| 2026-08-02 | author | — | Written from ticket 058 with all five open questions ruled (Q-57..Q-60). |
| 2026-08-02 | author | Review issue 1 | T5's raw-source Q-51 test described an unreachable case (a paragraph-break span is not a span). Replaced with the reachable route — `clean` removing a blockquote line from *inside* a paragraph — plus a guard test proving the turn-scoped check alone would pass it. `quoted.md` paragraph 4 built to match. |
| 2026-08-02 | author | Review issue 2 | `adoptPriorIngest` shipped uncalled: the folder path exists only at request time. T9 Step 2 now calls it before `admit`, T8 Step 4 asserts the call from the route, and the wave table flags the one step that spans a boundary. Standing rule 8 added, citing ticket 077. |
| 2026-08-02 | author | Review issue 3 | T7 Step 3 contradicted its own contract on `started` and had no Verify. The date branch moved to `store.admit` (one rule, one place), dedupe moved to T5 (before review, so it can never remove an approved cut), `ImportRecord.kept` added to carry the texts dedupe reads, and Step 3 became a four-file end-to-end proof with a runnable command. |
| 2026-08-02 | author | Review issue 4 | The document-rule criterion was a comment. Replaced with four executable claims (page of text, no list furniture, controls only on focus, nothing that accepts without reading), plus the ticket's own escape hatch if one cannot be written. |
| 2026-08-02 | author | Review issue 5 | `quoted.md` spelled out in full in T2 Step 1, since Step 2 and T5 assert exact strings from it and the fixture rule forbids editing it later. |
| 2026-08-02 | author | Review issue 6 | T2 Step 3's line-range copy replaced with four names — `clean`, `dropCitedParagraphs`, `ORPHAN_QUOTES`, `toTurns` — and explicit reasons `selectBody` stays in the script (manifest judgement, called at `:507` and `:592`) and the two quotation predicates come from `admissibility.ts`. |
| 2026-08-02 | author | Review issue 7 | Deleted a stray `</content>`/`</invoke>` artifact from the end of the file. |
| 2026-08-02 | author | R2 issue 1 | T5's vacuity guard asserted the prepared turn holds NO spans, which contradicts `quoted.md` paragraph 2 (it survives preparation by design). Narrowed to this cut's span; fixture untouched. |
| 2026-08-02 | author | R2 issue 2 | T8 Step 4 asserted corpus-only counts against the fixture. Rewritten in T9 Step 1's form (`adopted > 0` plus the seeded post absent from pending), and the slug resolver now specified to try `<slug>/index.md` **and** `<slug>.md` — without the flat form no test in T8 can run off the corpus. T8 Steps 1–2 split the same way: mechanism on the fixture, numbers behind `ELICIT_IMPORT_CORPUS`. |
| 2026-08-02 | author | R2 issue 3 | T4's first test switched from `toEqual` to `toMatchObject` — the `refused` key added in R1 would have reddened it on a signature change rather than a behaviour one. |
| 2026-08-02 | author | R2 issue 4 | `EXCLUDED` is 12 entries, not 13 (verified at `scripts/ingest-posts.ts:250-261`). Corrected in the File Structure table, T8 Step 2, T8 Step 3's arithmetic breakdown, and the R1 Shape Changes row that introduced the wrong number. |
| 2026-08-02 | author | R2 advisories | `RefusalReason` gains `no-lastmod`, so a changed-file refusal no longer renders "has no date in its frontmatter" about a file that has one; T3's log step now specifies a sentence per reason. `quoted.md` property 2 states why its line wrap is load-bearing — the quote is character-identical to `ORPHAN_QUOTES` and escapes it only because the fixture breaks the line where the pattern has a space. |
| 2026-08-02 | author | Advisories | Wave 0's blocking question resolved from ticket 058 §3 (piece-level exclude is mandated; Q-60 governs placement, so it sits in the header). The script's `EXCLUDED` groups are adopted as `excluded` records with their reasons — T12 Step 2's expected line corrected from "28 to import" to "0 to import, 47 already known" (19 + 28 = 47). Skill annotations repointed to `interface-design:interface-design`; the unavailable codebook annotation dropped; flow positions renumbered 1–13. |
