# Seeding Slice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person points Elicit at a vault of thousands of undated notes, sees a
map of which parts are already in the corpus, is offered one region at a time
when the questions open now touch it, declares how that region is dated and who
wrote it, and reviews it through the surface ticket 058 already built.

**Architecture:** Seeding does not build an importer. `src/import/` — scan →
staging store → extraction in the docket → per-item review → one dated sitting —
is the foundation and stays whole. Seeding adds one new noun, the **region** (a
folder subtree with a declared dating rule and a declared authorship, recorded on
disk), and threads it through the four places that need it: the scan's date rule
(Anchor), the store's queue bound (Cut), extraction's stance guard (authorship),
and a model-free survey that computes harvested state per folder without reading
a single word into a model. Two live mechanisms ship under Q-62 because their
only power is to offer: the Reach line on the waiting surface, and the repair
questions minted at commit under a cap. Two of the seven jobs build almost
nothing — Link because the rule Q-71 wants already exists in `extract.ts`, and
Confirm because Q-66 deleted the weak prior — but Confirm is not free, for a
reason found while writing this plan and recorded in §1, Finding 2.

**Tech Stack:** TypeScript, Node, Hono, gray-matter, vitest. No new dependency.
No model call in Survey, Anchor, Reach, Link or Repair.

---

## 1. What is already true, and must stay true

Ticket 058's dispatch 1 landed six of its thirteen tasks. **Verified on disk
2026-08-02**, these files exist and are green:

| File | What it does |
|---|---|
| `src/import/contract.ts` | `ImportStatus`, `RefusalReason`, `ImportCut`, `ImportRecord`, `ImportDecision`. Types only. |
| `src/import/body.ts` | `clean`, `dropCitedParagraphs`, `toTurns`. Pure. |
| `src/import/scan.ts` | `scanFolder(root)` → items and refusals. `bodyHash(body)`. No model, no writes. |
| `src/import/store.ts` | `createImportStore(vaultRoot)` — records at `vault/imports/<hash>.md`. `admit`, `knows`, `get`, `prepared`, `put`, `list`, `nextExtracted`, `nextPending`. |
| `src/import/extract.ts` | `runImportExtraction(deps)` — the docket job. Three drops in order: non-substring, Q-51 against the raw file, Q-59 dedupe. |
| `src/import/adopt.ts` | `adoptPriorIngest(deps)` — 19 accepted + 28 excluded, idempotent. |
| `src/import/prior-ingest.ts` | `MANIFEST` and `EXCLUDED` from the one-off script — the record `adopt.ts` reads its reasons out of. No task below touches it. |

**Not yet built, and this plan depends on all of it:** 058's T6 (docket wiring),
T7 (`src/import/commit.ts`), T9 (four routes in `src/server.ts`), T10
(`web/import-review.ts`), T11 (`web/import-entry.ts`). Waves 0–2 below are
file-disjoint from those tasks and may run in parallel with them. **Waves 3–5 are
gated:** do not start Wave 3 until 058's T6, T7 and T9 are committed, and do not
start Wave 4 until T10 and T11 are committed.

### Two findings from reading the code, both of which changed this plan

**Finding 1 — 046's `authorship` field never landed.** The grill brief says
ticket 046 "landed an `authorship` declaration on unprompted entry". It did not.
046 closed its item 1 (the honesty pass in README and CONTEXT.md) and *specified*
item 2 without building it: `grep -rn authorship src/` returns nothing but a
comment in `prior-ingest.ts`. What landed in that shape is ticket 048's
`CaptureChannel` — `Provenance.channel?: 'typed' | 'spoken' | 'pasted'`
(`src/types.ts:190`), carried into `decide()` through a `channelOf` callback
(`src/harvester/harvester.ts:629`). So there is nothing to reuse and nothing to
migrate: this plan names the field once, with Q-70's three values, and 046's
`'own' | 'other'` pair never existed outside a ticket. 048's field is the
*pattern* to copy — optional, absent means never asked, never read as a default,
conditionally spread so a present-but-undefined key cannot throw in
`matter.stringify`.

**Finding 2 — Confirm is not free; the licence path is gated on the wrong date.**
Q-66 makes a seeded claim license a Still-true revisit through the existing
`composeStillTrue` path. That path is fed by `src/clerk/docket.ts:154`:

```ts
const oldSnippets = allSnippets.filter(s => new Date(s.captured).getTime() < ninetyDaysMs);
```

`captured` is set by `vault.saveSnippet` to `new Date().toISOString()` — the
moment of filing, not the moment of writing. Every one of the 139 imported
snippets on disk carries `captured: '2026-08-02T09:25:52.852Z'` (verified:
`vault/snippets/01KZ0WPJ2KYCBVJZRV0CCETZGG/v1.md`). A note written in 2017 is
therefore invisible to the still-true channel until 2026-10-31. Ticket 075's
premise — "with 139 imported snippets dated 2017-2026, essentially the whole
corpus is >90 days old" — is true of the prose and false of the field the filter
reads. Under Q-50 the written date is the only thing that makes seeded material
more than one piece of evidence, so a licence that ages by filing date discards
exactly the property Seeding exists to add. Task 5 fixes it: age by written-when,
read from the sitting the snippet belongs to. Everything else about Confirm is
correct as ruled — no fifth status, no discount, no new object.

**Finding 3 (review round 1) — the sitting date arrives as `''`, never
`undefined`.** `listSessions` at `src/server.ts:296-314` builds
`started: data.started ?? ''`. A transcript with no `started` yields an empty
string, `new Date('')` is `Invalid Date`, and `NaN < ninetyDaysMs` is `false` —
so a `??` fallback in Task 5 would never fire, and the snippet would drop out of
still-true candidacy in silence. That is Finding 2 again through a different
door. Task 5's contract therefore requires a parseable-date check and names `??`
as the wrong operator.

---

## 2. Flow Map

```
 a folder on disk, pointed at once                  ← still the only door (Q-57)
        │
        ▼  GET /api/import/survey?folder=…          model-free, no date rule needed
  import/survey.ts ── every *.md → bodyHash → does the store know it, accepted?
        │             per folder node: files / harvested / refused / unread
        ▼  vault/imports/survey.json                derived, rebuildable (Q-3)
        │
        │   ┌───────────────────────────────────────────────────────────────┐
        │   │ the waiting surface, between sittings                         │
        ▼   ▼  GET /api/reach                                               │
  import/reach.ts ── terms of the LIVE QUEUE's pending questions            │
        │            ∩ terms of each unharvested node's own path names      │
        │            ≥ reach.nameOverlapMinTerms → ONE dimmed line          │
        │            every evaluation logged (Q-62). Silence does nothing.  │
        └───────────────────────────────────────────────────────────────────┘
        │  the person accepts, or types a folder path themselves
        ▼  POST /api/import/region  { root, dating, authorship }
  import/region.ts ── vault/imports/regions/<slug>.md — declared ONCE, on disk,
        │             re-read by every later stage. Nothing holds it in memory.
        │
        ▼  POST /api/import/scan { folder: region.root }        (058's route)
  import/scan.ts + import/dating.ts ── frontmatter key OR filename pattern (Q-67)
        │             every non-matching file REFUSED BY NAME. Never mtime.
        ▼  store.admit(items, region.slug)  → records carry `region`
        │
        ▼  startDocket('import') → import/extract.ts            (058's job)
        │   region.authorship !== 'authored' → prompt clause + MECHANICAL guard:
        │   no cut leaves extraction with stance 'avowal' (Q-70)
        │   Q-59 dedupe still reads `kept` WITHIN one sourcePath only (Q-71)
        ▼  status: extracted
        │
        ▼  GET /api/import/next?region=<slug>       ← the ONLY change to Cut (Q-68)
  web/import-review.ts ── UNCHANGED. Piece whole, cuts in place, three verbs,
        │                  no batch accept. The queue is bounded, the gate is not.
        ▼  POST /api/import/<hash>/decisions        (058's route)
  import/commit.ts ── one dated sitting; provenance gains `authorship`
        │
        ▼  import/repair.ts, called by the decisions route after a clean commit
        │   snippet opens with an anaphor AND has no context window
        │   → one Bud (Q-6) + one mechanically-composed question, source
        │     'import-repair', under repair.liveCap (Q-56). NO repair surface.
        │
        ▼  the corpus. Still-true now ages these by WRITTEN-when (Task 5, Q-66).
```

---

## 3. Standing rules for every task below

1. **Zero LLM unless the job is a cut.** Survey, Anchor, Reach, Link and Repair
   make no model call. The only `complete()` in this plan is the one
   `runImportExtraction` already makes.
2. **Region state is on disk or it does not exist.** No module-level `Map`, no
   cache that outlives a request without a file behind it. The 075 idiom: every
   decision is recomputed from disk, so a restart resumes rather than restarts.
3. **A mechanism is not done until something calls it.** This repo has shipped
   six inert mechanisms; ticket 077 counts five. Every task that adds a
   parameter or a function names its caller in its verification and asserts the
   effect on disk or in a response body, never the signature.
4. **Offer-only ships live and logs every evaluation (Q-62).** Reach and repair
   minting are offers: silence costs nothing. They ship live from day one and
   each writes what it evaluated, not only what it offered.
5. **A refusal is recorded with its reason and names the file.** No date under
   the declared rule → refused by name. Never a guess, never an mtime.
6. **A new Activity Log kind lands with its sentence** in `src/log/format.ts`, in
   the same task, or `tests/log-format.test.ts` goes red (Q-23).
7. **`src/log/format.ts` holds foreign unstaged hunks** (058's execution log,
   leftovers). Stage hunk-by-hunk — `git add -p` — never `git add src/log/format.ts`.
8. **Derived is derived.** The survey snapshot and the harvested/unharvested
   marks are computed from the import store; nothing stores a completeness
   boolean anyone can falsify by editing (Q-3).

---

## 4. File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/import/region.ts` | The region record: declare, read, list, and `regionFor(path)`. On disk at `vault/imports/regions/<slug>.md`. The only file that knows the record's shape. |
| `src/import/dating.ts` | `DatingRule` → a date for one file. Frontmatter key or compiled filename pattern. Pure, no I/O. |
| `src/import/survey.ts` | Folder → per-node counts of files / harvested / refused / unread, plus the snapshot write and read. Model-free. |
| `src/import/reach.ts` | The offer: live question terms ∩ region name terms, ranked, one result, every evaluation logged. |
| `src/import/repair.ts` | Mechanical dangler detection → one Bud + one composed-by-template question, capped and ledgered. |
| `web/survey-map.ts` | The map: the tree as text with counts, and the declaration form (dating rule, authorship) at Reach. Injected deps, as `web/import-review.ts` is. |
| `tests/import-region.test.ts`, `import-dating.test.ts`, `import-survey.test.ts`, `import-reach.test.ts`, `import-repair.test.ts`, `seeding-acceptance.test.ts` | One suite per module plus the seven-jobs acceptance suite. |
| `tests/fixtures/seeding-vault/` | A small undated vault: filename-dated notes, one that does not match, a nested subtree, the same sentence in two files. |

**Modified:**

| File | Change | Task |
|---|---|---|
| `src/import/contract.ts` | `Authorship`, `DatingRule`, `RegionRecord`; `ImportRecord.region?`; `RefusalReason` gains `'no-date-in-name'`. | T1 |
| `src/types.ts` | `Provenance.authorship?`; `QueueEntry['source']` gains `'import-repair'`. | T1 |
| `src/queue/source-label.ts` | One label for the new source — the `Record` at `:40` does not compile without it. | T1 |
| `src/import/scan.ts` | `scanFolder(root, rule?)`, default = today's behaviour; `walkMarkdown` lifted out of the private `visit`. | T3 |
| `src/import/store.ts` | `admit(items, region?)`; `nextExtracted(region?)`, `nextPending(region?)`. | T6 |
| `src/import/extract.ts` | Region lookup → authorship prompt clause and the mechanical stance guard. Imports the already-exported `SYSTEM_PROMPT`. | T7 |
| `src/clerk/docket.ts` | Still-true ages by written-when, behind a parseable-date guard. | T5 |
| `src/import/commit.ts` (058 T7) | Deps gain `regionFor`; stamps `provenance.authorship`. | T9 |
| `src/wiki/thresholds.ts` | `repair.liveCap`, then `reach.nameOverlapMinTerms`. | T10, then T11 |
| `src/server.ts` | Four routes, `?region=` on 058's next route, and the three injection sites. **T12 alone.** | T12 |
| `web/import-entry.ts` (058 T11) | One line: call `renderSurveyMap`. | T13 |
| `web/import-review.ts` (058 T10) | One line: send the region slug to `/api/import/next`. | T13 |
| `web/main.ts` | One `api('/api/reach')` call and one dimmed line in `renderWaiting` (`:1442`). | T14 |
| `web/style.css` | The map's node lines, then the offer line. | T13, then T14 |
| `src/log/format.ts` | Sentences for the new kinds. **One task at a time** — it carries foreign unstaged hunks. | T3, T4, T5, T10, T11 |
| `src/registry.ts` | Entries for every new `src/` export (077); T12 flips eight to `live`. `web/` exports are not swept — see Task 13. | T2, T3, T4, T10, T11, T12 |

**Not modified: `src/harvester/harvester.ts`.** `SYSTEM_PROMPT` is already
exported at `:92` and the 048 `channelOf` seam already exists at `:629`.

---

## Wave 0 — the contracts

### Task 1: The three new types — region, dating rule, declared authorship [MODIFY]

**Orient:** Nine tasks across five waves read and write one region declaration and
one authorship value; if each invents its own shape, the review surface and the
committer will disagree about who wrote a piece, and that disagreement lands as a
false avowal in the wiki rather than as a type error.
**Flow position:** Step 1 of 15 — consumed by every later task (**contract** →
region store → dating → survey → store → extract → commit → reach → repair).
**Skill:** `none` (types only, no behaviour to test)
**Files:**
- Modify: `src/import/contract.ts` (append; do not reorder existing members)
- Modify: `src/types.ts` (`Provenance`, `QueueEntry['source']`)
- Modify: `src/queue/source-label.ts:40-46` — `SOURCE_LABELS` is a
  `Record<QueueEntry['source'], string>` and **will not compile** without the new
  member
- Modify: `tests/queue-source-label.test.ts:15-21` — the runtime `SOURCES` array,
  which a type cannot generate

<contracts>
**Downstream (this-node → every other node):**

```ts
// src/import/contract.ts

/**
 * Who wrote the prose in a region, DECLARED by the person at Reach time and
 * never detected (Q-70; detection is banned permanently by 046).
 *
 * `authored` is the only value that may carry `stance: 'avowal'`. A vault holds
 * pasted model output and clipped quotes at scale, and a sentence the person
 * kept but did not write evidences the KEEPING, not the holding.
 */
export type Authorship = 'authored' | 'other' | 'machine-assisted';

/**
 * The one mechanical rule that dates every file in a region (Q-67, amending
 * Q-57 for undated corpora). Declared once, at Reach. What Q-57 bans is the
 * GUESS — mtime above all, a lie for anything ever copied. A date typed into a
 * filename is a declaration the person made at the time, the same epistemic
 * class as frontmatter.
 */
export type DatingRule =
  | { kind: 'frontmatter'; key: string }
  /** A template over `YYYY`, `MM`, `DD`; every other character is literal. */
  | { kind: 'filename'; pattern: string };

export type RegionRecord = {
  /** Derived from the path; stable across restarts. See `region.ts#slugFor`. */
  slug: string;
  /** Absolute path to the subtree root. A region IS a folder subtree (Q-68). */
  root: string;
  dating: DatingRule;
  authorship: Authorship;
  declared: string;
};
```

Additions to existing types:

```ts
// src/import/contract.ts — ImportRecord
  /**
   * The region this item was admitted under (Q-68). Absent on the 19 records
   * adopted from the one-off run and on anything admitted before Seeding —
   * absent means "no region", never "the default region", and an absent value
   * must never match a region filter.
   */
  region?: string;

// src/import/contract.ts — RefusalReason
  /** The declared filename pattern does not match this name (Q-67). */
  | 'no-date-in-name'

// src/types.ts — Provenance
  /**
   * Who wrote it, DECLARED (Q-70). Absent means never asked — every snippet
   * written before this field existed, and every snippet from a live sitting.
   * Absent must never be read as 'authored'; a consumer that treats missing as
   * authored has reintroduced the bug ticket 046 is about.
   */
  authorship?: 'authored' | 'other' | 'machine-assisted';

// src/types.ts — QueueEntry['source']
  | 'import-repair'
```
- Behavioural invariant: `Provenance.authorship` duplicates no existing field.
  `channel` (048) records *how the words arrived at the box*; `authorship`
  records *who composed them*. A pasted sentence the person wrote and a pasted
  sentence they clipped are `channel: 'pasted'` alike and differ here.
- Behavioural invariant: **adding `'import-repair'` to `QueueEntry['source']`
  breaks one exhaustive check on purpose, and that break is the point.** The
  union's own comment (`src/types.ts:259-267`) says nothing *switches* over it,
  and that stays true — `draw` compares against `'user-declared'` only and
  `expire` filters on status. But `src/queue/source-label.ts:40` holds
  `const SOURCE_LABELS: Record<QueueEntry['source'], string>`, and a `Record`
  keyed by the union rejects a missing key at compile time. That file exists
  precisely so a new member cannot reach the waiting surface as a machine
  literal (ticket 063 found 26 doing exactly that). Adding the member without
  its label is a `tsc` failure, not a silent leak.
- Behavioural invariant: **the new label must obey Q-15 and say nothing about
  repair.** `tests/queue-source-label.test.ts:47-55` asserts that no source
  literal appears in any label, and `:57-61` asserts
  `sourceLabel('contradiction-remeasure') === sourceLabel('composed')` — a
  re-measure that announces itself as a re-measure is the verification Q-15
  forbids. A repair question is the same case and stronger: a line reading
  "repairing a dangling referent" tells the person their own sentence was
  defective. Use the same words the other four use:
  `'import-repair': 'from your own words'`. That is not laziness; four of the
  five existing labels are identical for this reason, recorded at
  `source-label.ts:31-38`.
- The runtime `SOURCES` array at `tests/queue-source-label.test.ts:15-21` cannot
  be derived from a type and is what a new member must be added to — the file's
  own comment says so. Forgetting it makes the label tests pass over four of
  five members and prove nothing about the fifth.
</contracts>

- [ ] **Step 1: Append the types, then follow the compiler**

Append to `src/import/contract.ts`; add the two fields to `src/types.ts` in
place, each with the doc comment above. Do not touch `ImportDecision` — the
absence of `restate` is structural (Q-58) and stays.

Then run `npx tsc --noEmit` **before writing any test**. It fails in exactly one
place: `src/queue/source-label.ts:40`. Add
`'import-repair': 'from your own words',` to `SOURCE_LABELS`, and add
`'import-repair',` to `SOURCES` in `tests/queue-source-label.test.ts:15-21`. If
`tsc` fails anywhere else, that is a second exhaustive check this plan did not
find — report it before working around it.

- [ ] **Step 2: Prove the compiler sees them, and that the label says nothing**

Add to `tests/import-contract.test.ts` (exists, 2 tests):

```ts
it('absent authorship is absent, not authored', () => {
  const p: Provenance = { kind: 'unprompted', session: 's', question: '', questionForm: 'deliberative' };
  expect('authorship' in p).toBe(false);
});

it('a region filter cannot match a record with no region', () => {
  const r: ImportRecord = { hash: 'h', sourcePath: 'p', date: '2018-01-01', status: 'pending', attempts: 0 };
  expect(r.region === 'journals').toBe(false);
  expect(r.region).toBeUndefined();
});
```

And the label, in `tests/queue-source-label.test.ts` beside the existing Q-15
assertion at `:57-61`:

```ts
it('reads a repair question as the words composed gets — Q-15', () => {
  expect(sourceLabel('import-repair')).toBe(sourceLabel('composed'));
});
```

Two existing assertions now cover the new member automatically, because they
iterate `SOURCES`: the non-empty check (`:34-38`) and the no-literal check
(`:47-55`). There is no no-slug check for queue sources — that one applies to
facets. Two is what adding the member to the array buys, and it is why the array
is not optional.

Run: `npx vitest run tests/import-contract.test.ts tests/queue-source-label.test.ts && npx tsc --noEmit`
Expected: PASS — 4 contract tests and the full source-label suite including the
new Q-15 assertion; tsc clean.

- [ ] **Step 3: Commit**

```bash
git add src/import/contract.ts src/types.ts src/queue/source-label.ts \
        tests/import-contract.test.ts tests/queue-source-label.test.ts
git commit -m "seeding: the region, its dating rule, and declared authorship"
```

---

### Task 2: The region record on disk — declared once, re-read forever [NEW FILE]

**Orient:** Every later stage — the scanner's date rule, the store's queue bound,
extraction's stance guard, the committer's provenance stamp — needs to know which
region a file belongs to, and a process restart between the declaration and the
review must lose nothing, so the declaration is a file and every reader recomputes
from it.
**Flow position:** Step 2 of 15 (contract → **region store** → dating → survey →
scan → extract → commit). Upstream: a declaration from the route (T12).
Downstream: `regionFor(path)`, called by extract (T7) and commit (T9).
**Skill:** `tdd`
**Files:**
- Create: `src/import/region.ts`
- Create: `tests/import-region.test.ts`
- Modify: `src/registry.ts` (one entry per export, ticket 077)

<contracts>
**Downstream (region store → everything):**
```ts
export type RegionStore = {
  declare(input: { root: string; dating: DatingRule; authorship: Authorship }): RegionRecord;
  get(slug: string): RegionRecord | null;
  list(): RegionRecord[];
  /** The DEEPEST declared region containing this path, or null. */
  regionFor(sourcePath: string): RegionRecord | null;
};
export function createRegionStore(vaultRoot: string): RegionStore;
export function slugFor(root: string): string;
```
- On disk: `vault/imports/regions/<slug>.md`, gray-matter, frontmatter = the
  `RegionRecord`, body empty. The same shape `store.ts` uses for import records,
  for the same reason — markdown is truth (Q-3) and a declaration about the
  corpus is a decision record, not a derived artifact.
- `slugFor(root)`: the path's basename and parent, lowercased and reduced to
  `[a-z0-9-]`, then `-` and the first 6 hex of `sha256(root)`. The hash suffix is
  not decoration: two subtrees named `2019` under different parents sanitize to
  the same string, and a collision would silently hand one region's authorship
  declaration to another's files.
- Behavioural invariant: **`declare` is idempotent on `root` and last-write-wins
  on the declaration.** Re-declaring a root the person already declared rewrites
  `dating` and `authorship` and keeps the slug — a person who realises the
  folder is model output must be able to say so without minting a second region
  that half the records point at.
- Behavioural invariant: **`regionFor` returns the DEEPEST match.** Declaring
  `vault/journals` and then `vault/journals/2019-therapy` as `other` must send
  the 2019 files to the deeper declaration. Q-70's "move files, not flags" makes
  the folder the declaration instrument; nesting is how a person corrects a
  mixed folder without moving anything.
- Behavioural invariant: paths are compared as resolved absolute paths with a
  trailing separator, so `/vault/journals-old` never matches region
  `/vault/journals`.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('a declaration survives a new store over the same vault', () => {
  createRegionStore(root).declare({ root: '/c/journals', dating: { kind: 'filename', pattern: 'YYYY-MM-DD' }, authorship: 'authored' });
  const fresh = createRegionStore(root);                    // simulates a restart
  expect(fresh.list()).toHaveLength(1);
  expect(fresh.list()[0]!.dating).toEqual({ kind: 'filename', pattern: 'YYYY-MM-DD' });
});

it('re-declaring a root keeps the slug and replaces the declaration', () => {
  const s = createRegionStore(root);
  const a = s.declare({ root: '/c/notes', dating: D, authorship: 'authored' });
  const b = s.declare({ root: '/c/notes', dating: D, authorship: 'machine-assisted' });
  expect(b.slug).toBe(a.slug);
  expect(s.list()).toHaveLength(1);
  expect(s.get(a.slug)!.authorship).toBe('machine-assisted');
});

it('regionFor returns the deepest declared region', () => {
  s.declare({ root: '/c/journals', dating: D, authorship: 'authored' });
  const inner = s.declare({ root: '/c/journals/2019', dating: D, authorship: 'other' });
  expect(s.regionFor('/c/journals/2019/a.md')!.slug).toBe(inner.slug);
  expect(s.regionFor('/c/journals/2018/a.md')!.authorship).toBe('authored');
});

it('does not match a sibling whose name shares a prefix', () => {
  s.declare({ root: '/c/journals', dating: D, authorship: 'authored' });
  expect(s.regionFor('/c/journals-old/a.md')).toBeNull();
});

it('two same-named subtrees under different parents get different slugs', () => {
  expect(slugFor('/c/work/2019')).not.toBe(slugFor('/c/personal/2019'));
});
```

Run: `npx vitest run tests/import-region.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Mirror `src/import/store.ts` exactly: `mkdirSync(regionsDir, {recursive:true})`,
`matter.stringify(body, fm)`, and the 048 hazard — every optional field
conditionally spread, never a present key holding `undefined`. `list()` reads the
directory each call; there is no cache, because a cache is the thing that does
not survive a restart.

Run: `npx vitest run tests/import-region.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Register and commit**

Add two entries to `src/registry.ts`, and **their statuses differ**:

- `src/import/region:slugFor` → **`live`**. `declare()` calls it one line below
  its own declaration, and `callerEvidence`
  (`tests/mechanism-registry.test.ts:239-265`) counts uses inside the declaring
  module past the declaration line. Declaring it `unwired` fails the suite with
  `declared unwired but called`.
- `src/import/region:createRegionStore` → **`unwired`**, until Task 12's routes
  construct it. This one genuinely waits.

The rule for every registry entry in this plan: `unwired` means *no caller
anywhere in `src/` or `web/` outside its own tests*, and an in-module or
sibling-module caller counts. A factory nothing constructs is unwired; a helper
its own module calls is live at birth.

```bash
git add src/import/region.ts tests/import-region.test.ts src/registry.ts
git commit -m "seeding: a region is a folder subtree, declared on disk"
```

---

## Wave 1 — the model-free half

### Task 3: Anchor — one declared dating rule, and every miss refused by name [MODIFY]

**Orient:** An Obsidian vault has thousands of notes and almost no `date:` keys,
so Q-57 as written refuses the whole corpus; this task lets a region declare that
its dates live in the filename, dates every file that matches, and refuses every
file that does not — by name, so a silent loss is impossible.
**Flow position:** Step 3 of 15 (region → **dating** → scan → store). Upstream: a
`DatingRule` from the region record. Downstream: `ScanResult` items and refusals.
**Skill:** `tdd`
**Files:**
- Create: `src/import/dating.ts`
- Create: `tests/import-dating.test.ts`
- Modify: `src/import/scan.ts` (`scanFolder`, `scanFile`, and one new export —
  `walkMarkdown`, see Step 3)
- Modify: `src/log/format.ts` — **stage hunk-by-hunk** (standing rule 7)
- Modify: `src/registry.ts` — **required**: `tests/mechanism-registry.test.ts`
  sweeps `src/` (`SWEEP_DIRS` at `:59`, collection at `:100-104`) and fails on
  any undeclared `src/` export. Four new ones land here: `compilePattern`,
  `dateFor`, `DEFAULT_DATING`, `walkMarkdown`.

<contracts>
**Upstream (region → dating):** `DatingRule`.
**Downstream (dating → scan):**
```ts
export const DEFAULT_DATING: DatingRule;                    // { kind: 'frontmatter', key: 'date' }
export function compilePattern(pattern: string): RegExp | null;   // null ⇒ the pattern is unusable
export function dateFor(rule: DatingRule, basename: string, frontmatter: Record<string, unknown>):
  { date: string } | { reason: RefusalReason };
export function scanFolder(root: string, rule?: DatingRule): ScanResult;   // default = today's behaviour

// src/import/scan.ts — extracted from scanFolder's private `visit`, unchanged
// in behaviour, exported because Task 4 needs the same walk and a second copy
// would let the map and the scan disagree about which files exist.
export function walkMarkdown(root: string): string[];   // absolute paths, sorted, recursive
```
- Behavioural invariant: **`scanFolder(root)` with no rule behaves exactly as it
  does today.** `DEFAULT_DATING` is `{ kind: 'frontmatter', key: 'date' }`, so
  all five existing `tests/import-scan.test.ts` cases pass unchanged. Do not
  edit them; if one goes red the default is wrong.
- Behavioural invariant: **`lastmod` stays frontmatter-only under every rule.** A
  filename encodes one date, and Q-59's second sitting needs a *different* one.
  A changed file under a filename rule with no frontmatter `lastmod` is refused
  `'no-lastmod'` by the store, as it already is. That refusal is correct and it
  is a real limit — see Open Questions.
- Behavioural invariant: a compiled pattern still yields a date only if the
  captured day is a real calendar day. `2021-02-31` is `'unparsable-date'`, never
  rolled forward to March. Reuse `scan.ts`'s existing `isoDay` round-trip check;
  do not write a second date validator.
- Behavioural invariant: **`compilePattern` returning `null` is a declaration-time
  refusal, not a per-file one.** A pattern with no `YYYY`, or no `MM`, or no `DD`
  cannot produce a day, so the route (T12) refuses the declaration with 400 and
  no region is written. A region that cannot date anything must not exist.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('compiles a template into a regex over the basename', () => {
  expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-03-04', {})).toEqual({ date: '2021-03-04' });
  expect(dateFor({ kind: 'filename', pattern: 'YYYYMMDD' }, '20210304', {})).toEqual({ date: '2021-03-04' });
});

it('finds the date inside a longer name', () => {
  expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-03-04 Monday standup', {}))
    .toEqual({ date: '2021-03-04' });
});

it('refuses a name that does not match, by its own reason', () => {
  expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, 'ideas', {}))
    .toEqual({ reason: 'no-date-in-name' });
});

it('refuses an impossible day rather than rolling it forward', () => {
  expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-02-31', {}))
    .toEqual({ reason: 'unparsable-date' });
});

it('reads a declared frontmatter key that is not "date"', () => {
  expect(dateFor({ kind: 'frontmatter', key: 'created' }, 'x', { created: '2019-05-02' }))
    .toEqual({ date: '2019-05-02' });
});

it('rejects a pattern that cannot produce a day', () => {
  expect(compilePattern('YYYY-MM')).toBeNull();
  expect(compilePattern('journal')).toBeNull();
});

it('walks the same files scanFolder scans', () => {
  expect(walkMarkdown(FIXTURE)).toEqual(scanFolder(FIXTURE).items.map(i => i.sourcePath).concat(
    scanFolder(FIXTURE).refused.map(r => r.sourcePath)).sort());
});

it('scans an undated vault by filename and names every refusal', () => {
  const r = scanFolder(FIXTURE, { kind: 'filename', pattern: 'YYYY-MM-DD' });
  expect(r.items).toHaveLength(FIXTURE_ADMITTED);              // 4
  expect(r.items.map(i => i.date).sort()).toEqual(FIXTURE_DATES);
  expect(r.refused).toHaveLength(FIXTURE_REFUSED);             // 2
  expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'journal/ideas.md'), reason: 'no-date-in-name' });
  expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'journal/2021-02-31.md'), reason: 'unparsable-date' });
});
```

Run: `npx vitest run tests/import-dating.test.ts tests/import-scan.test.ts`
Expected: FAIL — `src/import/dating.ts` not found; the 5 scan tests still pass.

**The regression guard is those five tests, unedited.** Do not write a test
comparing `scanFolder(F)` to `scanFolder(F, DEFAULT_DATING)` — both sides would
run the same code and the assertion could not fail. `tests/import-scan.test.ts`
already pins the old behaviour against fixtures; leaving it untouched is the
proof that the default is right.

- [ ] **Step 2: Build the fixture**

**Six files, pinned here once, because Tasks 4, 8 and 15 all count them.** An
earlier draft described the fixture three times and the three descriptions
disagreed. Build exactly this, and export the table from
`tests/fixtures/seeding-vault/manifest.ts` so the dependent tests read the counts
instead of restating them:

| Path (under `tests/fixtures/seeding-vault/`) | Frontmatter | Fate under `filename: YYYY-MM-DD` |
|---|---|---|
| `journal/2021-03-04.md` | none at all | admitted, dated `2021-03-04` |
| `journal/2021-03-05 Monday.md` | none | admitted, dated `2021-03-05` |
| `journal/ideas.md` | none | refused `no-date-in-name` |
| `journal/2021-02-31.md` | none | refused `unparsable-date` |
| `journal/2019/2019-11-02.md` | none; holds `SHARED_SENTENCE` | admitted, dated `2019-11-02` |
| `journal/2019/2019-11-03.md` | none; holds `SHARED_SENTENCE` | admitted, dated `2019-11-03` |

```ts
// tests/fixtures/seeding-vault/manifest.ts
export const FIXTURE_FILES = 6;
export const FIXTURE_ADMITTED = 4;
export const FIXTURE_REFUSED = 2;
export const FIXTURE_DATES = ['2019-11-02', '2019-11-03', '2021-03-04', '2021-03-05'];
export const SHARED_SENTENCE = '…';   // verbatim, in two files under two dates
```

The last two files are what Task 8 needs: one sentence, two source paths, two
dates — the retelling Q-71 says must be kept twice. Three of the admitted files
open a cut with an anaphor and carry no preceding paragraph, which is Task 10's
three danglers against a cap of 2. Author the prose to make that true and say so
in a comment in the fixture, because a dangler count that drifts silently is a
repair test that stops testing the cap.

The `no-frontmatter` note below is why every file here has none: under a filename
rule a daily note with no `---` block is the normal case, not a refusal.

**Note the frontmatter interaction:** `scanFile` currently refuses
`'no-frontmatter'` before it ever looks for a date (`scan.ts:84`). Under a
filename rule that check must not fire — a daily note with no `---` block is the
normal case, and refusing it would refuse the corpus this task exists to admit.
Move the `'no-frontmatter'` refusal inside the `kind === 'frontmatter'` branch.
The `'empty-body'` refusal stays unconditional: a file with nothing in it has no
prose under any rule.

- [ ] **Step 3: Implement**

`compilePattern` escapes every regex metacharacter in the literal parts, then
replaces `YYYY` → `(\d{4})`, `MM` → `(\d{2})`, `DD` → `(\d{2})`, remembering the
group order so `DD-MM-YYYY` works. Return `null` unless all three tokens appear
exactly once. `dateFor` runs the regex against the basename with its extension
stripped, takes the first match, assembles `YYYY-MM-DD`, and validates it through
`scan.ts`'s existing round-trip.

**Extract the walker while you are in this file.** `scanFolder`'s recursive
`visit` (`scan.ts:109-130`) is a private closure, so Task 4 cannot reuse it and
would otherwise copy it — and a copied walk is how a map comes to show files the
scan does not admit. Lift it to a module-level `walkMarkdown(root): string[]`
returning sorted absolute paths, and have `scanFolder` call it. Behaviour
unchanged: same sort, same two extensions, same recursion.

Add the log kind `import-refused-by-rule` and its sentence in `src/log/format.ts`
— it carries `rule=` and `count=`, never a file's content.

- [ ] **Step 4: Declare the four new exports**

`tests/mechanism-registry.test.ts` sweeps `src/` and fails on any export missing
from `src/registry.ts`. Add `src/import/dating:compilePattern`, `:dateFor`,
`:DEFAULT_DATING` and `src/import/scan:walkMarkdown`.

**All four are `live` at birth, not `unwired`.** Each has a caller the moment it
exists: `dateFor` calls `compilePattern`, `scanFile` calls `dateFor`,
`scanFolder` defaults its parameter to `DEFAULT_DATING`, and `scanFolder` calls
`walkMarkdown`. `callerEvidence` (`tests/mechanism-registry.test.ts:239-265`)
counts identifier uses across `src/` and `web/` outside import spans, including
uses inside the declaring module past its declaration line, so `unwired` here
fails the suite with `declared unwired but called` (`:303-306`). What is not yet
wired is the *dating rule reaching a real scan*, and that is Task 12's route —
a fact the plan records in prose, not by misdeclaring a status.

Run: `npx vitest run tests/import-dating.test.ts tests/import-scan.test.ts tests/log-format.test.ts tests/mechanism-registry.test.ts`
Expected: PASS — 8 dating, 5 scan (unchanged), log-format and registry green.

- [ ] **Step 5: Commit**

```bash
git add src/import/dating.ts src/import/scan.ts src/registry.ts \
        tests/import-dating.test.ts tests/fixtures/seeding-vault
git add -p src/log/format.ts
git commit -m "seeding: a region declares how it is dated, and every miss is named"
```

---

### Task 4: Survey — the tree, with harvested state computed and never stored [NEW FILE]

**Orient:** Before anything is offered or reviewed, the person needs to see the
shape of their own vault and which parts are already in the corpus — and that map
must be computable without a model reading one word, because the whole point of
Survey is a coarse map, not a deep read.
**Flow position:** Step 4 of 15 (region → **survey** → reach, and survey → the
map surface). Upstream: a folder path and the import store. Downstream:
`vault/imports/survey.json` and the survey map (T13).
**Skill:** `tdd`
**Files:**
- Create: `src/import/survey.ts`
- Create: `tests/import-survey.test.ts`
- Modify: `src/log/format.ts` (`import-surveyed`) — stage hunk-by-hunk
- Modify: `src/registry.ts`

<contracts>
**Downstream (survey → reach and the map):**
```ts
export type SurveyNode = {
  /** Path relative to the survey root. '' is the root itself. */
  path: string;
  /** Files DIRECTLY in this folder. */
  files: number;
  /** …of which: an accepted import record exists for the body hash. */
  harvested: number;
  /** …of which: an excluded record exists — decided, and deliberately out. */
  refused: number;
  /** files − harvested − refused. What Reach may offer. */
  unread: number;
  /** The same four counts summed over this node and every descendant. */
  total: { files: number; harvested: number; refused: number; unread: number };
};
export type Survey = { at: string; root: string; nodes: SurveyNode[] };

export function surveyFolder(root: string, store: ImportStore): Survey;
export function writeSurvey(vaultRoot: string, survey: Survey): void;   // vault/imports/survey.json
export function readSurvey(vaultRoot: string): Survey | null;           // null ⇒ never surveyed
```
- Behavioural invariant: **no model call, and no date rule.** Harvested state is
  `store.get(bodyHash(body))?.status === 'accepted'`, and a body hash needs no
  date. Survey therefore works on a region before its dating rule is declared,
  which is required — the map is what the person reads *in order to* declare.
- Behavioural invariant: **nothing stores a completeness boolean.** Q-68 says the
  state is computable per node; computing it every survey is what keeps the map
  honest when a record changes underneath it (Q-3). `survey.json` is a cache with
  an `at` stamp, rebuildable by re-running, and is the one file in
  `vault/imports/` that may be deleted without loss.
- Behavioural invariant: a folder with no markdown files anywhere beneath it does
  not appear as a node. A vault has `.obsidian/`, `attachments/`, `.git/`; an
  empty branch on the map is noise the reader has to skim past.
- Behavioural invariant: `total` aggregates; `files`/`harvested`/`refused`/`unread`
  do not. The map renders `total` at a collapsed node and the direct counts at an
  expanded one, and conflating them is how a tree double-counts.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('counts markdown files per folder and aggregates up the tree', () => {
  const s = surveyFolder(FIXTURE, store);
  expect(node(s, '')!.total.files).toBe(FIXTURE_FILES);   // 6, from the fixture manifest
  expect(node(s, 'journal')!.files).toBe(4);              // direct children only
  expect(node(s, 'journal/2019')!.files).toBe(2);
});

it('marks a file harvested only when its body hash has an accepted record', () => {
  store.put({ hash: bodyHash(bodyOf('journal/2021-03-04.md')), sourcePath: p, date: '2021-03-04', status: 'accepted', attempts: 0 });
  expect(node(surveyFolder(FIXTURE, store), 'journal')!.harvested).toBe(1);
});

it('counts an excluded record as refused, never as harvested and never as unread', () => {
  store.put({ ...rec, status: 'excluded', excludeReason: 'not mine alone' });
  const n = node(surveyFolder(FIXTURE, store), 'journal')!;
  expect(n.refused).toBe(1);
  expect(n.harvested).toBe(0);
  expect(n.files).toBe(n.harvested + n.refused + n.unread);
});

it('omits folders that hold no markdown at any depth', () => {
  mkdirSync(join(FIXTURE, 'attachments'), { recursive: true });
  writeFileSync(join(FIXTURE, 'attachments', 'a.png'), '');
  expect(node(surveyFolder(FIXTURE, store), 'attachments')).toBeUndefined();
});

it('cannot make a model call — the module imports no LLM path', () => {
  const src = readFileSync('src/import/survey.ts', 'utf-8');
  expect(src).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
});

it('a written survey reads back after a restart', () => {
  writeSurvey(vaultRoot, surveyFolder(FIXTURE, store));
  expect(readSurvey(vaultRoot)!.nodes).toHaveLength(node_count);
});

it('readSurvey is null on a vault that was never surveyed', () => {
  expect(readSurvey(emptyVault)).toBeNull();
});
```

Run: `npx vitest run tests/import-survey.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Call `walkMarkdown` from `src/import/scan.ts` — the export Task 3 lifted out of
`scanFolder`'s private `visit` for exactly this. **Do not write a second walk.**
A map built by a different traversal than the scan will one day show a file the
scan refuses to admit, and the person will read that as a bug in the import
rather than in the map. Then read each path, strip frontmatter with `matter`, and
`bodyHash` the content — `bodyHash` is exported from `scan.ts` already. Group by
parent directory and aggregate `total` on the way back up.

Cost note for the executor: a 5,000-note vault is ~10 MB of reads and 5,000
SHA-256s — under two seconds, so the walk is synchronous and there is no progress
protocol to build. Do not add one speculatively; if a real vault proves slower,
that is a ticket with a number behind it.

Emit `import-surveyed` with `root=`, `files=`, `harvested=`, `unread=`. Never a
path from inside the vault beyond the root the person typed.

Run: `npx vitest run tests/import-survey.test.ts tests/log-format.test.ts`
Expected: PASS, 7 tests; log-format green.

- [ ] **Step 3: Declare the three exports, all unwired**

`src/import/survey:surveyFolder`, `:writeSurvey` and `:readSurvey` go into
`src/registry.ts` as **`unwired`**, and unlike Tasks 2, 3 and 11 all three of
this task's entries take that status: none of them calls another, and nothing
else in `src/` or `web/` calls any of them until Task 12's `/api/import/survey`
and `/api/reach` routes. They are three of the eight entries Task 12 Step 3
flips to `live`.

Run: `npx vitest run tests/mechanism-registry.test.ts`
Expected: PASS — no `declared unwired but called` violation, which is the check
that would fire if any of the three had a caller this task did not see.

- [ ] **Step 4: Commit**

```bash
git add src/import/survey.ts tests/import-survey.test.ts src/registry.ts
git add -p src/log/format.ts
git commit -m "seeding: survey the tree, compute harvested per node, store nothing"
```

---

### Task 5: Confirm — the still-true licence ages by written-when, not filed-when [MODIFY]

**Orient:** Q-66 makes a seeded claim license a Still-true revisit through the
existing path, and that path filters on `captured`, which for every imported
snippet is the day it was filed — so a note written in 2017 is invisible to the
channel built for exactly that material until 90 days after import, and the one
property Seeding adds is discarded by an off-by-one-field.
**Flow position:** Step 5 of 15 (docket → **still-true selection** → composeStillTrue
→ queue). Upstream: `allSnippets` and the session list. Downstream: unchanged —
`composeStillTrue` and the Queue see exactly what they saw before, only a truer
set of candidates.
**Skill:** `tdd`
**Files:**
- Modify: `src/clerk/docket.ts` — the still-true block; the filter is at `:154`
  and the optional `listSessions` dep at `:50`
- Modify: `tests/docket.test.ts`
- Modify: `src/log/format.ts` (`still-true-undateable`) — stage hunk-by-hunk
  (standing rule 7)

<contracts>
**Upstream (vault → docket):** `Snippet.captured` (filing time) and
`SessionRef { session, started, turnCount, chars }` from `deps.listSessions`
(`docket.ts:50`, optional), already fetched and sorted at `docket.ts:104-108`.
**Downstream (docket → composeStillTrue):** unchanged signature, unchanged
rotation cursor (075), unchanged quota of 2.
- The rule, and **`??` is the wrong operator here**:

```ts
/** Milliseconds a snippet's PROSE was written, or null when nothing says. */
function writtenAtMs(s: Snippet): number | null {
  const started = startedBySession.get(s.provenance.session);
  const t = started === undefined ? NaN : Date.parse(started);
  if (!Number.isNaN(t)) return t;
  const c = Date.parse(s.captured);
  return Number.isNaN(c) ? null : c;
}
// candidate ⟺ writtenAtMs(s) !== null && writtenAtMs(s) < ninetyDaysMs
```
- Behavioural invariant: **the guard is a parseable-date check, not `??`.**
  Verified on disk: `listSessions` at `src/server.ts:296-314` builds
  `started: data.started ?? ''`, so an absent `started` arrives as the **empty
  string, never `undefined`**. `'' ?? s.captured` evaluates to `''`,
  `new Date('').getTime()` is `NaN`, and `NaN < ninetyDaysMs` is `false` — a
  `??` fallback would therefore drop the snippet out of candidacy in silence
  instead of falling back. That is the same class of failure as Finding 2,
  arriving through a different door, and it is why this contract spells the
  guard out rather than naming an operator.
- Behavioural invariant: **the fallback is `captured`, never "old".** A snippet
  whose session cannot be resolved keeps today's behaviour. Treating an
  unresolvable session as ancient would flood the channel from the one path that
  knows least. A snippet whose `captured` is also unparseable is excluded and
  logged — not defaulted in either direction.
- Behavioural invariant: `deps.listSessions` is optional (`docket.ts:50`). When
  absent, every snippet falls back to `captured` and the block behaves exactly as
  it does today. Do not make the dep required — a required dep here breaks every
  docket test that does not supply it.
- Behavioural invariant: the rotation cursor keeps advancing past every candidate
  OFFERED (075). This task changes which snippets are candidates, not how the
  cursor moves.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
it('offers a snippet whose prose is nine years old but was filed today', async () => {
  const snippet = { id: 'a', version: 1, captured: new Date().toISOString(),
                    provenance: { kind: 'unprompted', session: 'import-abc', question: '', questionForm: 'deliberative' }, prose: '…' };
  const report = await runDocket({ ...deps,
    listSessions: () => [{ session: 'import-abc', started: '2017-04-11T00:00:00.000Z', turnCount: 1, chars: 10 }],
    composeStillTrue: spy });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), expect.anything(), expect.anything());
});

it('does not offer a snippet written today and filed today', async () => {
  // same snippet, session started now
  expect(spy).not.toHaveBeenCalled();
});

it('falls back to captured when the session is unknown', async () => {
  // listSessions returns [], captured 200 days ago → still offered
  expect(spy).toHaveBeenCalled();
});

it('falls back to captured when started is the EMPTY STRING listSessions writes', async () => {
  // The real shape: src/server.ts:296-314 writes `started: data.started ?? ''`.
  // This is the test a `??` implementation fails.
  const report = await runDocket({ ...deps,
    listSessions: () => [{ session: 'import-abc', started: '', turnCount: 1, chars: 10 }],
    // snippet captured 200 days ago
    composeStillTrue: spy });
  expect(spy).toHaveBeenCalled();
});

it('excludes and logs a snippet whose dates are both unparseable', async () => {
  // started: '', captured: 'not a date' → neither offered nor crashed
  expect(spy).not.toHaveBeenCalled();
  expect(logged('still-true-undateable')).toHaveLength(1);
});
```

Run: `npx vitest run tests/docket.test.ts -t 'still-true'`
Expected: FAIL on the first — the 2017 snippet is filtered out by `captured`.

- [ ] **Step 2: Implement**

Build one `Map<string, string>` from the already-fetched `sessions` array
(session → started) above the still-true block; replace the filter's date source
with `writtenAtMs` as written in the contract above. Do not touch the cursor, the
quota, or the ordering. Add `still-true-undateable` and its sentence to
`src/log/format.ts` in this task (standing rule 6).

Run: `npx vitest run tests/docket.test.ts tests/log-format.test.ts`
Expected: PASS — the full docket suite, including 075's rotation, wrap and
persistence tests; log-format green.

- [ ] **Step 3: Record the finding where the next reader will look**

The claim in ticket 075 ("essentially the whole corpus is >90 days old") was true
of the prose and false of the field. Add one comment at the filter naming
`captured` as filing time and `started` as writing time, and why the channel must
read the second. Do not edit ticket 075 — this plan does not modify tickets.

- [ ] **Step 4: Commit**

```bash
git add src/clerk/docket.ts tests/docket.test.ts
git add -p src/log/format.ts
git commit -m "clerk: still-true ages a snippet by when it was written, not filed"
```

---

## Wave 2 — the pipeline, bounded and declared

### Task 6: Cut — the review queue is never longer than the region [MODIFY]

**Orient:** Q-58's no-batch-accept survives a corpus forty times larger only if
the input is bounded instead of the gate weakened, so the region the person chose
bounds what the review hands them, and the surface itself changes by not one line.
**Flow position:** Step 6 of 15 (region → scan → **store** → extract → review).
Upstream: `ScannedItem[]` and a region slug. Downstream: `nextExtracted(region)`
for 058's `GET /api/import/next`.
**Skill:** `tdd`
**Files:**
- Modify: `src/import/store.ts` (`admit`, `nextByDate`, `nextExtracted`, `nextPending`, `list`)
- Modify: `tests/import-store.test.ts`

<contracts>
**Upstream (route → store):** `admit(items: ScannedItem[], region?: string)`.
**Downstream (store → review route):**
```ts
list(status?: ImportStatus, region?: string): ImportRecord[];
nextExtracted(region?: string): ImportRecord | null;
nextPending(region?: string): ImportRecord | null;
```
- Behavioural invariant: **an absent `region` argument means unfiltered, and an
  absent `region` field never matches a filter.** These are different absences
  and both are load-bearing: the docket extracts across all regions (a person
  may reach two regions in a week and both should be prepared), while a review
  bounded to `journals` must never be handed one of the 19 adopted posts, which
  carry no region at all.
- Behavioural invariant: `admit`'s existing contract is untouched — the date
  decision, the `knows` skip, the Q-59 second-sitting branch and the
  `'no-lastmod'` refusal all stay exactly where they are. `region` is written
  into the record alongside them, conditionally spread.
- Behavioural invariant: `writeRecord` must gain `region` in its explicit
  frontmatter object (`store.ts:76-89`) or the field is silently dropped on every
  write — that object is an allowlist, not a spread, and a field missing from it
  vanishes without an error.
- Behavioural invariant: extraction stays bounded by `budget` (Q-56) as well.
  Region-bounding and the live cap are different bounds and neither replaces the
  other: the region bounds *what may be reviewed*, the budget bounds *how much is
  prepared per run*.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('stamps the region on every admitted record', () => {
  store.admit([itemA], 'journals-ab12cd');
  expect(store.get(itemA.hash)!.region).toBe('journals-ab12cd');
});

it('hands the review only items from the chosen region', () => {
  store.admit([itemA], 'journals-ab12cd');
  store.admit([itemB], 'talks-99ffee');
  store.put({ ...store.get(itemA.hash)!, status: 'extracted' });
  store.put({ ...store.get(itemB.hash)!, status: 'extracted' });
  expect(store.nextExtracted('journals-ab12cd')!.hash).toBe(itemA.hash);
});

it('never hands a region filter an item that has no region', () => {
  store.admit([itemC]);                                   // the adopted-posts shape
  store.put({ ...store.get(itemC.hash)!, status: 'extracted' });
  expect(store.nextExtracted('journals-ab12cd')).toBeNull();
  expect(store.nextExtracted()!.hash).toBe(itemC.hash);   // unfiltered still sees it
});

it('keeps oldest-first inside a region', () => { /* two dates, one region */ });

it('round-trips region through a fresh store', () => {
  expect(createImportStore(vaultRoot).get(itemA.hash)!.region).toBe('journals-ab12cd');
});
```

Run: `npx vitest run tests/import-store.test.ts`
Expected: FAIL — 5 new, 7 existing still passing.

- [ ] **Step 2: Implement**

Thread the optional argument through; add `region` to `writeRecord`'s frontmatter
allowlist, conditionally spread. `nextByDate` takes the filter and applies it
before the sort.

Run: `npx vitest run tests/import-store.test.ts tests/import-extract.test.ts`
Expected: PASS, 12 store + 8 extract.

- [ ] **Step 3: Commit**

```bash
git add src/import/store.ts tests/import-store.test.ts
git commit -m "seeding: the region bounds the review queue; the gate is untouched"
```

---

### Task 7: Authorship through extraction — a clause the model reads, a guard the code enforces [MODIFY]

**Orient:** A vault is where `other` arrives at scale — pasted model output,
clipped quotes, half-transcribed conversations — and a sentence the person kept
but did not write must never come back as "the user articulates a long-held
personal philosophy", which is the exact damage the Persona 5 eval recorded.
**Flow position:** Step 7 of 15 (region → **extract** → review). Upstream: an
`ImportRecord` with a `region`. Downstream: `ImportCut[]` whose stances are true
of a non-authored region.
**Skill:** `tdd`
**Files:**
- Modify: `src/import/extract.ts`
- Modify: `tests/import-extract.test.ts`
- Modify: `src/log/format.ts` (`import-stance-coerced`) — stage hunk-by-hunk

**Do not modify `src/harvester/harvester.ts`.** `SYSTEM_PROMPT` is **already
exported** at `harvester.ts:92`, with a comment saying why ("Exported so the
ratchet harness can diff prompt variants against this baseline"). Import it and
move on. An earlier draft of this plan added the `export` keyword; that edit
would be a no-op against a file three other agents touch.

<contracts>
**Upstream (region store → extract):** `regionFor(record.sourcePath)` →
`RegionRecord | null`. A record with no region, or a region declared `authored`,
takes today's path with no change at all.
**Downstream (extract → the record):** `ImportCut[]` in which
`authorship !== 'authored'` ⟹ `stance !== 'avowal'`.
```ts
export type ExtractionDeps = {
  // …existing…
  /** Injected, not imported: the region store, so a test hands one region. */
  regionFor?: (sourcePath: string) => RegionRecord | null;
};
```
- **The production caller is Task 12, Step 3, and this task is inert without
  it.** Verified: the only place `ExtractionDeps` is constructed is 058 T6's
  `runImportJobs` inside `runDocketNow` in `src/server.ts`. Nothing in Waves 0–2
  touches that construction, so `regionFor` arrives `undefined` on every real
  run until Task 12 passes it. This task's Step 3 therefore ends by writing the
  wiring assertion Task 12 must satisfy, and Task 12's Step 3 names this
  parameter by name. An optional parameter no caller passes tests as done and
  ships inert — the defect class ticket 077 counts five of.
- **Two layers, and the order matters.** The prompt clause shapes what the model
  writes; the mechanical guard is what makes it an invariant. This repo's own
  rule is that invariants are enforced in code and tests, never in prompts, so
  the guard runs on every cut regardless of what the clause achieved.
- Layer 1: for a non-authored region, `propose()` is called with
  `SYSTEM_PROMPT + KEPT_NOT_WRITTEN`, a clause naming that these words were kept
  and not composed, forbidding `avowal`, and directing the reading to describe
  the keeping. `promptOverride` is an existing parameter
  (`harvester.ts:369`); this uses it rather than forking the prompt.
- Layer 2: any cut returning `stance: 'avowal'` from a non-authored region has
  its stance rewritten to `'report-of-fact'` and emits `import-stance-coerced`.
  Rewriting is admissible where dropping is not: a stance is an agent LABEL, not
  the person's words, so changing it violates nothing Sole Authorship guarantees
  — and Q-70 says non-authored regions still harvest, because the kept words are
  evidence of the keeping. Dropping the cut would delete that evidence to protect
  a label.
- Behavioural invariant: **`machine-assisted` is treated as non-authored** for
  both layers. See Open Questions — this is an interpretation of Q-70, flagged
  blocking, with a recommended default.
- Behavioural invariant: the three existing drops (non-substring, Q-51 against
  the raw file, Q-59 dedupe) keep their order and their reasons. The guard runs
  after them, on the cuts that survived, so a coerced stance is never reported
  for a cut nobody will see.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('sends the kept-not-written clause for a region declared other', async () => {
  await runImportExtraction({ ...deps, regionFor: () => otherRegion, complete: spy });
  expect(spy.mock.calls[0]![0]).toContain('kept');
  expect(spy.mock.calls[0]![0]).toContain(SYSTEM_PROMPT);      // an append, not a fork
});

it('sends the unmodified prompt for a region declared authored', async () => {
  await runImportExtraction({ ...deps, regionFor: () => authoredRegion, complete: spy });
  expect(spy.mock.calls[0]![0]).toBe(SYSTEM_PROMPT);
});

it('coerces an avowal the model returned anyway — the prompt is not the gate', async () => {
  const complete = fakeReturning([{ text: EXACT, facet: 'value', stance: 'avowal', reading: 'r' }]);
  await runImportExtraction({ ...deps, regionFor: () => otherRegion, complete });
  expect(store.get(hash)!.cuts![0]!.stance).toBe('report-of-fact');
});

it('leaves an avowal alone in a region declared authored', async () => {
  expect(store.get(hash)!.cuts![0]!.stance).toBe('avowal');
});

it('treats machine-assisted as non-authored', async () => {
  expect(store.get(hash)!.cuts![0]!.stance).not.toBe('avowal');
});

it('leaves a record with no region exactly as it is today', async () => {
  // regionFor undefined entirely — the 19 adopted posts
  expect(spy.mock.calls[0]![0]).toBe(SYSTEM_PROMPT);
});
```

Run: `npx vitest run tests/import-extract.test.ts`
Expected: FAIL, 6 new; the 8 existing pass.

- [ ] **Step 2: Implement**

`import { SYSTEM_PROMPT } from '../harvester/harvester.js'` — it is already
exported at `:92`. Define `KEPT_NOT_WRITTEN` in `src/import/extract.ts`, next to
the code that uses it, because it is import's clause and not the harvester's.

Run: `npx vitest run tests/import-extract.test.ts tests/harvest*.test.ts tests/log-format.test.ts`
Expected: PASS, 14 extract; the harvester suites unchanged, and `git diff
src/harvester/` empty; log-format green.

- [ ] **Step 3: Hand the wiring to Task 12, in writing**

`regionFor` has no production caller yet. Leave a one-line comment at the dep,
naming its injection site — `runImportJobs` in `src/server.ts`, Task 12 Step 3 —
so that a reader of `extract.ts` alone can tell whether the parameter is wired.
Then check it off Task 12's list, not this one: this task is not "done" in the
sense that matters until Task 12 lands, and its own verification cannot show
that.

- [ ] **Step 4: Commit**

```bash
git add src/import/extract.ts tests/import-extract.test.ts
git add -p src/log/format.ts
git commit -m "seeding: a region's declared authorship reaches the stance, twice over"
```

---

### Task 8: Link — prove the dedupe never crosses a source path, and build nothing [TESTS ONLY]

**Orient:** Q-71 rules that a retelling is no new object, so the whole of Link is
one negative rule that `extract.ts` already implements — and the risk this task
removes is a later agent building a link store because nothing on disk says the
rule was decided and met.
**Flow position:** Step 8 of 15 (extract → **verification** → nothing). Upstream:
`extract.ts:110-114`, the `keptElsewhere` set. Downstream: no code.
**Skill:** `characterization-testing`
**Files:**
- Create: `tests/import-link.test.ts`

<contracts>
**The rule under test**, already at `src/import/extract.ts:109-114`:
```ts
for (const r of deps.store.list('accepted')) {
  if (r.sourcePath === record.sourcePath) {
    for (const k of r.kept ?? []) keptElsewhere.add(k);
  }
}
```
- The equality on `sourcePath` **is** Q-71: the same sentence in two files is
  precisely the retelling to keep twice, and dedupe across paths would delete
  the highest-value pattern the system exists to find.
- Q-71's positive half needs no code: a retelling is a cross-sitting pair, which
  the Q-65 ranked channel already surfaces first and the contradiction plane
  already records as diachronic. Two imports of one sentence from two files are
  two sittings on two dates, so the pair is already in the pool.
</contracts>

- [ ] **Step 1: Write the tests**

```ts
it('keeps the same sentence twice when it lives in two files', async () => {
  // The two files holding SHARED_SENTENCE are named in Task 3 Step 2's fixture
  // table; import them from tests/fixtures/seeding-vault/manifest.ts rather
  // than restating which they are.
  await runImportExtraction(deps);            // both admitted, both extracted
  commitImport(deps, hashA, [{ cut: idxA, action: 'approve' }]);
  await runImportExtraction(deps);
  expect(store.get(hashB)!.cuts!.map(c => c.text)).toContain(SHARED_SENTENCE);
});

it('does not re-propose a sentence already kept from the SAME file', async () => {
  // the Q-59 second-sitting path: same sourcePath, changed body
  expect(store.get(hashV2)!.cuts!.map(c => c.text)).not.toContain(KEPT_V1);
});

it('the two kept copies are two sittings on two dates', () => {
  expect(sitting(a).started).not.toBe(sitting(b).started);
});

it('there is no link store', () => {
  expect(existsSync(join(vaultRoot, 'links'))).toBe(false);
  expect(readdirSync('src/import')).not.toContain('link.ts');
});
```

Run: `npx vitest run tests/import-link.test.ts`
Expected: PASS, 4 tests, with **no source change**. If any fails, the rule is not
what this task claims and the failure is the finding — report it and stop rather
than editing `extract.ts` to match the test.

- [ ] **Step 2: Commit**

```bash
git add tests/import-link.test.ts
git commit -m "seeding: Link is the dedupe boundary, and it already holds"
```

---

## Wave 3 — the corpus boundary and the live mechanisms

> **Gate:** 058's T6 (docket wiring), T7 (`src/import/commit.ts`) and T9 (the four
> routes) must be committed before this wave starts. Verify with
> `test -f src/import/commit.ts && grep -c "api/import" src/server.ts` — expect
> the file to exist and at least four route matches.
>
> **058's execution log is stale about T7's scope; confirm with its owner.** That
> log says the 048 `channel` seam "has not landed", so T7 must add it. Verified
> 2026-08-02: `channelOf?: (proposal: CutProposal) => CaptureChannel | undefined`
> is present at `src/harvester/harvester.ts:629` and used at `:636`. T7's first
> branch therefore applies — use the seam, add no second parameter — and T7 does
> not touch `src/harvester/harvester.ts` at all. That changes what T7 leaves
> behind for Task 9 to build on, so check it before assuming this wave's
> upstream.

### Task 9: Authorship reaches the snippet, and the invariant is read off disk [MODIFY]

**Orient:** Every earlier task about authorship is a signature until a snippet in
the vault carries the declaration, and the one failure this whole thread exists to
prevent — a clipped sentence filed as the person's avowal — is only provably
absent when it is asserted against files on disk.
**Flow position:** Step 9 of 15 (region → extract → review → **commit** → vault).
Upstream: `ImportDecision[]` and the region record. Downstream: `Snippet.provenance`.
**Skill:** `tdd`
**Files:**
- Modify: `src/import/commit.ts` (058 T7)
- Modify: `tests/import-commit.test.ts` (058 T7)

<contracts>
**Downstream (commit → vault):** the provenance 058 T7 already builds, plus one
conditionally-spread field:
```ts
{ kind: 'unprompted', session, question: '', questionForm: 'deliberative',
  channel: 'pasted',
  ...(region ? { authorship: region.authorship } : {}),
  ...(context !== undefined ? { context } : {}) }
```
- Behavioural invariant: **conditionally spread, never `authorship: undefined`.**
  A present key holding `undefined` throws in `matter.stringify` and loses the
  whole snippet write, not just the field — verified in 048 and recorded at
  `src/import/store.ts:72-74`.
- Behavioural invariant: a record with no region writes no `authorship`. The 19
  adopted posts stay exactly as they are; absent means never asked, and nothing
  backfills.
- Behavioural invariant: commit's all-or-nothing rule is untouched. Authorship is
  a stamp, never a gate — it cannot refuse an item. Q-51's item-level exclusion
  is the refusal, and it lives on the review surface where it already is.
- **This task WIDENS `commitImport`'s deps and does not wire them.** 058 T7's
  signature is `commitImport(deps: { vault; store; readSource; log }, hash,
  decisions)` — there is no `regionFor` and no route in this plan called it. So
  this task adds `regionFor?: (sourcePath: string) => RegionRecord | null` to
  that deps type, and **Task 12, Step 3 passes it from
  `POST /api/import/:hash/decisions`**. Without that step every imported snippet
  ships with no `authorship` key and Tasks 1, 2, 7 and 13 amount to a form the
  vault never hears about. Name the caller in the commit message.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('stamps the region authorship on every snippet of the sitting', () => {
  commitImport({ ...deps, regionFor: () => otherRegion }, hash, [{ cut: 0, action: 'approve' }]);
  for (const s of snippetsOnDisk(root)) expect(s.provenance.authorship).toBe('other');
});

it('writes no authorship key at all for an item with no region', () => {
  for (const s of snippetsOnDisk(root)) expect('authorship' in s.provenance).toBe(false);
});

it('no snippet from a non-authored region carries stance avowal — read off disk', () => {
  for (const r of readingsOnDisk(root)) {
    const cited = snippetFor(r);
    if (cited.provenance.authorship && cited.provenance.authorship !== 'authored') {
      expect(r.stance).not.toBe('avowal');
    }
  }
});

it('still writes channel pasted and the 073 context window', () => { /* 058's assertions, unchanged */ });
```

Run: `npx vitest run tests/import-commit.test.ts`
Expected: FAIL, 3 new; 058's existing commit tests pass.

- [ ] **Step 2: Implement, then read it back**

One conditional spread and one injected `regionFor` added to 058 T7's deps type.
The third test is the invariant and it must read the vault, not the return
value — a function that returns the right object and writes the wrong file is the
failure mode this assertion exists for.

The tests above inject `regionFor` directly, so they pass whether or not the
route does. **That gap closes in Task 12 and nowhere else**; do not read a green
suite here as evidence that a real import stamps anything.

Run: `npx vitest run tests/import-commit.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/import/commit.ts tests/import-commit.test.ts
git commit -m "seeding: declared authorship reaches the snippet, asserted on disk"
```

---

### Task 10: Repair — one Bud, one capped question, and no surface at all [NEW FILE]

**Orient:** Of 139 imported snippets, 96 dangle and 25 resolve from nothing, and
the wrong answer to that is a screen listing 400 outstanding repairs — debt
rendered as a list, which Q-24 forbids — so each unresolvable dangler becomes one
Bud and one ordinary Queue question under a live cap, and there is no repair
surface to build.
**Flow position:** Step 10 of 15 (commit → **repair** → Queue → an ordinary
sitting). Upstream: the snippets a clean commit just wrote. Downstream:
`vault/buds/` and the Queue.
**Skill:** `tdd`
**Files:**
- Create: `src/import/repair.ts`
- Create: `tests/import-repair.test.ts`
- Modify: `src/wiki/thresholds.ts` — `THRESHOLDS` opens at `:65`
- Modify: `src/log/format.ts` (`repair-budded`, `repair-question-capped`) — stage hunk-by-hunk
- Modify: `src/registry.ts`

**Not `src/server.ts`.** Every route edit in this wave lives in Task 12, so that
two tasks in one wave never queue on one file. Task 12 Step 3 calls
`runImportRepair`; this task's Step 3 writes the assertion Task 12 must satisfy.

<contracts>
**Upstream (commit → repair):**
```ts
export function runImportRepair(deps: {
  vault: Vault; queue: QueueStore; vaultRoot: string; log: LogFn;
  snippets: Snippet[];            // what this commit just wrote
  cap?: number;                   // default: THRESHOLDS['repair.liveCap']
}): { budded: number; questioned: number; deferred: number };
```
**The cap bounds the QUESTION, never the Bud.** Q-72 mints one Bud per
unresolvable dangler *and* rate-limits what reaches the person; those are two
different bounds and collapsing them loses material permanently. Concretely:

1. **Every** dangler found in `snippets` becomes a Bud. No cap, no exception. A
   Bud is a held fragment with its failures recorded (Q-6) — it costs the person
   nothing, surfaces nowhere, and accuses no one, so there is nothing to
   rate-limit.
2. **Then** the Queue question is minted, oldest dangler first, until
   `repair.liveCap` live `'import-repair'` entries exist. The rest are
   `deferred`, not dropped.
3. The ledger records every dangler **SEEN**, with whether its question was
   minted: `{ at, snippetId, budId, questioned: boolean }`. A later run reads the
   ledger first, mints questions for unquestioned danglers before touching this
   commit's new ones, and re-Buds nothing.

Without (3), a dangler clipped by the cap is invisible forever, because
`runImportRepair` only ever sees the snippets of the commit that called it — the
one thing that makes the ledger load-bearing rather than bookkeeping.
**Downstream (repair → Bud and Queue):**
- `vault.saveBud(prose, ['dangling-referent'], session)` — Q-6's shape exactly:
  a verbatim fragment held with its failures recorded, never edited into shape.
- One `QueueDraft`, with every **required** field of `QueueEntry`
  (`src/types.ts:274-276` — `license`, `question` and `questionForm` are not
  optional):
```ts
{ source: 'import-repair', license: 'CC0', question: <template>,
  questionForm: 'deliberative', cites: [`${s.id}@${s.version}`],
  quotedFragment: s.prose, sharpness: 'sharp', horizon: 'now' }
```
  `license: 'CC0'` matches every existing minting path (`buildOpenerDraft`,
  `src/clerk/composed.ts:214-233`); this plan introduces no new licence and the
  field is not a place to invent one. **No `target` key** — imported material
  carries no Target (Q-60), so a question about it must not claim one.
- `question` is composed **by template, with no model call**: the snippet quoted
  verbatim and one fixed sentence naming the anaphor. A model call here would buy
  phrasing and cost a second failure mode on a path that runs after every commit.
- Behavioural invariant: **the detector under-detects on purpose.** It fires when
  the prose opens with a word from a closed anaphor lexicon (`this that these
  those it they he she him her them such there`) AND `provenance.context` is
  absent. The mechanical context window (073) is what resolves the other 71 of
  96, so a dangler with a window is not unresolvable. This set is smaller than
  074's labelled 25 and that is the safe direction: a missed dangler costs
  nothing, because a Bud waits without accusing anyone (Q-6), while a wrong
  repair question spends the person's attention on a referent that was never
  unclear.
- Behavioural invariant: **capped and live (Q-56), and the cap is new.** Q-72
  says repairs ride "the Queue's existing caps", but there is no existing
  per-source cap to ride: `draw` bounds what a *sitting* shows, not what a
  *minting path* writes, and the only per-source cap in the tree is
  `remeasure.liveCap` (`src/clerk/wiki-jobs.ts:990-1008`), which counts
  `'contradiction-remeasure'` alone. So `repair.liveCap` = 2 is a new threshold
  in the same shape, and the divergence from Q-72's wording is deliberate and
  named here rather than discovered later. Q-56 governs it: a bound ships live at
  birth, because a shadowed cap is not a cap. Over the cap, emit
  `repair-question-capped` naming how many were deferred.
- Behavioural invariant: **idempotent by ledger, and the ledger records danglers
  SEEN.** Every dangler found is appended to
  `vault/imports/repair-ledger.jsonl` — one JSON line, the `appendSweepDeferral`
  shape (`src/wiki/store.ts:612`) — carrying `questioned: true | false`. A re-run
  over the same snippets Buds nothing and re-mints nothing, and a run with room
  under the cap picks up the deferred ones first. A ledger of only what was
  *budded and questioned* would make a deferred dangler unfindable, which is
  precisely the loss the cap must not cause.
- Behavioural invariant: **no route, no screen, no list.** `runImportRepair` is
  called from the decisions route after a successful commit and from nowhere
  else. If a later reader wants to see outstanding repairs, the Queue is where
  they are, one at a time, in an ordinary sitting.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('buds a snippet that opens with an anaphor and has no context window', () => {
  const r = runImportRepair({ ...deps, snippets: [{ ...s, prose: 'This is what made the whole thing work.' }] });
  expect(r.budded).toBe(1);
  expect(budsOnDisk(root)[0]!.failures).toEqual(['dangling-referent']);
});

it('leaves a dangler alone when the 073 context window is there to resolve it', () => {
  const s = { ...danglingSnippet, provenance: { ...p, context: 'We rebuilt the importer that week.' } };
  expect(runImportRepair({ ...deps, snippets: [s] }).budded).toBe(0);
});

it('mints one queue question that quotes the snippet and claims no Target', () => {
  const e = queue.list({ source: 'import-repair' })[0]!;
  expect(e.quotedFragment).toBe(danglingSnippet.prose);
  expect('target' in e).toBe(false);
  expect(e.cites).toEqual([`${danglingSnippet.id}@1`]);
});

it('cannot make a model call — the module imports no LLM path', () => {
  const src = readFileSync('src/import/repair.ts', 'utf-8');
  expect(src).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
});

it('BUDS every dangler over the cap, and defers only the questions', () => {
  seedQueue(2, 'import-repair');                      // cap already full
  const r = runImportRepair({ ...deps, snippets: [d1, d2, d3] });
  expect(r.budded).toBe(3);                           // ← not 0. Q-72 wants the Buds.
  expect(r.questioned).toBe(0);
  expect(r.deferred).toBe(3);
  expect(budsOnDisk(root)).toHaveLength(3);
  expect(logged('repair-question-capped')).toHaveLength(1);
});

it('mints the deferred questions on a later run when the cap frees up', () => {
  seedQueue(2, 'import-repair');
  runImportRepair({ ...deps, snippets: [d1, d2, d3] });
  answerAll(queue, 'import-repair');                  // the two live entries close
  const later = runImportRepair({ ...deps, snippets: [] });   // NO new snippets
  expect(later.questioned).toBe(2);
  expect(later.budded).toBe(0);                       // already budded, never twice
});

it('mints nothing twice for the same snippet, across a restart', () => {
  runImportRepair(deps);
  const again = runImportRepair({ ...deps, queue: freshQueue, vault: freshVault });
  expect(again.budded).toBe(0);
  expect(again.questioned).toBe(0);
});
```

Run: `npx vitest run tests/import-repair.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement, and register the threshold**

Add to `src/wiki/thresholds.ts`, in the file's own shape:

```ts
'repair.liveCap': {
  name: 'repair.liveCap', value: 2, live: true,
  graduatesWhen: 'LIVE at birth under Q-56 — a shadowed cap is not a cap. Re-tune when a real vault import records how many repair questions a person answers per week versus how many were minted.',
},
```

- [ ] **Step 3: Hand the wiring to Task 12, and declare the export**

`runImportRepair` has no caller in this task by design — every `src/server.ts`
edit in this wave belongs to Task 12, so two tasks never contend on one file.
**Task 12 Step 3** calls it from `POST /api/import/:hash/decisions`, after a
`{ ok: true }` commit and never before: a repair minted for an item that refused
to commit is a question about prose that is not in the corpus.

Declare `src/import/repair:runImportRepair` in `src/registry.ts` with status
`unwired`, and let Task 12 flip it to `live`. The registry entry is the honest
record of this task's state.

Run: `npx vitest run tests/import-repair.test.ts tests/wiki-thresholds.test.ts tests/mechanism-registry.test.ts tests/log-format.test.ts`
Expected: PASS, 7 repair tests; threshold, registry and log-format suites green.

- [ ] **Step 4: Commit**

```bash
git add src/import/repair.ts tests/import-repair.test.ts src/wiki/thresholds.ts src/registry.ts
git add -p src/log/format.ts
git commit -m "seeding: every dangler buds; only the question is capped"
```

---

### Task 11: Reach — the licence, computed from names the person chose [NEW FILE]

**Orient:** Canon says a region is harvested when a Direction reaches toward it,
and this task decides mechanically whether that has happened — using the words of
the questions actually waiting and the names the person gave their own folders,
so that Elicit never reads an unharvested note to decide whether to ask about it.
**Flow position:** Step 11 of 15 (survey + queue → **reach** → the waiting
surface). Upstream: `readSurvey` and `queue.list({status:'pending'})`.
Downstream: one offer, or null.
**Skill:** `tdd`
**Codebook gap:** offer-licensing-vs-inertness — no codebook covers "ship a
licence whose input may be empty".
**Files:**
- Create: `src/import/reach.ts`
- Create: `tests/import-reach.test.ts`
- Modify: `src/wiki/thresholds.ts` — `THRESHOLDS` opens at `:65`
- Modify: `src/log/format.ts` (`reach-evaluated`, `reach-offered`, `reach-declined`) — stage hunk-by-hunk
- Modify: `src/registry.ts`

**Runs after Task 10, not beside it.** Both tasks touch `src/wiki/thresholds.ts`,
`src/log/format.ts` and `src/registry.ts`; `format.ts` already carries foreign
unstaged hunks (standing rule 7), which makes a concurrent second editor the
worst case rather than a merge inconvenience.

<contracts>
```ts
export type ReachOffer = { path: string; unread: number; terms: string[] };
export function termsOf(text: string): Set<string>;
export function reachOffer(deps: {
  survey: Survey | null;
  liveTerms: () => Set<string>;
  declined: (path: string) => string | null;   // ISO of the last decline, or null
  log: LogFn;
  minOverlap?: number;
}): ReachOffer | null;
export function appendReachDecline(vaultRoot: string, path: string): void;
export function reachDeclines(vaultRoot: string): Map<string, string>;
```
- **`liveTerms` is the Direction, and the honest name for what it reads.**
  Verified 2026-08-02: `QueueEntry.direction` is persisted by
  `src/queue/queue.ts:207` and **written by nothing** — 0 of 17 live entries
  carry one; `topic` is the same, written by nothing, 0 of 24 transcripts. A
  licence reading `direction` would ship inert on day one, which is the exact
  failure Q-69 names. So `liveTerms` reads the **text of the pending Queue's
  questions**, which is populated (17 entries, all `source: 'composed'`) and is
  the closest running thing this codebase has to a line of inquiry. The
  parameter is injected so that when Directions become real, the swap is one
  call site and no change here.
- `termsOf`: lowercase, split on non-letters and camelCase boundaries, drop
  terms under 4 characters and a small closed stopword list, dedupe. The same
  function normalises both sides, so a comparison is never between two different
  notions of a word.
- A region node's terms come from its **path segments and the basenames of its
  direct files** — never from file contents. Elicit does not read an unharvested
  note to decide whether to ask about it, and Q-68 already grounds this: the
  folder names are the person's own organisation.
- Licence: `overlap ≥ reach.nameOverlapMinTerms` (2), among nodes with
  `unread > 0`. Rank by overlap descending, then by least-recently-declined,
  then by `unread` descending. **Return exactly one.** A list of every
  unharvested region is a menu, and a menu of debt is what Q-24 forbids.
- **Ships LIVE (Q-62)** and logs every evaluation: one `reach-evaluated` per run
  carrying `nodes=`, `candidates=`, `best=`, whether it offered, and the winning
  overlap. Q-62's licence to ship live is conditional on that record existing.
- Behavioural invariant: `survey === null` (never surveyed) or no pending queue
  entries ⟹ null, and one `reach-evaluated` saying so. Silence with a record is
  the difference between "nothing reached" and "the mechanism is broken".
- Behavioural invariant: a decline **reorders, never suppresses.** Q-22 makes an
  ignored offer recorded signal that is never escalated; a suppression window
  would need its own threshold, its own expiry and its own bug. Declining costs a
  word and the region falls behind every region not declined more recently.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('offers the unread region whose own names the live questions touch', () => {
  const o = reachOffer({ survey, liveTerms: () => termsOf('what changed about how you run therapy sessions'),
                         declined: () => null, log });
  expect(o!.path).toBe('journal/therapy');
});

it('offers nothing when overlap is one term', () => {
  expect(reachOffer({ survey, liveTerms: () => termsOf('therapy'), declined: () => null, log })).toBeNull();
});

it('never offers a node with nothing unread', () => {
  // journal/therapy fully harvested in the survey
  expect(reachOffer({ ... })).toBeNull();
});

it('logs an evaluation even when it offers nothing', () => {
  reachOffer({ survey: null, liveTerms: () => new Set(), declined: () => null, log });
  expect(logged('reach-evaluated')).toHaveLength(1);
});

it('ranks a declined region behind an equal one that was not', () => {
  expect(reachOffer({ survey, liveTerms: bothMatch, declined: p => p === 'journal/therapy' ? YESTERDAY : null, log })!.path)
    .toBe('journal/work');
});

it('still offers a declined region when it is the only match', () => {
  expect(reachOffer({ ...onlyDeclinedMatches })!.path).toBe('journal/therapy');
});

it('cannot read a note — the module imports no prose reader', () => {
  // A vi.spyOn(fs, …) assertion would be unfalsifiable twice over: reachOffer is
  // handed its values, and vitest cannot intercept an ESM named import the
  // module already bound. `node:fs` alone is the wrong thing to forbid — the
  // decline ledger writes with it. What must be absent is the ability to read a
  // note's PROSE: gray-matter and scan.ts's body path.
  const src = readFileSync('src/import/reach.ts', 'utf-8');
  expect(src).not.toMatch(/gray-matter|from '\.\/scan/);
});

it('offers a region whose files it has never opened', () => {
  // The behavioural half: a node whose files are unreadable still gets offered,
  // because only the survey's counts and the node's own path are consulted.
  // Weak on its own — chmod 000 is a no-op for root, and CI may run as root —
  // so the source-level check above carries the guarantee and this one
  // demonstrates it. Restore in `finally` or every later test in the file
  // inherits an unreadable fixture.
  const f = join(FIXTURE, 'journal/therapy/a.md');
  chmodSync(f, 0o000);
  try {
    expect(reachOffer({ survey, liveTerms: therapyTerms, declined: () => null, log })!.path)
      .toBe('journal/therapy');
  } finally {
    chmodSync(f, 0o644);
  }
});
```

Run: `npx vitest run tests/import-reach.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement, register the threshold, and declare four exports**

`src/registry.ts` gains four entries, and **their statuses differ**:

- `src/import/reach:termsOf` → **`live`**. `reachOffer` calls it in-module, and
  `callerEvidence` (`tests/mechanism-registry.test.ts:239-265`) counts that.
- `src/import/reach:reachOffer`, `:appendReachDecline`, `:reachDeclines` →
  **`unwired`**. Nothing constructs or calls these until Task 12's `/api/reach`
  and `/api/reach/decline` routes, which is the honest state and the reason
  Task 12 Step 3 flips them.

```ts
'reach.nameOverlapMinTerms': {
  name: 'reach.nameOverlapMinTerms', value: 2, live: true,
  graduatesWhen: 'LIVE at birth under Q-62 — the mechanism only OFFERS, nothing happens on silence, and every evaluation is logged. Re-tune from the reach-evaluated record once a real vault shows how often two-term overlap names a region the person actually wanted.',
},
```

Run: `npx vitest run tests/import-reach.test.ts tests/wiki-thresholds.test.ts tests/log-format.test.ts`
Expected: PASS, 8 reach; the threshold register test green; log-format green.

- [ ] **Step 3: Commit**

```bash
git add src/import/reach.ts tests/import-reach.test.ts src/wiki/thresholds.ts src/registry.ts
git add -p src/log/format.ts
git commit -m "seeding: reach offers one region, licensed by names and by what is being asked"
```

---

### Task 12: The wiring task — four routes, and the three seams that are otherwise inert [MODIFY]

**Orient:** Six earlier tasks added a parameter nothing passes, and this is the
task that passes them — without it the region never reaches extraction, the
authorship never reaches a snippet, the repair never runs and the bounded queue
is never asked for, so five waves of work would land as signatures and ship
inert, the defect ticket 077 counts five of.
**Flow position:** Step 12 of 15 (region + survey + reach + repair → **routes and
injection sites** → the two surfaces). Upstream: every module built in Waves 0–3.
Downstream: `web/survey-map.ts` (T13) and `renderWaiting` (T14).
**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` — **the only task in Wave 3 that touches this file.**
  Four new routes beside 058's four; the `?region=` parameter on 058's
  `GET /api/import/next`; and the three injection sites in Step 3.
- Create: `tests/seeding-routes.test.ts`

<contracts>
| Route | Body | Answer |
|---|---|---|
| `GET /api/import/survey?folder=…` | — | `{ survey: Survey }`; runs the walk, writes the snapshot |
| `POST /api/import/region` | `{ root, dating, authorship }` | `{ slug }`; **400** on an uncompilable pattern or an unrecognised authorship |
| `GET /api/reach` | — | `{ offer: ReachOffer \| null }` |
| `POST /api/reach/decline` | `{ path }` | `{ ok: true }` |

- Behavioural invariant: **`POST /api/import/region` is the only writer of a
  region record, and it validates before it writes.** `compilePattern` returning
  null ⟹ 400 and nothing on disk. An authorship outside the three values ⟹ 400,
  with no server-side default — a default is a silent assertion about who wrote
  the person's notes.
- Behavioural invariant: **no route in this task writes corpus.** Survey reads,
  region declares, reach offers, decline records. The only path into the vault
  stays 058's decisions route.
- Behavioural invariant: `GET /api/reach` is read-only and cheap — it reads the
  survey snapshot and the queue, never the folder. A route that re-walks 5,000
  files on every waiting-surface render is a route the person will feel.
- Behavioural invariant: all four sit behind the same auth as every other route
  (Q-25), and the folder path is read from the request off local disk by design
  — that is the door Q-57 chose.
- Behavioural invariant: **the scan route (058 T9) passes the region through.**
  `POST /api/import/scan` gains an optional `region` slug: when present, it looks
  up the record, passes `record.dating` to `scanFolder` and `record.slug` to
  `admit`. When absent it behaves exactly as 058 built it. This is the single
  wiring that makes Anchor real; without it T3 is a signature.
- Behavioural invariant: **`GET /api/import/next` gains `?region=<slug>`.** 058
  T9 builds that route with no query parameter, and §2's flow map is explicit
  that `web/import-review.ts` is otherwise unchanged — so without this, Task 6's
  `nextExtracted(region)` has no caller and Q-68's bounded queue exists in the
  store and nowhere else. When the parameter is absent the route behaves exactly
  as 058 built it, which keeps the 19 adopted region-less posts reachable.
  **Task 13, Step 4 is what makes the surface send it.**
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a dating pattern that cannot produce a day, and writes nothing', async () => {
  const r = await postRaw('/api/import/region', { root: F, dating: { kind: 'filename', pattern: 'YYYY-MM' }, authorship: 'authored' });
  expect(r.status).toBe(400);
  expect(existsSync(join(root, 'imports', 'regions'))).toBe(false);
});

it('refuses an authorship outside the three values', async () => {
  expect((await postRaw('/api/import/region', { root: F, dating: D, authorship: 'own' })).status).toBe(400);
});

it('scan uses the region dating rule and stamps the region', async () => {
  const { slug } = await post('/api/import/region', { root: FIXTURE, dating: { kind: 'filename', pattern: 'YYYY-MM-DD' }, authorship: 'other' });
  const r = await post('/api/import/scan', { folder: FIXTURE, region: slug });
  expect(r.pending).toBeGreaterThan(0);
  expect(r.refused).toContainEqual({ file: 'ideas.md', reason: 'no-date-in-name' });
  expect(store.list('pending', slug)).toHaveLength(r.pending);
});

it('survey writes the snapshot and reach reads it', async () => {
  await get('/api/import/survey?folder=' + encodeURIComponent(F));
  expect(readSurvey(root)).not.toBeNull();
  expect((await get('/api/reach')).offer).toBeDefined();
});

it('reach answers null before any survey, and logs the evaluation', async () => {
  expect((await get('/api/reach')).offer).toBeNull();
  expect(activityKinds()).toContain('reach-evaluated');
});

it('there is no route that harvests a region without a declaration', () => {
  expect(routePaths(app)).not.toContain('/api/import/harvest-region');
});
```

- [ ] **Step 2: Implement the four routes and the query parameter**

Run: `npx vitest run tests/seeding-routes.test.ts tests/import-routes.test.ts`
Expected: PASS, 6 new; 058's 6 route tests unchanged.

- [ ] **Step 3: Pass the three parameters nothing passes yet**

Each of these is one argument at one call site, and each is the difference
between a built mechanism and an inert one. Write the assertion first in every
case — the assertion, not the argument, is what makes this wiring rather than a
signature.

| Seam | Injection site | Declared by | Assertion |
|---|---|---|---|
| `regionFor` → extraction | `runImportJobs`'s `ExtractionDeps` construction inside `runDocketNow`, `src/server.ts` (058 T6) | Task 7 | after a scan + docket run over an `other` region, read a record off disk and expect no cut with `stance: 'avowal'` |
| `regionFor` → commit | the `commitImport` deps literal in `POST /api/import/:hash/decisions` (058 T9) | Task 9 | after a full route-level import of that region, read a **snippet file** and expect `provenance.authorship === 'other'` |
| `runImportRepair` | the same decisions handler, after `{ ok: true }` and never before | Task 10 | after committing an item holding a dangler, expect one file in `vault/buds/` and one `'import-repair'` queue entry |

```ts
it('a real import through the routes stamps authorship on disk', async () => {
  await post('/api/import/region', { root: F, dating: D, authorship: 'other' });
  await post('/api/import/scan', { folder: F, region: slug });
  await runDocketNow();                                   // extraction, via the docket
  const { item } = await get(`/api/import/next?region=${slug}`);
  await post(`/api/import/${item.hash}/decisions`, { decisions: [{ cut: 0, action: 'approve' }] });
  expect(snippetsOnDisk(root)[0]!.provenance.authorship).toBe('other');   // ← the whole thread
});

it('the bounded queue is what the route hands back', async () => {
  // 058 T9's payload is { item: { hash, file, title, date, source, cuts, marks },
  // remaining } — there is no `region` field on it and this plan adds none, so
  // assert on the hash and the count, which the payload does carry.
  expect((await get(`/api/import/next?region=${slugA}`)).item.hash).toBe(hashInA);
  expect((await get(`/api/import/next?region=${slugA}`)).remaining).toBe(countInA);
  expect((await get(`/api/import/next?region=${slugB}`)).item.hash).toBe(hashInB);
});

it('a committed dangler leaves a Bud and a queue question', async () => {
  expect(budsOnDisk(root)).toHaveLength(1);
  expect(queue.list({ source: 'import-repair' })).toHaveLength(1);
});
```

Then flip to `live` **exactly these eight `unwired` entries** — the ones whose
first and only caller is a route in this task. Nothing else changes status; the
`dating`, `scan:walkMarkdown`, `region:slugFor` and `reach:termsOf` entries were
`live` at birth because their own modules call them, and re-flipping a `live`
entry is a no-op that hides which mechanism this task actually rescued.

```
src/import/region:createRegionStore     ← POST /api/import/region
src/import/survey:surveyFolder          ← GET  /api/import/survey
src/import/survey:writeSurvey           ← GET  /api/import/survey
src/import/survey:readSurvey            ← GET  /api/reach
src/import/reach:reachOffer             ← GET  /api/reach
src/import/reach:reachDeclines          ← GET  /api/reach
src/import/reach:appendReachDecline     ← POST /api/reach/decline
src/import/repair:runImportRepair       ← POST /api/import/:hash/decisions
```

`tests/mechanism-registry.test.ts` accepts a `live` status only once a caller
exists outside the mechanism's own tests (`:303-306` is the inverse check), so
this flip is not bookkeeping — it is the suite confirming the wiring landed.

Run: `npx vitest run tests/seeding-routes.test.ts tests/mechanism-registry.test.ts`
Expected: PASS — 9 route tests; registry green with the eight entries above now
`live` and no entry left `unwired` in `src/import/`.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/registry.ts tests/seeding-routes.test.ts
git commit -m "seeding: the routes, and the three seams that were signatures until now"
```

---

## Wave 4 — the two surfaces

> **Gate:** 058's T10 (`web/import-review.ts`) and T11 (`web/import-entry.ts`)
> must be committed. Verify: `test -f web/import-entry.ts`.

### Task 13: The map, and the two things a region declares [NEW FILE]

**Orient:** This is where a person sees their own vault as a shape rather than a
number, picks the part of it they want to give, and says the two things Elicit
cannot infer — how these files carry their dates, and who wrote them.
**Flow position:** Step 13 of 15 (routes → **map + declaration** → 058's scan and
review). Upstream: `GET /api/import/survey`. Downstream: `POST /api/import/region`
then 058's `POST /api/import/scan`.
**Skill:** `interface-design:interface-design`
**Files:**
- Create: `web/survey-map.ts`
- Create: `tests/survey-map.test.ts`
- Modify: `web/import-entry.ts` — one line
- Modify: `web/import-review.ts` (058 T10) — one line, Step 4: send the region
  slug to `GET /api/import/next`
- Modify: `web/style.css` — **runs before Task 14, which touches the same file**

**No `src/registry.ts` entry, and this is a deliberate reading of blocking
finding 7.** Verified: `tests/mechanism-registry.test.ts` sweeps `src` and `web`
for *call sites* (`SWEEP_DIRS`, `:59`), but `enumerateMechanisms` skips any file
whose path does not start with `src/` (`:100-104`), so a `web/` export is never
enumerated and never demanded. `grep -n "web/" src/registry.ts` returns one
comment line and zero entries, which is consistent. `renderSurveyMap` therefore
needs no entry, and adding the first-ever `web/` entry inside this task would be
a registry-convention change smuggled into a folder-tree task.

<contracts>
```ts
renderSurveyMap(deps: {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string,string>, ...kids: (string|Node)[]) => HTMLElementTagNameMap[K];
  api: <T>(path: string, body?: unknown) => Promise<T>;
  /**
   * Widened by one optional argument from 058 T10's `(screen: string) => void`.
   * Task 14's offer line is the caller that needs it, and **Task 14 owns the
   * matching edit to the real function**, `function navTo(screen: Screen)` at
   * `web/main.ts:187`. Both ends of this contract edge are named so they cannot
   * drift apart.
   *
   * `string` here and `Screen` there is deliberate, not a mismatch: `Screen`
   * (`web/main.ts:148`) is module-private, and 058 T10 already crosses this
   * boundary the same way for the same reason. The injected dep widens the
   * type; the real function must not.
   */
  navTo: (screen: string, opts?: { focus?: string }) => void;
  folder: string;
  /**
   * A node path to open the map at, scrolled to and expanded. This is where
   * Task 14's offer line lands: `reach it` navigates here naming the region it
   * offered, and without this parameter that word has nowhere to go — the
   * person would arrive at a collapsed tree and have to find the folder Elicit
   * had just named for them.
   */
  focus?: string;
}): void
```
Injection rather than import, for the reason 058 T10 gives: `el`, `api` and
`navTo` are module-private in `main.ts` and that file is contended.
</contracts>

- [ ] **Step 1: The map, as text**

One line per node, indented by depth, in the interface's register:

```
journal                                    412 notes · 38 in · 374 unread
  2019                                      94 notes · 38 in · 56 unread
  2021                                     318 notes ·  0 in · 318 unread
clippings                                   87 notes ·  0 in · 84 unread · 3 refused
```

Collapsed to depth 2 by default, showing `total`; expanding a node shows its
direct counts and its children. Two rules the tree must not break: a node with
nothing unread is dimmed rather than hidden — "already in" is the information the
map exists to carry, and hiding it makes the map lie by omission — and the tree
never renders a per-file list, because a list of 5,000 files is the shape Q-24
refuses.

- [ ] **Step 2: The declaration, at the point of attention**

Choosing a node opens two questions inline, beneath that line, nothing modal:

- *"how are these dated?"* — `frontmatter: <key>` or `filename: <pattern>`, with
  the pattern field pre-filled `YYYY-MM-DD` and one live line of feedback naming
  how many files in that node the pattern matches and how many it does not. The
  feedback is the honest part: a person choosing a rule that refuses 90% of the
  folder should see that before they choose it, not as a refusal list afterwards.
- *"who wrote these?"* — `I did` / `someone else` / `written with a model`, no
  preselection. `save` stays disabled until both are answered, because a default
  here is a silent assertion about the person.

One sentence under the authorship choice, shown for the two non-authored values:
*"kept words are evidence of keeping them — these will not be filed as things you
avow."* The person should learn the consequence at the moment they declare it,
not from a wiki claim six weeks later.

- [ ] **Step 3: Prove the structural claims**

**Before writing a line of this step, check the DOM harness.** Verified
2026-08-02: this repo has **no DOM test environment** — no `jsdom`, no
`happy-dom`, no `environment` key in the vitest config, and not one existing test
touches `document`. 058's T10 assumes one ("the DOM built by the same helpers, no
browser needed") and must introduce it. So:

- If 058 T10 landed a DOM environment, use it and write the tests below.
- If it did not, **do not add a dependency inside this task.** Restructure
  `renderSurveyMap` so the tree and the enablement rule are computed by pure
  functions — `mapLines(survey): string[]` and `canSave(declaration): boolean` —
  test those directly, and move the remaining claims (three choices, none
  preselected, no per-file list) into Step 4's by-use run as things the executor
  reads on screen and records. A pure-function seam is the better shape anyway;
  it is only being forced here rather than chosen.

```ts
it('renders a node per folder that holds markdown', () => { ... });
it('shows a fully-harvested node dimmed rather than hiding it', () => {
  expect(surface.querySelector('[data-path="journal/2019"].node-done')).not.toBeNull();
});
it('renders no per-file list at any depth', () => {
  expect(surface.querySelectorAll('.survey-file')).toHaveLength(0);
});
it('keeps save disabled until both declarations are answered', () => { ... });
it('offers exactly three authorship choices, none preselected', () => {
  expect(labels(surface)).toEqual(['I did', 'someone else', 'written with a model']);
  expect(surface.querySelector('[aria-checked="true"]')).toBeNull();
});
it('posts the region, then scans it with that slug', async () => {
  expect(sent.map(s => s.path)).toEqual(['/api/import/region', '/api/import/scan']);
  expect(sent[1]!.body).toMatchObject({ region: SLUG });
});
```

Run: `npx vitest run tests/survey-map.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Hand the region to the review, or Q-68's bound reaches nobody**

Task 6 built `nextExtracted(region)` and Task 12 exposed `?region=<slug>`, and
the piece that makes them mean anything is one line here: `web/import-review.ts`
(058 T10) must append the slug when it asks for the next item. §2's flow map says
the review surface is otherwise unchanged, and that is still true — this is the
one line, and it changes no control, no verb and no layout.

Carry the slug from the declaration through `navTo`, so the review opened from a
region stays inside it. When no slug is carried — the 19 adopted posts, or a
plain folder scan — omit the parameter and the route behaves as 058 built it.

```ts
it('asks for the next item inside the region it was opened with', async () => {
  expect(sent.find(s => s.path.startsWith('/api/import/next'))!.path)
    .toBe(`/api/import/next?region=${SLUG}`);
});

it('omits the parameter when opened without a region', async () => {
  expect(sent.find(s => s.path.startsWith('/api/import/next'))!.path)
    .toBe('/api/import/next');
});
```

Run: `npx vitest run tests/survey-map.test.ts`
Expected: PASS, 8 tests — the 6 from Step 3 plus these 2. If the DOM harness is
absent (Step 3's note), these two move into `renderImportReview`'s own request
builder as a pure function and are tested there.

- [ ] **Step 5: Wire the entry, and verify by use**

`web/import-entry.ts` calls `renderSurveyMap` after the folder prompt — one line,
additive, no existing function reshaped.

Run: `npm run build && ELICIT_LLM=fake npx tsx src/server.ts`, open the app, point
it at `tests/fixtures/seeding-vault`.
Expected: the tree renders with three nodes; declaring `filename: YYYY-MM-DD` and
`someone else` writes one file under `vault/imports/regions/`; `ideas.md` appears
by name among the refusals; `vault/transcripts/` is still absent.

- [ ] **Step 6: Commit**

```bash
git add web/survey-map.ts web/import-entry.ts web/import-review.ts web/style.css \
        tests/survey-map.test.ts
git commit -m "seeding: the map, the declaration, and the region the review stays inside"
```

---

### Task 14: The offer — one dimmed line, and nothing on silence [MODIFY — SMALL, CONTENDED FILE]

**Orient:** Reach must reach the person or the whole mechanism is a logged
evaluation nobody reads, and it must do so as one dimmed line that costs a word to
decline — because extraction pulled on the agent's own judgment would be an act,
which means shadow-first, which means inert, which is the failure this project has
hit six times.
**Flow position:** Step 14 of 15 (reach route → **waiting surface** → survey map).
Upstream: `GET /api/reach`. Downstream: `navTo` into the declaration.
**Skill:** `interface-design:interface-design`
**Files:**
- Modify: `web/main.ts` — `renderWaiting` (`:1442`), beside the cadence line
  (`:1494`), **and `navTo` (`:187`), which gains one optional argument**:

  ```ts
  function navTo(screen: Screen, opts?: { focus?: string })   // was (screen: Screen)
  ```

  **Keep the parameter typed `Screen`, never `string`.** `Screen`
  (`web/main.ts:148`) is a ten-member union and `navTo` is called from fourteen
  sites passing bare literals; widening it to `string` would delete the check
  that catches a typo'd screen name at every one of them, in exchange for
  nothing this task needs. Task 13's *injected* dep may keep `screen: string` —
  that is a module boundary and 058 T10 already crosses it the same way.

  (An earlier draft cited `:133-146` for this function. That range is the
  paste-detector closure; the number was inherited from 058's plan, whose own
  `Screen` citation has also drifted from `:98` to `:148`. Read the file, not
  the older plan.)
- Modify: `web/style.css` (`.reach-offer`, alongside `.cadence-line` at `:947`)
  — **runs after Task 13, which touches the same file**
- Create: `tests/waiting-surface.test.ts` — **read the DOM-harness note in Task 13
  Step 3 first**; this repo has no DOM test environment today.

<contracts>
**Upstream:** `{ offer: { path, unread, terms } | null }`.
- The line sits with the cadence line and takes its idiom exactly:
  `.cadence-line`-class dimming, `opacity: 0.55`, `:empty { display: none }`. The
  style.css comment above the cadence line already states the principle — "the
  record, offered, and nothing acts on it" — and this is the second thing that is
  true of.
- The sentence, in the interface's register: *"journal/2021 has 318 notes you have
  not harvested; what is open now touches it."* Then two words: **reach it** ·
  **not now**.
- Behavioural invariant: **`offer: null` renders nothing at all.** No empty state,
  no "nothing to offer" line. Silence is the correct output and it must look like
  silence.
- Behavioural invariant: **`not now` costs one click and records a decline.** It
  never asks why, never confirms, and the line is gone for that render. Q-22:
  recorded signal, never escalated.
- Behavioural invariant: **one line, one region, never a list.** If two regions
  qualify, the surface shows the higher-ranked one; the map is where the whole
  tree lives.
- Behavioural invariant: **`reach it` lands on the region it named.** It calls
  `navTo('import')` and passes the offered node path as Task 13's `focus`
  parameter, so the map opens expanded and scrolled to that node with the
  declaration questions already in view. Landing on a collapsed tree would make
  the person hunt for the folder Elicit had just named — the offer's only value
  is that it did the finding.
- Behavioural invariant: the edit to `web/main.ts` is **three additions and one
  widened signature**, stated exactly rather than as "additive": one `api` call
  and one element inside `renderWaiting`, and one optional parameter on `navTo`
  (`:187`, parameter stays `Screen`) forwarded to the `'import'` case 058 T11
  adds. No function body is
  re-flowed and no existing call site changes, because the parameter is
  optional. `renderProposal` and `renderReviews` are not touched. An earlier
  draft claimed nothing was reshaped while asserting a two-argument `navTo` in
  its own test; the claim, not the test, was wrong.
</contracts>

- [ ] **Step 1: Write the failing tests**

```ts
it('renders one dimmed line when a region is offered', async () => {
  expect(surface.querySelector('.reach-offer')!.textContent).toContain('journal/2021');
});
it('renders nothing at all when nothing reaches', async () => {
  expect(surface.querySelector('.reach-offer')).toBeNull();
});
it('declining posts the decline and removes the line', async () => {
  clickNotNow(surface);
  expect(sent[0]).toMatchObject({ path: '/api/reach/decline', body: { path: 'journal/2021' } });
  expect(surface.querySelector('.reach-offer')).toBeNull();
});
it('shows one line even when two regions qualify', async () => {
  expect(surface.querySelectorAll('.reach-offer')).toHaveLength(1);
});

it('reach it lands the map on the region it named', async () => {
  clickReachIt(surface);
  expect(navToCalls[0]).toEqual(['import', { focus: 'journal/2021' }]);
});
```

Run: `npx vitest run tests/waiting-surface.test.ts`
Expected: FAIL, 5.

- [ ] **Step 2: Implement and verify by use**

Run: `npm run build && ELICIT_LLM=fake npx tsx src/server.ts`, survey the fixture,
leave one queue entry pending whose question shares two terms with a folder name,
open the waiting surface.
Expected: one dimmed line naming the folder; `not now` removes it and emits
`reach-declined`; a reload does not bring it back ahead of an undeclined region.

- [ ] **Step 3: Commit**

```bash
git add web/main.ts web/style.css tests/waiting-surface.test.ts
git commit -m "seeding: one dimmed line offers a region, and silence does nothing"
```

---

## Wave 5 — acceptance

### Task 15: The seven jobs, as tests over one fixture vault [NEW FILE]

**Orient:** Each of the seven jobs was ruled separately and built across five
waves, and the only place they can be shown to hold together is one run over one
undated vault that ends with dated sittings, true stances, a bounded queue and no
surface that lists debt.
**Flow position:** Step 15 of 15 (everything → **acceptance**).
**Skill:** `tdd`
**Files:**
- Create: `tests/seeding-acceptance.test.ts`

- [ ] **Step 1: One test per ruling**

```ts
it('Survey — the map is computed, model-free, and stores no completeness flag', () => {
  // Structural, not a spy: a fresh vi.fn() nobody was handed cannot fail.
  expect(readFileSync('src/import/survey.ts', 'utf-8')).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
  expect(readdirSync(join(root, 'imports'))).not.toContain('completeness.json');
});

it('Reach — offers, never acts: no corpus exists after an offer is shown', async () => {
  await get('/api/reach');
  expect(existsSync(join(root, 'transcripts'))).toBe(false);
});

it('Cut — the review queue never exceeds the chosen region', async () => {
  expect((await get(`/api/import/next?region=${slugA}`)).remaining).toBe(regionACount);
});

it('Cut — there is still no batch accept', () => {
  expect(routePaths(app)).not.toContain('/api/import/accept-all');
});

it('Anchor — an undated vault imports by filename and names what it refused', async () => {
  expect(sittingsOnDisk(root).map(s => s.started)).toContain('2021-03-04T00:00:00.000Z');
  expect(scanResult.refused).toContainEqual({ file: 'ideas.md', reason: 'no-date-in-name' });
});

it('Anchor — no date anywhere comes from an mtime', () => {
  // FIXTURE_DATES comes from tests/fixtures/seeding-vault/manifest.ts, and every
  // fixture file is `utimesSync`d to TODAY before the run. A regex like
  // /^20(1|2)\d-/ would match today's date too and could not fail; an exact set
  // read from the one place that defines it can.
  expect(sittingsOnDisk(root).map(s => s.started.slice(0, 10)).sort()).toEqual(FIXTURE_DATES);
  expect(FIXTURE_DATES).not.toContain(new Date().toISOString().slice(0, 10));  // the guard's guard
});

it('Authorship — no snippet from an "other" region carries stance avowal', () => { /* read off disk */ });

it('Repair — every dangler buds, the cap holds only the questions, no surface', () => {
  // Three danglers, cap 2: three Buds, two questions, one deferred and findable.
  expect(budsOnDisk(root)).toHaveLength(3);
  expect(queue.list({ source: 'import-repair' })).toHaveLength(2);
  expect(ledgerLines(root).filter(l => !l.questioned)).toHaveLength(1);
  expect(routePaths(app).some(p => p.includes('repair'))).toBe(false);
});

it('Link — one sentence in two files becomes two snippets on two dates', () => { ... });

it('Confirm — a 2017 sitting imported today is a still-true candidate at once', async () => {
  const report = await runDocketNow();
  expect(stillTrueCandidateIds(report)).toContain(snippetFrom2017.id);
});

it('Confirm — nothing anywhere holds a weak prior or a fifth status', () => {
  expect(grepSrc('weakPrior|weak-prior|provisional-status')).toEqual([]);
});
```

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every suite green, tsc clean, the file count above 57 and the pass count
above 1362 (058 dispatch 1's floor).

- [ ] **Step 3: Commit**

```bash
git add tests/seeding-acceptance.test.ts
git commit -m "seeding: the seven jobs, as tests over one undated vault"
```

---

## 5. Execution Waves

```
Wave 0: 1 → 2                    (serial — 2 consumes 1's types)
Wave 1: 3 → 4 → 5                (SERIAL — see the shared-file note below)
Wave 2: [6 ∥ 7] → 8              (6 and 7 are file-disjoint; 8 reads 7's file)
Wave 3: [9 ∥ (10 → 11)] → 12     (12 last: it is the wiring task for 7, 9 and 10)
        — also gated on 058 T6, T7, T9
Wave 4: 13 → 14                  (SERIAL — both edit web/style.css)
        — also gated on 058 T10, T11
Wave 5: 15
```

**Why three of the six waves are serial, and it is not caution.** An earlier
draft annotated Waves 1, 3 and 4 "parallel — disjoint files" and the files were
not disjoint:

| Wave | Tasks | Shared file |
|---|---|---|
| 1 | 3, 4, 5 | `src/log/format.ts`, `src/registry.ts` |
| 3 | 10, 11 | `src/wiki/thresholds.ts`, `src/log/format.ts`, `src/registry.ts` |
| 4 | 13, 14 | `web/style.css` |

`src/log/format.ts` is the sharp case: standing rule 7 records that it already
carries two foreign unstaged hunks, so it must be staged hunk-by-hunk. Two agents
running `git add -p` against one dirty file in parallel is how a foreign hunk
gets committed by someone who never read it. Sequencing costs wall-clock and buys
a file each task owns alone while it holds it.

Task 12 is last in Wave 3 for a different reason: it is the only task in that
wave permitted to touch `src/server.ts`, and it is where Tasks 7, 9 and 10 stop
being signatures.

**File fence while 058's remaining dispatch runs.** Waves 0–2 touch only
`src/import/{contract,region,dating,survey,scan,store,extract}.ts`,
`src/clerk/docket.ts`, `src/types.ts`, `src/queue/source-label.ts`,
`src/log/format.ts`, `src/registry.ts` and `tests/`. No Seeding task modifies
`src/harvester/harvester.ts` at all (see Task 7). Of the rest, 058's remaining
tasks touch `src/types.ts` (T6, one field on `DocketReport`),
`src/clerk/docket.ts` (T6, one optional dep) and `src/log/format.ts` (T7).
Coordinate on those three, or sequence Wave 1 Task 5 after 058 T6.

---

## 6. Open Questions

### Flow Contracts

- ~~Q: Does 058's `GET /api/import/next` accept a query parameter at all?~~
  **Resolved inside this plan.** It does not today, and Task 12's contract
  invariant adds `?region=<slug>` while keeping the no-parameter behaviour
  intact; Task 13 Step 4 is the one line in `web/import-review.ts` that sends it.
  Both ends are named, so this is a task, not an open question.
- Q: Does `commitImport` take an injectable `regionFor`, or does it construct the
  region store itself? (T9 assumes injection, matching every other dep in that
  signature — verify against 058 T7 as landed.)
- Q: Does 058 T10's review surface show the piece's region anywhere? (Assumed no,
  and not requested — the review is about the prose, not the folder.)

### Blocking — answer before the wave named

- **Task 7 (Wave 2) — is `machine-assisted` non-authored for the avowal rule?**
  Q-70 lists three values and says "non-authored never carries `stance: avowal`"
  without naming which of the three are non-authored. Recommended default:
  `authored` alone may carry avowal, so `machine-assisted` is guarded exactly as
  `other` is. Rival: machine-assisted prose is the person's thought in a model's
  wording, so avowal is defensible. The default is safer and reversible — a
  wrongly-guarded stance is a label to loosen later, a wrongly-avowed one is a
  claim about a person who never held it (Q-51's own asymmetry).
- **Task 7 (Wave 2) — does Q-51 exclude machine-assisted material whole?** Q-51
  says material whose authorship cannot be SEPARATED is not admissible corpus,
  and model-assisted prose is exactly that; Q-70 nonetheless names it as a region
  value that harvests. Recommended reading: Q-70 is the later and more specific
  ruling, so the region admits, and Q-51's whole-item exclusion still operates at
  review time through the surface's exclude control. If that reading is wrong,
  Task 7 shrinks to two values and the region form drops a choice.
- **Task 11 (Wave 3) — is the live Queue's question text an acceptable stand-in
  for a Direction?** Verified: `QueueEntry.direction` and `.topic` are persisted
  but written by nothing (0 of 17 entries, 0 of 24 transcripts). Recommended
  default: license on question text, keep `liveTerms` injected, swap when
  Directions become real. Rival: ship Reach shadow-first until Directions exist —
  rejected, because Q-69 ships it live and a shadowed offer is the inert failure
  the ruling names. Second rival: offer every unharvested region unconditionally —
  rejected as a menu of debt (Q-24).
- **Tasks 13 and 14 (Wave 4) — does a DOM test environment exist by then?**
  Verified 2026-08-02: it does not. No `jsdom`, no `happy-dom`, no `environment`
  key, no existing test touching `document`. 058's T10 plans DOM tests and must
  introduce one. Recommended default: if T10 landed a harness, use it; if not,
  extract pure functions (`mapLines`, `canSave`, `offerSentence`) and test those,
  moving the rest into the by-use runs. Rival: add `jsdom` in this plan —
  rejected, because a test-infrastructure decision that two slices depend on
  should not be made inside a task about a folder tree.
- **Task 10 (Wave 3) — is "opens with an anaphor AND has no context window" close
  enough to Q-72's unresolvable dangler?** 074's labelled 25 were judged, not
  computed, and this proxy will not reproduce that set. Recommended default: ship
  the under-detecting mechanical rule (a missed Bud costs nothing; a wrong repair
  question spends attention), and revisit when 074's annotation lands, since a
  dangler that 074's resolver declines to annotate is the exact signal.

### Exploratory — answerable during implementation

- **Task 3:** which `RefusalReason` should a file get when it matches the filename
  pattern but the frontmatter also holds a conflicting `date`? (Assumed: the
  declared rule wins silently — one rule per region is the whole point of Q-67.)
- **Task 3:** should `compilePattern` support a `YY` token? (Assumed no —
  two-digit years are ambiguous across a nine-year corpus.)
- **Task 7:** is `report-of-fact` the right coerced stance, or is
  `uncertainty-marked` closer to "kept, not held"? (Assumed `report-of-fact`.)
- **Task 10:** which `questionForm` does a repair question carry? (Assumed
  `deliberative`, matching what imported snippets already use; the canon mapping
  — deliberative → avowal — fits none of the seven cleanly.)
- **Task 13:** at what node count does a depth-2 collapsed tree stop being
  readable? (Unmeasured; the fixture has three nodes and a real vault has
  hundreds.)
- **Task 4:** does a 5,000-file survey walk stay under two seconds on the target
  machine? (Estimated from 10 MB of reads plus 5,000 SHA-256s; measure on the
  first real vault rather than building a progress protocol now.)

### Assumptions this plan makes, stated so they can be checked

1. `src/import/{contract,body,scan,store,extract,adopt}.ts` are as read on
   2026-08-02 and nothing else has edited them.
2. 058's T6/T7/T9/T10/T11 land before Waves 3–4, with the contracts its plan
   states.
3. `vault.saveBud(fragment, failures, session)` is unchanged
   (`src/vault/vault.ts:138`).
4. `THRESHOLDS` accepts new keys without a schema migration
   (`src/wiki/thresholds.ts:65`).
5. ~~Adding `'import-repair'` breaks no exhaustive check.~~ **False, and
   corrected in Task 1:** `src/queue/source-label.ts:40` holds a `Record` keyed
   by the union and will not compile without the new member. That is the only
   such check in the tree; if `tsc` names a second, report it.
6. `deps.listSessions` in the docket returns every session including imported
   ones, so `started` resolves for imported snippets (Task 5 depends on this
   entirely — if imported sittings are absent from that list, Task 5's map is
   empty and the guard restores today's wrong behaviour, correctly but
   uselessly).
7. ~~`SYSTEM_PROMPT` can be exported without colliding with a concurrent
   edit.~~ **Moot:** it is already exported at `harvester.ts:92`, and no
   Seeding task touches that file.
8. `tests/mechanism-registry.test.ts` demands registry entries for `src/`
   exports only — `enumerateMechanisms` at `:100-104` skips every path outside
   `src/`, so `web/survey-map.ts` needs none.

---

## 7. Per-Wave Verification

| Wave | Gate |
|---|---|
| 0 | `npx tsc --noEmit` clean **and failing in exactly one place before the label lands** (`src/queue/source-label.ts:40`); `tests/import-contract.test.ts` 4/4; `tests/queue-source-label.test.ts` green with `'import-repair'` in `SOURCES` and its Q-15 assertion; `tests/import-region.test.ts` 5/5; a region record round-trips through a fresh store. |
| 1 | `tests/import-dating.test.ts` 8/8; **`tests/import-scan.test.ts` 5/5 unedited** (this is the regression guard — no self-comparison test replaces it); `tests/import-survey.test.ts` 7/7; `tests/docket.test.ts` fully green including 075's rotation tests **and the empty-string `started` case**; `tests/log-format.test.ts` and `tests/mechanism-registry.test.ts` green. |
| 2 | `tests/import-store.test.ts` 12/12; `tests/import-extract.test.ts` 14/14; `tests/import-link.test.ts` 4/4 **with no source change**; `git diff src/harvester/` empty. |
| 3 | `tests/import-commit.test.ts` green including the read-off-disk avowal invariant; `tests/import-repair.test.ts` 7/7 **including "buds every dangler over the cap"**; `tests/import-reach.test.ts` 8/8; `tests/seeding-routes.test.ts` 9/9 including the three injection-site assertions; 058's `tests/import-routes.test.ts` still green; the **eight** route-called registry entries flipped to `live`, and none left `unwired` under `src/import/`. |
| 4 | `tests/survey-map.test.ts` 8/8 (6 map + 2 region-slug); `tests/waiting-surface.test.ts` 5/5; the by-use run writes a region record and no transcript. |
| 5 | `npx vitest run` — every suite green, above 1362 passing; `npx tsc --noEmit` clean; `tests/seeding-acceptance.test.ts` 11/11. |

**The wave-3 gate that matters most:** a full import driven only through the
routes — declare, scan, docket, next, decisions — must leave a snippet on disk
carrying `provenance.authorship`. Every other authorship test in this plan
injects `regionFor` directly and would pass over an unwired route.

---

## 8. Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/import/contract.ts` | patch | `export type Authorship` |
| `src/import/contract.ts` | patch | `'no-date-in-name'` |
| `src/import/contract.ts` | patch | `export type DatingRule` |
| `src/types.ts` | patch | `authorship?:` |
| `src/types.ts` | patch | `'import-repair'` |
| `src/queue/source-label.ts` | patch | `'import-repair': 'from your own words'` |
| `tests/queue-source-label.test.ts` | patch | `reads a repair question as the words composed gets` |
| `src/import/region.ts` | create | `export function createRegionStore` |
| `src/import/region.ts` | create | `regionFor(sourcePath: string)` |
| `src/import/dating.ts` | create | `export function compilePattern` |
| `src/import/dating.ts` | create | `export const DEFAULT_DATING` |
| `src/import/scan.ts` | patch | `export function scanFolder(root: string, rule` |
| `src/import/scan.ts` | patch | `export function walkMarkdown` |
| `src/import/survey.ts` | create | `export function surveyFolder` |
| `src/import/survey.ts` | create | `export function readSurvey` |
| `src/clerk/docket.ts` | patch | `writtenAtMs` |
| `src/import/store.ts` | patch | `nextExtracted(region?: string)` |
| `src/import/extract.ts` | patch | `KEPT_NOT_WRITTEN` |
| `src/import/commit.ts` | patch | `authorship: region.authorship` |
| `src/import/repair.ts` | create | `export function runImportRepair` |
| `src/import/repair.ts` | create | `dangling-referent` |
| `src/import/repair.ts` | create | `questioned` |
| `src/import/reach.ts` | create | `export function reachOffer` |
| `src/import/reach.ts` | create | `export function termsOf` |
| `src/wiki/thresholds.ts` | patch | `'reach.nameOverlapMinTerms'` |
| `src/wiki/thresholds.ts` | patch | `'repair.liveCap'` |
| `src/server.ts` | wire | `/api/import/region` |
| `src/server.ts` | wire | `/api/reach` |
| `src/server.ts` | wire | `runImportRepair` |
| `src/server.ts` | wire | `regionFor` |
| `src/server.ts` | wire | `nextExtracted(` |
| `web/survey-map.ts` | create | `export function renderSurveyMap` |
| `web/survey-map.ts` | create | `focus` |
| `web/import-entry.ts` | wire | `renderSurveyMap` |
| `web/import-review.ts` | wire | `/api/import/next?region=` |
| `web/main.ts` | patch | `reach-offer` |
| `web/main.ts` | patch | `navTo(screen: Screen, opts` |
| `web/style.css` | patch | `.reach-offer` |
| `src/log/format.ts` | patch | `import-refused-by-rule` |
| `src/log/format.ts` | patch | `still-true-undateable` |
| `src/log/format.ts` | patch | `reach-evaluated` |
| `src/log/format.ts` | patch | `repair-question-capped` |
| `tests/import-region.test.ts` | create | `deepest declared region` |
| `tests/import-dating.test.ts` | create | `no-date-in-name` |
| `tests/import-survey.test.ts` | create | `never surveyed` |
| `tests/import-store.test.ts` | patch | `never hands a region filter an item that has no region` |
| `tests/import-extract.test.ts` | patch | `kept-not-written` |
| `tests/docket.test.ts` | patch | `EMPTY STRING listSessions writes` |
| `tests/import-link.test.ts` | create | `there is no link store` |
| `tests/import-repair.test.ts` | create | `BUDS every dangler over the cap` |
| `tests/import-reach.test.ts` | create | `imports no prose reader` |
| `tests/seeding-routes.test.ts` | create | `cannot produce a day` |
| `tests/survey-map.test.ts` | create | `none preselected` |
| `tests/waiting-surface.test.ts` | create | `reach-offer` |
| `tests/seeding-acceptance.test.ts` | create | `weak prior` |
| `tests/fixtures/seeding-vault/manifest.ts` | create | `FIXTURE_DATES` |
| `tests/fixtures/seeding-vault/journal/2021-03-04.md` | create | (a body with no frontmatter) |
| `tests/fixtures/seeding-vault/journal/ideas.md` | create | (no date in any form) |
| `tests/fixtures/seeding-vault/journal/2019/2019-11-03.md` | create | (holds `SHARED_SENTENCE`) |
| `src/registry.ts` | patch | `src/import/dating` |
| `src/registry.ts` | patch | `src/import/reach` |
| `vault/imports/regions/` | create | (written at first declaration, not by a task) |
<!-- PLAN_MANIFEST_END -->

**Seeds DAG.** Materialise at dispatch, per 058's precedent: `sd create "<Task N
title>" --label plan:seeding,wave:<N>` for all 15; `sd dep` for each contract
edge; `sd block` per wave pair and per intra-wave sequence (3→4→5, 10→11,
13→14).

Contract edges, with the three the first draft missed marked:

```
2→1   3→1   4→1   4→3(walkMarkdown)   6→1   7→2   8→7
9→2(regionFor reads the region store)   9→7
10→1  11→4
12→2  12→3(the scan route passes the dating rule)   12→4
12→6(the next route passes the region filter)   12→7  12→9  12→10  12→11
13→12  14→12  14→13(the focus parameter)   15→{13,14}
```

---

## 9. Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|---|---|---|
| Q-1 | Sole Authorship: no agent prose enters a Piece, no agent rewords a Snippet — a guarantee about wording, not origin | Task 7 (a stance is an agent label, so coercing it violates nothing Q-1 guarantees; the person's words are never touched) |
| Q-3 | Markdown is truth; any index is derived and rebuildable | Task 2 (region records as markdown), Task 4 (survey.json is a rebuildable cache, no stored completeness flag) |
| Q-23 | The Activity Log is the ledger; a new kind lands with its sentence | Standing rule 6; Tasks 3, 4, 10, 11 (each adds its kinds and formatters in the same commit) |
| Q-6 | Fragments failing admissibility become Buds with failures recorded; a Bud waits without accusing | Task 10 (one Bud per dangler; under-detection is the safe direction) |
| Q-14 | Still-true checks always ask differently | Task 5 (the licence path; wording unchanged, only the candidate set) |
| Q-15 | Nothing on a read surface may accuse: a question is met as an ordinary question, never as a verdict on the person | Task 1 (the new source's label reads as the four others do — `sourceLabel('import-repair') === sourceLabel('composed')`; a line saying "repairing a dangling referent" would tell the person their own sentence was defective) |
| Q-21 | No confidence numbers; Status is a four-value enum | Task 15 (no weak prior, no fifth status, asserted by grep) |
| Q-22 | Zero outbound contact; finished work waits visibly until the person walks in — agent initiative ends at the app's edge (Q-37 reads this as: ignoring an offer is recorded signal, never escalated) | Task 11 (decline reorders, never suppresses), Task 14 (`not now` never asks why; the offer waits and never chases) |
| Q-24 | Advice is choice-expanding and guilt-free; debt is never rendered as a list | Task 10 (no repair surface), Task 11 (one offer, never a menu), Task 13 (no per-file list) |
| Q-25 | The app is locked; every route sits behind the same auth | Task 12 (all four routes) |
| Q-29 | Status is never model-writable; transitions are mechanical | Task 5 (candidate selection is mechanical), Task 15 |
| Q-35 | Selection mechanisms are shadow-first | Task 11 (named to show why Reach is exempt via Q-62) |
| Q-37 | Agent-side offers are passive: a dimmed lint-note line on the waiting surface | Task 14 (the offer takes the cadence line's idiom) |
| Q-50 | Two cites are independent only across sittings; the date is what makes it possible | Task 5 (written-when, not filed-when), Task 8 (two files, two sittings, two dates) |
| Q-51 | Unseparable authorship is inadmissible; exclusion is reversible, admission is not | Task 7 (the machine-assisted question), Task 9 (authorship stamps, never gates — Q-51's exclusion stays on the review surface) |
| Q-55 | Target is never relaxed at any rung | Task 10 (a repair question claims no Target) |
| Q-56 | Bounds ship live from day one; every clip emits `threshold-clipped` | Task 6 (region bound and extraction budget are different bounds), Task 10 (`repair.liveCap` live at birth — and the named divergence from Q-72's "existing caps", since no per-source mint cap exists to ride) |
| Q-57 | One door: a folder on disk; the scan is model-free; never mtime | Task 3 (no mtime under any rule), Task 4 (no model call in Survey), Task 12 (no new door) |
| Q-58 | The import review IS the harvest review; no batch accept | Task 6 (the gate is untouched, only the input bounded), Task 15 (still no batch route) |
| Q-59 | Identity is the content hash; a changed file is a new item; dedupe within a source path | Task 3 (`lastmod` stays frontmatter-only), Task 6 (`admit`'s branches untouched), Task 8 (the dedupe boundary) |
| Q-60 | Imported items carry no Target and no control offers one | Task 10 (the repair question carries no `target` key), Task 13 (the declaration asks two things, never a Target) |
| Q-61 | The vault is a git repository and the docket commits it | Task 2, Task 10 (region records and the repair ledger are tracked corpus decisions, not gitignored) |
| Q-62 | An offer-only mechanism ships LIVE from day one, logging every evaluation | Task 11 (Reach live, `reach-evaluated` on every run), Task 14 (nothing on silence), Task 10 (capped minting is an offer) |
| Q-65 | Cross-sitting pairs rank above same-sitting in the contradiction pool | Task 8 (Q-71's positive half needs no code because this channel already carries retellings) |
| Q-66 | The weak prior does not exist; Q-50 stands; Confirm is a licence, not a status | Task 5 (**the licence path DOES need one change** — §1 Finding 2), Task 15 |
| Q-67 | One mechanical dating rule per region, declared at Reach; non-matching refused by name | Task 1 (`DatingRule`), Task 3 (the whole task), Task 12 (400 on an uncompilable pattern), Task 13 (the dating question) |
| Q-68 | A region is a folder subtree; the map renders harvested state per node; the queue is bounded by the region | Task 2 (subtree, deepest match), Task 4 (per-node state, computed), Task 6 (the queue bound), Task 13 (the tree) |
| Q-69 | Reach is offer-only and ships live | Task 11 (the licence, and why `direction` cannot be its input), Task 14 (the line) |
| Q-70 | Authorship is declared per region, three values; non-authored never carries `stance: avowal` | Task 1 (the type), Task 7 (clause + mechanical guard), Task 9 (asserted on disk), Task 13 (three choices, none preselected), Open Questions (blocking, twice) |
| Q-71 | A retelling Link is no new object; dedupe within one source path only | Task 8 (the whole task, tests only) |
| Q-72 | Repairs are Buds through the ordinary Queue, capped; no repair surface | Task 10 (the whole task — every dangler Buds, only the Queue question is capped, and the ledger records danglers seen so a deferred one is not lost) |

---

## 10. Unticketed follow-ups

Ticket numbers are the session lead's to assign. These surfaced while writing this
plan and none belongs inside it.

1. **`captured` is filing time and nothing says so.** Task 5 fixes the still-true
   channel, but every other consumer of `Snippet.captured` has the same
   ambiguity — the resonance channel, the randomizer's recency weighting, and
   anything that will later reason about corpus age. A ticket should audit every
   read of `captured` against "did the person write this then, or file it then?"
   and decide once whether `Provenance` should carry a written-when of its own
   rather than routing through the sitting each time.
2. **`QueueEntry.direction` and `.topic` are persisted and written by nothing.**
   Zero of 17 live entries and zero of 24 transcripts carry them. Either a
   minting path should set them or the fields should go; a field that only ever
   round-trips as `undefined` is a licence waiting to ship inert, and Task 11
   works around it today.
3. **074's resolver output is the true unresolvable-dangler signal.** When 074
   lands, a dangler its annotator declines to annotate is exactly Q-72's
   unresolvable case. Swapping Task 10's mechanical proxy for that signal is one
   predicate and would move the detector from under-counting to correct.
4. **Ticket 046 is marked closed with its item 2 unbuilt.** This plan builds the
   `authorship` field for regions but does not touch `POST /api/unprompted`,
   which 046 specified and which still 400s on nothing. The unprompted door
   should ask the same question with the same three values, or 046's resolution
   should be corrected to say what actually shipped.
5. **`classify-before-extract` left the grill without a ruling and without a
   record.** Ticket 013's Question names four backlog items — idempotent ingest,
   authored-vs-machine-assisted provenance, region completeness marks, and
   classify-before-extract. The first three land here as Task 8, Tasks 1/7/9 and
   Task 4. The fourth appears in none of the seven rulings Q-66..Q-72 and in no
   part of this plan. It is noted rather than quietly built: either it was
   subsumed by Anchor's per-region rule (a region is already a classification
   the person made) or it is still open, and only the grill's participants know
   which.
6. **Nested region declarations have no surface.** Task 2 supports deepest-match
   nesting because Q-70 says "move files, not flags" and nesting is the
   no-move correction; the survey map (Task 13) does not show that a node is
   covered by an ancestor's declaration. A person could declare a subtree twice
   without seeing it.

---

## Shape Changes

| Date | Role | Finding | Summary |
|---|---|---|---|
| 2026-08-02 | author | — | Plan written from ticket 013's Resolution (Q-66..Q-72) and the 058 foundation as it stands on disk after dispatch 1. |
| 2026-08-02 | author | review-014 round 3, 1 blocking + 2 advisory | `navTo` corrected at all three citations: the real function is `function navTo(screen: Screen)` at `web/main.ts:187`, not `:133-146` (the paste-detector closure, a number inherited from 058's plan). The widened parameter stays `Screen` — `string` would delete the ten-member union check at fourteen call sites — while Task 13's injected dep keeps `string` as a module boundary, the same crossing 058 T10 makes. Manifest marker repointed to `navTo(screen: Screen, opts`, which now fails the harmful edit instead of rewarding it. Task 4 gained the registry-status step it was the only task missing. Task 8's fixture comment now points at Task 3's table rather than restating it wrongly. |
| 2026-08-02 | author | review-014 round 2, 4 blocking + 7 advisory | Registry statuses corrected against `callerEvidence` (`tests/mechanism-registry.test.ts:239-265`): anything with an in-module or sibling caller is `live` at birth, and `unwired` is reserved for the eight entries Task 12 first calls — enumerated in Task 12 Step 3 rather than counted. `navTo` widened to `(screen, opts?)` at both ends, with Task 14 owning the `web/main.ts` edit and its invariant restated to stop claiming nothing is reshaped. Manifest marker for the renamed reach test. Fixture pinned to six files in one table with a `manifest.ts` the dependent tests read. Model-call guard regexes anchored to import specifiers. Flow-contract question 1 marked resolved. |
| 2026-08-02 | author | review-014, 9 blocking + 12 advisory | Round 1 fixes. `'import-repair'` breaks `source-label.ts`'s `Record` (Task 1, Q-15 row added). `?region=` on 058's next route named in Task 12, and the surface that sends it in Task 13 Step 4. The three inert seams — `regionFor` into extraction and into commit, `runImportRepair` — given a named injection site in Task 12 Step 3. Repair rewritten: every dangler Buds, only the question is capped, the ledger records danglers seen. `src/harvester/harvester.ts` dropped everywhere (`SYSTEM_PROMPT` already exported at `:92`). Waves 1, 3 and 4 resequenced serial over shared files. Registry entries added for `src/import/dating` and `scan:walkMarkdown`. Task 5's `??` replaced with a parseable-date guard (Finding 3). Three unfalsifiable assertions rewritten. Advisories 1–12 applied except the `web/` half of finding 7, disagreed with evidence in Task 13's Files note. |
