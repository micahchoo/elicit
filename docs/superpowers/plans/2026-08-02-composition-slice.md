# The Composition Slice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person picks their own sentences out of the vault, stacks them into a Piece, drags the paragraphs into an order that says something, writes the connective sentence they were missing — which becomes a Snippet like every other sentence in the system — marks the holes they cannot fill, and exports a markdown file made only of their own words. Then, and only then, a model offers up to three other orders of the same material under named organizing principles, flags the pins that have gone stale, and quietly stops minting questions from a Piece nobody has touched in a long time.

**Architecture:** One new namespace, `src/piece/`, holds the whole zero-LLM half: the contract and its guards, markdown persistence under `vault/pieces/`, the deterministic chronological arrangement, the exporter, the stale-pin lint, and the dormancy predicate. Not one file in it takes a `Complete`. The single model-touching module lives in `src/clerk/arrangements.ts`, next to its kin, and it can only ever *add* — a candidate Arrangement it proposes is validated against the pin set the user already assembled, and a candidate that fails validation is dropped whole rather than repaired. Storage is markdown in the vault (Q-3). Nothing in pass 1 runs on the Docket; the Docket learns about Pieces only in pass 2, and only for two jobs that call no model.

**Tech stack:** unchanged — TypeScript (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`), gray-matter, ulid, Hono, Vitest, vanilla DOM in `web/main.ts`, `@mariozechner/pi-ai` against the local endpoint. Pass 2's one model call uses the CLERK role (Q-48): nobody is waiting on it.

---

## What this slice does NOT build

**Agent-initiated Piece offers (Q-37) are excluded, and the exclusion is structural rather than a punt.** Q-37 licenses an offer by *citation-cluster density* — snippets interlinked through shared Claims and Contradictions, never topic-count alone, because a pile is not a piece. Claims are the Clerk slice's product; until a claim graph exists, the licensing predicate has nothing to read and any offer built here would be licensed by topic count, which is exactly the thing Q-37 names and refuses. So there is no offer surface, no density threshold, and no dimmed lint-note line on the waiting surface in this slice. It lands with or after ticket 008. Q-42 says the same thing in the register's own words.

Also out of scope, each for a stated reason:

- **No Piece-level Wiki integration.** A Piece's pins are citations in the sense CONTEXT means, but nothing here writes a Claim, reads one, or teaches the Clerk that pins exist. Q-41's "a set-down Piece's pins still count as citations" is a property the Clerk slice will read off the piece files; this slice's obligation is to make those files readable, which the store does.
- **No harvest review of composition prose.** Pass 1 is zero-LLM, and `propose()` is a model call. The paragraph the user writes in a Piece becomes a Snippet directly, verbatim, with composition provenance (Q-40). See *The reading-less snippet* below — this leaves a real hole and it is recorded rather than papered over.
- **No re-import of an exported Piece.** The export leaves; nothing brings it back.

---

## Four decisions that shape everything below

### Pass 1 must be able to ship alone, so nothing in it may wait on a model

Q-42 is not a sequencing preference. It says pass 1 is *complete on its own*, and the reason it gives is that a deterministic reviewer cannot hallucinate and cannot stall on a slow call. This plan holds that shut by construction, not by discipline:

- Every module under `src/piece/` is greppable for the absence of a model. Task 2's verification step is `! grep -rqE 'Complete|complete\(|pi-ai' src/piece/`, asserted as an exit code. If a later task needs a model in there, it is not a `src/piece/` module.
- Pass 1 adds **no Docket job**. The Docket is where background model work lives; a pass-1 feature that ran there would be a pass-1 feature with a model-shaped hole in it.
- Waves 0 through 2 are pass 1 entire. At the end of Wave 2 the product does the thing the ticket's slice hypothesis names — *stacked snippets plus visible gaps produce a finished piece the user recognizes as their own writing* — and Waves 3 through 5 add to it without correcting it.

The additive test for pass 2, applied to every task in Waves 3–5: **delete the task's files and pass 1 still passes its own e2e.** Task 8 is that e2e and it is written before any pass-2 file exists.

### The arrangement is the draft, so there is no editor chrome to design

`docs/interface-references.md`'s document rule governs the whole surface: every surface is a page of text; controls exist only at the point of attention, in the margin, on focus. For screen "A Piece" the board (`elicit-interface`) makes that concrete — the arrangement IS the draft, paragraphs reorder by dragging the paragraph itself (no cards, no handles), a Gap is a thin rule offering "ask me?", export is a margin word.

One structural consequence is worth stating before anyone writes the drag handler, because it dissolves the hardest interaction problem in the slice:

**Nothing in an Arrangement is both draggable and text-editable.** A pinned Snippet version is immutable (Q-5) — it renders as a paragraph you can drag and cannot type into. The one editable thing is the new-prose composer, and the moment its text is set down it becomes a Snippet and therefore a pin, and therefore no longer editable. So drag-versus-text-selection never arises inside a paragraph, and the gesture disambiguation reduces to drag-versus-scroll, which is the ordinary case.

There is no "done" control anywhere on this surface. Q-41 forbids the flag and Q-24 says why: "done" manufactures its complement, and everything else becomes unfinished. The margin words are `set down` and, when a Piece is already set down, `pick up`.

### Two decisions in the register collide over gap questions, and the collision is resolved here

Q-39 carries a distinction that is easy to read past. Gap detection is **dual-authority** — the model marks empty slots while arranging, the person inserts them during review — and the two are the *same object*, but only "user-inserted gaps mint user-declared-weight questions". A model-marked gap mints an ordinary one.

Q-41 then says setting a Piece down "lets existing gap questions expire on the normal queue rule".

`src/queue/queue.ts:499` reads `if (entry.source === 'user-declared') continue;` inside `expire()`. A gap question minted with `source: 'user-declared'` would get Q-39's weight and would **never expire**, which is precisely what Q-41 says must happen to it. One literal cannot serve both, and it cannot carry the dual-authority split either.

**The resolution, stated so it can be overruled — two new literals and one named predicate:**

- `'gap-declared'` — a gap the **person** inserted. Carries Q-39's user-declared *weight*.
- `'gap-fill'` — a gap the **model** marked while arranging. Ordinary weight. Pass 1 mints only the first; pass 2 adds the second, which is why both literals land in Wave 0 and neither is a later reopening of `src/types.ts`.
- `export function isUserDeclaredWeight(e: QueueEntry): boolean` in `src/queue/queue.ts`, true for `'user-declared'` and `'gap-declared'`, called at exactly the two places the draw reads weight — the priority sort in `draw()` and rung 2 of the degradation ladder in `runChain` — and **not** in `expire()`, which keeps testing the literal `'user-declared'` alone.

Q-39's weight holds, Q-39's dual authority is visible in the type rather than in a comment, Q-41's expiry holds for both gap sources, and no existing source changes behaviour. The two readings of "user-declared" — *this person asked for it* and *this never expires* — become separate things rather than one string doing two jobs. Task 1 owns all of it; `tests/queue.test.ts` gets a case per half.

`'gap-fill'` is the name CONTEXT already uses for this Question Source ("a Bud failure, half-Construct, or Arrangement Gap — the default"), so the literals are the vocabulary rather than a new coinage.

**One thing this breaks at compile time, and it is why T1 owns a third file.** `src/queue/source-label.ts` holds `const SOURCE_LABELS: Record<QueueEntry['source'], string>` — a `Record` keyed by the union, written that way (its own header says so) precisely so a new member fails to COMPILE rather than reaching a person's surface as a machine literal. Both new literals need a label in the same commit as the widening, or nothing builds. Under Q-15 neither label may accuse: `'gap-declared'` reads as the person's own act, and `'gap-fill'` reads exactly as the four that already say `from your own words`, because a model-marked gap's question quotes an adjacent paragraph verbatim (Q-12).

### The reading-less snippet — a hole this slice opens and does not close

CONTEXT's admissibility test requires a Snippet to carry at least one Facet reading. Readings are agent-authored (Q-4) and are written today by `decide()` in `src/harvester/harvester.ts` at harvest time, from a model's proposal. A composition Snippet (Q-40) is written by a zero-LLM path, so it arrives with **no reading**, and nothing in the tree mints a reading for a reading-less snippet after the fact.

Three things are true about that and all three are recorded rather than resolved:

1. It is not a *new* class of hole — a snippet whose harvest reading failed to parse is in the same state today.
2. It is not fixable inside pass 1 without a model, and fixing it in pass 2 would make pass 2 a correction rather than an addition, which Q-42 forbids.
3. The honest fix is a Docket job that proposes readings for reading-less snippets, which belongs to the Clerk's sweep and not to composition.

So: **file ticket 081** (`docs/wayfinder/tickets/081-readings-for-composition-snippets.md`; the Artifact Manifest carries it), and let the composition Snippet be a Snippet with composition provenance and no reading. It is admissible on the hard gate that matters — verbatim, standalone, the user's submitted words — and it is not citable by a Claim until something reads it, which is the correct conservative state.

---

## Flow Map

```
PASS 1 — zero LLM, complete on its own
──────────────────────────────────────

 vault/snippets/**            the material that already exists
        │
        ▼  the person touches the paragraphs they want (no checkboxes, no list)
 POST /api/piece  { snippets: [id, …] }
        │
        ▼  piece/arrange.ts — chronological, deterministic, pure
 Arrangement { principle: 'chronology', entries: Pin[] }
        │
        ▼  piece/store.ts — vault/pieces/<id>/piece.md + arrangements/<aid>.md   (Q-3)
        │
        ├── reorder   ──▶ entries permuted; SAME pin set, checked
        ├── remove    ──▶ entry dropped; pin set shrinks
        ├── write prose ──▶ new session + transcript ──▶ vault.saveSnippet(
        │                     provenance.kind = 'composition', piece = <id>)   (Q-40)
        │                   ──▶ appended to the arrangement as a Pin
        ├── insert Gap ──▶ Gap entry + EXACTLY ONE QueueEntry
        │                   source 'gap-declared', user-declared weight      (Q-39)
        │                   (set-down Piece: the Gap is inserted, nothing minted — Q-41)
        └── set down / pick up ──▶ setDownAt written / cleared, reversibly    (Q-41)
        │
        ▼  piece/export.ts — pins resolved to their PINNED version's prose
 GET /api/piece/:id/export  →  text/markdown: the person's sentences, in order,
                                and nothing else. No title, no Marginalia,
                                no gap marker, no agent word.                 (Q-1)

PASS 2 — additive, and its zero-LLM half is separable from its model half
────────────────────────────────────────────────────────────────────────

 docket run ──▶ piece/stale.ts    (pure) ──▶ stale-pin Marginalia, dimmed.
        │                                     NEVER re-pins.                  (Q-39)
        └──▶ piece/dormancy.ts   (pure) ──▶ auto set-down, silent + logged    (Q-41, Q-23)

 the person asks, on the Piece  ──▶ clerk/arrangements.ts  (the CLERK model, Q-48)
        │                             ONE call, the base pin set in hand
        ▼
 up to 2 model candidates (argument / contrast) + the deterministic chronology
        │
        ▼  THE ONE BOUNDARY — piece/contract.ts guards, in code, before any write
   • principles pairwise DISTINCT, else the duplicate is dropped   (Q-38)
   • every candidate is a PERMUTATION of the base pin set — no pin invented,
     none dropped, every pin resolves to a real snippet@version     (Q-1)
   • no title field, no prose entry, no agent sentence in the body  (Q-1)
   • Marginalia land in the marginalia array and nowhere else
   • a model-marked Gap's question must set off an exact phrase of an
     ADJACENT pinned snippet, or the gap is dropped                 (Q-12)
        │
        ▼
 arrangements/<aid>.md × ≤3, model-stamped (Q-34); the person chooses one.
```

## Storage layout (Q-3: markdown is truth, any index is derived)

```
vault/pieces/<pieceId>/
  piece.md                     frontmatter only, body EMPTY
    id, created, current, setDownAt?, setDownBy?
  arrangements/<arrangementId>.md   frontmatter only, body EMPTY
    id, principle, created, model?, entries[], marginalia[]
```

**Every one of these files has an empty body, and that is the point.** A Piece file with a body is a place for agent prose to live; there is nowhere to put a title because there is no field for one and no body to hold one (Q-1). The person's words live in `vault/snippets/`, where they already are, and an Arrangement points at them.

`entries` is an ordered array of two shapes:

```yaml
entries:
  - { id: <ulid>, kind: pin, snippet: <snippetId>, version: 3 }
  - { id: <ulid>, kind: gap, question: <queueEntryId> }   # absent when nothing was minted
  - { id: <ulid>, kind: gap, pending: "…?" }              # a model-marked gap awaiting choose
```

`marginalia` targets an **entry id**, never an index — reordering must not silently reattach a note to a different paragraph:

```yaml
marginalia:
  - { id: <ulid>, on: null,     note: principle, text: "…", at: <iso>, model: <name> }
  - { id: <ulid>, on: <entryId>, note: role,      text: "…", at: <iso>, model: <name> }
  - { id: <ulid>, on: <entryId>, note: stale-pin, text: "…", at: <iso> }
```

A stale-pin note carries no `model` because no model wrote it — `piece/stale.ts` is a pure graph function, the same shape as `src/wiki/lint.ts` (Q-31).

**Git:** the vault is a git repository and the Docket commits it once per run (Q-61). Pass 1 writes piece files outside any Docket run, so they land in the working tree and are committed by the next run, authored as `elicit-clerk`. That is slightly wrong — the person wrote them — and it is the existing behaviour for every other user-driven write in the app, so this slice does not change it. Recorded in Open Questions.

## File Structure

```
src/
  types.ts               — patch (T1, Wave 0): Provenance.kind += 'composition';
                           Provenance.piece?; QueueEntry.source += 'gap-declared'
                           and 'gap-fill'. No other task edits this file, in any wave.
  queue/queue.ts         — patch (T1, Wave 0): isUserDeclaredWeight() at the draw's two
                           read sites; expire() keeps the literal. Nothing else.
  queue/source-label.ts  — patch (T1, Wave 0): a label per new literal. The Record is
                           keyed by the union, so this is a compile break, not a polish.
  elicitor/elicitor.ts   — patch (T1, Wave 0): Turn.gap — the opener Turn literal, plus
                           emitProbe's opts + agentTurn spread + the drawFallback call
  harvester/harvester.ts — patch (T1, Wave 0): CutProposal.gap in propose(), Provenance.gap
                           in BOTH decide() write sites (approve/trim AND restate)
  piece/contract.ts      — NEW (T2, Wave 0): Piece, Arrangement, ArrangementEntry, Pin,
                           Gap, Marginalia, Principle, PieceStore interface, and the
                           five guards every write passes through.
  piece/store.ts         — NEW (T3, Wave 1): markdown persistence under vault/pieces/
  piece/arrange.ts       — NEW (T4, Wave 1): chronological(), pure, deterministic
  piece/export.ts        — NEW (T5, Wave 1): toMarkdown(), pure
  server.ts              — patch (T6, Wave 2): ten piece endpoints + readVersion(), the
                           pinned-version resolver Vault cannot supply
  log/format.ts          — patch (T6 Wave 2 / T10 Wave 3 / T11 Wave 4): one sentence per
                           new kind. One owner per wave; append, reword nothing.
  piece/stale.ts         — NEW (T9, Wave 3): stale-pin lint, zero LLM, add-only
  piece/dormancy.ts      — NEW (T10, Wave 3): the dormancy predicate, pure
  wiki/thresholds.ts     — patch (T10, Wave 3): piece.dormancyDays, piece.gapsPerCandidate
  clerk/docket.ts        — patch (T10, Wave 3): two guarded zero-LLM piece jobs
  server.ts              — patch (T10, Wave 3): the two thunks at the ONE production
                           runDocket( call (server.ts:377). Without this the jobs are inert.
  clerk/arrangements.ts  — NEW (T11, Wave 4): the one model call in the slice
web/
  main.ts, style.css     — patch (T7, Wave 2): the choose-material page and the Piece
                           surface. patch (T12, Wave 4): the candidate margin word.
tests/
  piece-contract.test.ts   — NEW (T2)      piece-store.test.ts      — NEW (T3)
  piece-arrange.test.ts    — NEW (T4)      piece-export.test.ts     — NEW (T5)
  piece-routes.test.ts     — NEW (T6)      piece-stale.test.ts      — NEW (T9)
  piece-dormancy.test.ts   — NEW (T10)     clerk-arrangements.test.ts — NEW (T11)
  piece-e2e.test.ts        — NEW (T8 pass 1, T13 appends pass 2)
  queue.test.ts            — extend (T1)   log-format.test.ts       — extend (T6/T10/T11)
  docket.test.ts           — extend (T10)
docs/
  superpowers/plans/2026-08-02-composition-slice.RESULTS.md — NEW (T14)
```

## File ownership (this repo has had cross-agent collisions — read this before dispatch)

Every file this plan names appears here exactly once per wave. **If a file is not in this table, no task may edit it.**

| File | Wave | Owning task | Rule |
|---|---|---|---|
| `src/types.ts` | 0 | **T1 only** | Every type addition the slice needs, landed once. No other task edits it in any wave. Contended — re-read before editing. |
| `src/queue/queue.ts` | 0 | **T1 only** | The weight predicate and the new literals' round-trip. Nothing else. Contended. |
| `src/queue/source-label.ts` | 0 | **T1 only** | Two labels. Compile-forced by the union widening — not optional, not deferrable. |
| `src/elicitor/elicitor.ts` | 0 | **T1 only** | Hop 2 of the gap link, in four places: the opener Turn literal (`:149-156`), `emitProbe`'s opts and its `agentTurn` spread, and the `drawFallback` call (`:468-475`). Nothing else. Heavily contended; re-read before editing. |
| `src/harvester/harvester.ts` | 0 | **T1 only** | Hops 3 and 4 — the `propose()` copy at `:559` and **both** `decide()` spreads at `:636` and `:677`. Nothing else. Heavily contended; re-read before editing. |
| `tests/queue.test.ts`, `tests/queue-source-label.test.ts`, `tests/gap-link.test.ts` | 0 | T1 only | Extend the first two; the third is new. Touch no existing case. |
| `src/piece/contract.ts` | 0 | T2 only | |
| `tests/piece-contract.test.ts` | 0 | T2 only | |
| `src/piece/store.ts` | 1 | T3 only | |
| `src/piece/arrange.ts` | 1 | T4 only | |
| `src/piece/export.ts` | 1 | T5 only | |
| `tests/piece-store.test.ts`, `piece-arrange.test.ts`, `piece-export.test.ts` | 1 | T3 / T4 / T5 | One each. |
| `src/server.ts` | 2 | **T6 only** | Heavily contended — re-read before editing; append routes, reword none. |
| `src/log/format.ts` | 2 | **T6 only** | Pass-1 kinds only. Contended. Append entries, reword none. |
| `tests/log-format.test.ts` | 2 | T6 only | Append to `EMITTED`. |
| `tests/piece-routes.test.ts` | 2 | T6 only | New file. |
| `web/main.ts`, `web/style.css` | 2 | **T7 only** | Contended — re-read before editing. |
| `tests/piece-e2e.test.ts` | 2 | T8 only | New file. T13 appends in Wave 4. |
| `src/piece/stale.ts`, `tests/piece-stale.test.ts` | 3 | T9 only | |
| `src/piece/dormancy.ts`, `tests/piece-dormancy.test.ts` | 3 | T10 only | |
| `src/wiki/thresholds.ts` | 3 | T10 only | Two register entries, both with their `graduatesWhen` sentence. Contended. |
| `src/server.ts` | 3 | **T10 only** | **Append-only: two thunks at the `runDocket(` call and nothing else.** T6 finished with the file in Wave 2; T12 does not open it until Wave 4. Contended. |
| `tests/piece-routes.test.ts` | 3 | T10 only | Extend with the through-`createApp` wiring test; touch no existing case. |
| `src/clerk/docket.ts` | 3 | **T10 only** | Two guarded calls + their deps. Contended. |
| `tests/docket.test.ts` | 3 | T10 only | Extend; touch no existing case. |
| `src/log/format.ts` | 3 | **T10 only** | Wave-3 kinds only. T6 is finished with it. |
| `tests/log-format.test.ts` | 3 | T10 only | |
| `src/clerk/arrangements.ts`, `tests/clerk-arrangements.test.ts` | 4 | T11 only | |
| `src/log/format.ts`, `tests/log-format.test.ts` | 4 | **T11 only** | Wave-4 kinds only. |
| `src/server.ts` | 4 | **T12 only** | Two routes. T6 is finished with it. |
| `web/main.ts`, `web/style.css` | 4 | **T12 only** | T7 is finished with them. |
| `tests/piece-e2e.test.ts` | 4 | **T13 only** | Append one describe block; touch nothing existing. |
| `docs/…-composition-slice.RESULTS.md` | 5 | T14 only | New file. |

`src/log/format.ts` carries three owners in three different waves, and that is deliberate rather than sloppy: `tests/log-format.test.ts` fails both ways — a kind emitted with no sentence, **and** a sentence for a kind nothing emits — so the sentences cannot be pre-landed in Wave 0. No file has two owners in one wave.

**Read freely, write never.** Named here as sources and edited by no task: `src/vault/vault.ts` (`saveSnippet`, `startTranscript`, `appendTurn`, `rebuildIndex`), `src/clerk/composed.ts` (the quote-gate discipline T11 copies; `checkQuotesSource` is not exported today — see Open Questions), `src/elicitor/guards.ts`, `src/log/activity.ts`, `src/index/lexical.ts`, `docs/interface-references.md`. **`src/harvester/harvester.ts` and `src/elicitor/elicitor.ts` left this list when the gap-clearing ruling landed** — T1 owns three lines in the first and two in the second, in Wave 0, and no other task in any wave opens either. If a task finds it must edit one of these, that is a scope change: stop and report.

---

### Task 1: Shared-contract patch — composition provenance, the two gap sources, the weight predicate, and the gap link [CHANGE SITE]

**Orient:** Five of the most contended files in the repo, patched once, first, by one owner, so that no later wave has to reopen them. Q-40 says all user prose in the system is a Snippet with no exceptions, and prose written in a Piece needs a provenance kind that names where it came from. Q-39 and Q-41 collide over gap questions, and this task is where the collision is resolved. **It is also where the gap link is threaded end to end** — a field that exists at one end and never arrives at the other is the failure this repo has shipped before, so the whole chain is one task and one commit.
**Flow position:** Wave 0 — nothing upstream; T2, T3, T6, T7 and T11 all compile against these declarations.
**Q-refs:** Q-39 (a gap clears only when the user places a snippet; a fitting later harvest is offered in the margin, never auto-placed), Q-40 (composition provenance), Q-41 (gap questions expire on the normal rule), Q-13 (constraints then chance — the predicate changes the sort, never the chance step), Q-15 (no label may accuse), Q-4 (the link lives in Provenance frontmatter, never in the Snippet body), Q-60 (an absent field is never a guessed one).

<contracts>
**Downstream (this task → every other task):**

`src/types.ts`:
- `Provenance.kind` gains `'composition'` — the union becomes `'harvest' | 'restatement' | 'unprompted' | 'composition'`.
- `Provenance` gains `piece?: string` — the Piece the prose was written in. **Optional, and absent means the prose did not come from a Piece.** Never written on any other path.
- `QueueEntry.source` gains **two** literals: `'gap-declared'` (the person inserted the gap) and `'gap-fill'` (the model marked it). Both land now; pass 2 is the first minter of the second.

**The gap link, and every hop it makes.** Q-39 clears a Gap when the person places a snippet, and the snippet on offer is the one that answered that gap's question — so a harvested Snippet has to be able to name the Gap it came from. One optional field would be easy and inert; the mirror the register asks for is `questionSource`, which reaches Provenance by crossing four types and five call sites, and **all of them are in this task**:

| Hop | Where | Shape |
|---|---|---|
| 1. the question knows its gap | `QueueEntry.gap?: string` | Set at mint by T6's gap route. Exactly the shape of `QueueEntry.claim?`, which exists for the same reason — Q-31's "one still-true question per flagged Claim" is not expressible without the Claim id on the entry, and "which Gap does this answer belong to" is not expressible without this one. `#write` and `#parseEntry` in `src/queue/queue.ts` must round-trip it under a guard, beside `claim`. |
| 2. the asking turn carries it | `Turn.gap?: string` | Two paths, and only one of them has a Turn literal — see below. |
| 3. the cut carries it | `CutProposal.gap?: string` | Copied from the probe turn in `propose()` at `src/harvester/harvester.ts:559`, beside the existing `...(probe?.questionSource ? … : {})`. |
| 4. the snippet keeps it | `Provenance.gap?: string` | Spread in `decide()` at **both** write sites — `src/harvester/harvester.ts:636` (approve/trim) and `:677` (restate). The restate path is not optional: a restated answer to a gap question is still an answer to that gap, and dropping it there would make the offer vanish for exactly the answers the person took most care over. |

**Hop 2 in full, because the second path has no Turn to edit.** A drawn queue entry becomes an agent Turn two ways, and they are not symmetrical:

- **The opener branch, `src/elicitor/elicitor.ts:149-156`** — builds the `Turn` literal inline. One conditional spread there and it is done.
- **`drawFallback`, `src/elicitor/elicitor.ts:468-475`** — has no Turn literal at all. It calls `emitProbe`, which builds `agentTurn` internally. So three edits, not one:
  1. Widen `emitProbe`'s opts from `{ source?: QuestionSource; targetFacet?: Facet }` to add `gap?: string`.
  2. Add `...(opts?.gap ? { gap: opts.gap } : {})` to the `agentTurn` literal inside `emitProbe`, beside the existing `...(opts?.source ? { questionSource: opts.source } : {})`.
  3. Pass it at the `drawFallback` call — `...(queueDraw.gap ? { gap: queueDraw.gap } : {})` — beside the `targetFacet` spread already there.

  **`targetFacet` is the wrong half of that opts object to reason from.** It never reaches the Turn: `emitProbe` puts `source` on `agentTurn` and `targetFacet` on the returned `Probe`. `source` is the half that models this hop, and `gap` follows `source` exactly.

Every hop is a conditional spread, never a present key holding `undefined`. **Absent means the snippet did not come from a gap question** — it is never read as anything else, nothing filters on it, and no model sees it. Q-4 holds: the link is Provenance frontmatter and never enters the Snippet body.

`src/queue/queue.ts`:
- `export function isUserDeclaredWeight(e: QueueEntry): boolean` — true for `'user-declared'` and `'gap-declared'`, false for everything else including `'gap-fill'`.
- Called at exactly two sites: the `candidates.sort()` priority key in `draw()` (currently `a.source === 'user-declared' ? 0 : 1`) and `runChain`'s rung-2 relaxation (currently `e.source === 'user-declared'`).
- **`expire()` is NOT changed.** It keeps testing the literal `'user-declared'`, so both gap sources expire at 30 days like any agent-minted entry. That asymmetry is the whole point of the task; a comment above `expire()`'s guard says so, naming Q-41.
- `#parseEntry` / `#write`: `source` needs no change — it is written unconditionally and read back as-is. **`gap` does**, under a guard, beside `claim` at `src/queue/queue.ts:232` and `:193`. Assert both round-trips.

`src/queue/source-label.ts`:
- `SOURCE_LABELS` is `Record<QueueEntry['source'], string>`, so **the build is red until both literals have a label.** `'gap-declared'` reads as the person's own act (the register's `'user-declared'` entry reads `you set this aside`; this one is its sibling). `'gap-fill'` reads `from your own words`, matching the four that already do, because a model-marked gap's question quotes an adjacent paragraph verbatim. Q-15 governs both: nothing here may accuse, and neither may announce itself as a gap.

**Behavioral invariants:**
- No existing source literal changes behaviour: a `'user-declared'` entry still sorts first, still relaxes at rung 2, still never expires.
- **The gap link is verified by arrival, not by declaration.** The test that matters follows one gap id from `queue.add` through a real drawn turn and a real harvest into a snippet file on disk. A test that only asserts the field compiles would pass over a product where hop 2 was never written.
- Nothing outside this chain reads `gap`. `src/wiki/status.ts:231` reads `provenance.questionSource` and is untouched.
- Widening `Provenance.kind` must not break any exhaustive read of it. **Grep before editing** — `grep -rn "provenance.kind\|kind: 'harvest'\|kind: 'unprompted'\|kind: 'restatement'" src/ web/ tests/` — and if a `switch` over the union exists anywhere, handle the new arm in the same commit or stop and report.
- `QueueEntry.source`'s doc comment at `src/types.ts:240` claims nothing switches over the union. `source-label.ts` is a `Record` keyed by it, which is the same obligation by a different mechanism. **Update that comment** so the next widener is not told the wrong thing.
</contracts>

**Skill:** `tdd`
**Files:**
- Modify: `src/types.ts`, `src/queue/queue.ts`, `src/queue/source-label.ts`, `src/elicitor/elicitor.ts` (hop 2 only), `src/harvester/harvester.ts` (hops 3 and 4 only)
- Test: `tests/queue.test.ts` (extend), `tests/queue-source-label.test.ts` (extend), `tests/gap-link.test.ts` (new — the arrival test)

- [ ] **Step 1: Grep for exhaustive readers of `Provenance.kind` and `QueueEntry.source`** before writing anything. Record what you find in the commit message. A `switch` with no `default` over either union is a compile break waiting in another agent's file.
- [ ] **Step 2: Failing tests** in `tests/queue.test.ts` — a `gap-declared` entry sorts ahead of a `composed` entry of the same age in `draw()` while a `gap-fill` entry does **not**; a `gap-declared` entry is admitted by rung 2 when sharpness would have excluded it, and a `gap-fill` entry is not (assert the `queue-rung` event names the relaxed filter in the first case and is absent in the second); **a pending entry of either gap source older than 30 days IS expired by `expire(30)` while a `user-declared` entry of the same age is not**; both literals round-trip through `#write`/`#parseEntry`. In `tests/queue-source-label.test.ts`: `sourceLabel` returns a non-empty label for every member of the union, and no label contains the substring `gap`.
- [ ] **Step 2a: The arrival test** — `tests/gap-link.test.ts`, and it must drive the product rather than stage the state. Mint a queue entry with `source: 'gap-declared'` and `gap: <id>` through `queue.add`; start a session so the entry is **drawn** by `startSession`/`drawFallback`; answer it through `userTurn`; harvest through `propose`/`decide` with a scripted fake; then assert the snippet **on disk** carries `provenance.gap === <id>`. Then the same flow with a `restate` decision, asserting the restated snippet carries it too. **`grep -n 'provenance: {' tests/gap-link.test.ts` must return nothing** — a hand-built Provenance proves hop 4 and nothing else.
- [ ] **Step 3: Run** — `npx vitest run tests/queue.test.ts tests/queue-source-label.test.ts tests/gap-link.test.ts` Expected: FAIL.
- [ ] **Step 4: Implement** all five files, plus the corrected comment at `src/types.ts:240`.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run` Expected: both pass, **including every pre-existing test**. A red test outside the two extended files means the union widening hit an exhaustive reader: stop and report rather than editing that file.
- [ ] **Step 6: Verify the asymmetry is load-bearing, as an exit code** — `[ $(grep -c "isUserDeclaredWeight" src/queue/queue.ts) -ge 3 ]` Expected: exit 0. The floor is 3 rather than an exact count because the sort's minimal diff replaces **two** lines — `const aUd = a.source === 'user-declared' ? 0 : 1;` and its `bUd` twin at `src/queue/queue.ts:317-318` — so one definition plus two sort lines plus `runChain` is 4, and a rewrite that hoists the key into one call is 3. Both are correct; fewer than 3 means a call site was missed. Then `grep -A2 "source === 'user-declared'" src/queue/queue.ts | grep -q "continue"` Expected: exit 0 — the literal survives in `expire()` and nowhere else.
- [ ] **Step 6a: Verify every hop exists, as an exit code** — `[ $(grep -c "gap" src/elicitor/elicitor.ts) -ge 4 ] && [ $(grep -c "gap" src/harvester/harvester.ts) -ge 3 ]` Expected: exit 0. The elicitor floor is **4**, not 2: the opener Turn spread, `emitProbe`'s widened opts, the `agentTurn` spread inside it, and the `drawFallback` call site. The baseline is 0, so a floor of 2 passes on the opener branch alone — which is precisely the path that leaves `drawFallback` unwired and the offer empty for every gap question drawn mid-sitting. The harvester floor is 3: one `propose()` copy and both `decide()` spreads. A field declared in `types.ts` with a low count here is the inert-parameter failure, and Step 2a is what makes it red.
- [ ] **Step 7: Commit** — `git commit -m "feat: composition provenance, the two gap sources, and the gap link end to end"`

---

### Task 2: The Piece contract — types, and the five guards every write passes through [CHANGE SITE]

**Orient:** This file is where Q-1 becomes structural rather than a rule someone remembers. An Arrangement is an ordered list of pins and gaps plus Marginalia, and there is no field on any of these types that can hold a sentence the agent wrote — no title, no transition, no body. A later task that wants to add one is proposing to break Sole Authorship, and the type will say so at compile time.
**Flow position:** Wave 0 — parallel with T1, disjoint files. T3, T4, T5, T6 and T11 all compile against this.
**Q-refs:** Q-1 (no agent prose, no titles — a title is body text), Q-5 (pinned versions are immutable, so a pin names a version and never "latest"), Q-38 (≤3 candidates, principles pairwise distinct), Q-39 (a Gap holds exactly one question id), Q-41 (set-down is a nullable timestamp, never a done flag), Q-3 (these types are what the markdown holds).

<contracts>
**Downstream — the exported shapes:**

```ts
export type Principle = 'chronology' | 'argument' | 'contrast';

export type Pin = { id: string; kind: 'pin'; snippet: string; version: number };
export type Gap = {
  id: string;
  kind: 'gap';
  /**
   * The QueueEntry this gap minted. Absent = nothing was minted (set down, or
   * not yet chosen). Also the join key that finds the gap's answer: the entry
   * carries this Gap's own id, and so does the Provenance of every Snippet
   * harvested from the answer (Q-39, threaded by T1).
   */
  question?: string;
  /**
   * A model-marked gap's verified question text, waiting to be minted at choose
   * time. NEVER set on a user-inserted gap — the person's question is minted at
   * once. Not Piece text and not Marginalia; the exporter omits every gap whole.
   */
  pending?: string;
};
export type ArrangementEntry = Pin | Gap;

export type MarginaliaNote = 'principle' | 'role' | 'stale-pin';
export type Marginalia = {
  id: string;
  /** The entry this annotates, or null for the Arrangement as a whole. */
  on: string | null;
  note: MarginaliaNote;
  text: string;
  at: string;
  model?: string;          // Q-34 — absent when no model wrote it
};

export type Arrangement = {
  id: string;
  principle: Principle;
  entries: ArrangementEntry[];
  marginalia: Marginalia[];
  created: string;
  model?: string;
};

export type Piece = {
  id: string;
  created: string;
  /** Absent = picked up. Present = set down (Q-41). There is no done flag. */
  setDownAt?: string;
  setDownBy?: 'user' | 'dormancy';
  /** The Arrangement the surface renders; always an id in `arrangements`. */
  current: string;
  arrangements: Arrangement[];
};

export interface PieceStore {
  create(entries: ArrangementEntry[]): Piece;
  get(id: string): Piece | null;
  list(): Piece[];
  /** Replaces one Arrangement whole. The only write path for entries. */
  putArrangement(pieceId: string, a: Arrangement): Piece;
  addArrangement(pieceId: string, a: Arrangement): Piece;
  setCurrent(pieceId: string, arrangementId: string): Piece;
  setDown(pieceId: string, by: 'user' | 'dormancy'): Piece;
  pickUp(pieceId: string): Piece;
}
```

**The five guards.** Each returns `null` when clean and a reason string when not; the store calls all five before every write and throws on the first reason.

1. `noProse(a: Arrangement): string | null` — every entry is a `pin` or a `gap` and carries no key outside its declared shape. An entry with an extra string field is agent prose smuggled into the body.
2. `noTitle(a: Arrangement): string | null` — no `title` key on the Arrangement, on any entry, or on any Marginalia. Q-1: a title is body text.
3. `pinsResolve(a: Arrangement, snippets: Record<string, Snippet>): string | null` — every pin's `snippet` exists and its `version` is ≥ 1 and ≤ the snippet's latest version. **A pin to a version that does not exist is refused; a pin to an OLDER version than the latest is fine and is not a finding here** (Q-5, Q-39 — keeping an old pin is deliberate).
4. `samePinSet(base: ArrangementEntry[], candidate: ArrangementEntry[]): string | null` — the candidate's pins are a permutation of the base's, by `snippet@version`. Used only on model output (T11); a user reorder trivially satisfies it and a user removal does not go through it.
5. `distinctPrinciples(candidates: Arrangement[]): string | null` — at most 3, and no principle appears twice (Q-38: never shuffles of one).

**Behavioral invariants:**
- The module is pure. No I/O, no clock beyond what a caller passes, **no `Complete` anywhere in any signature.**
- Guards never repair. A bad Arrangement is refused whole; nothing is silently dropped from inside one.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/contract.ts`
- Test: `tests/piece-contract.test.ts`

- [ ] **Step 1: Failing tests** — an entry carrying an extra `text` field fails `noProse` with a reason naming the field; a `title` on the Arrangement, on an entry, and on a Marginalia each fail `noTitle`; a pin to `v4` of a snippet whose latest is `v3` fails `pinsResolve` while a pin to `v1` of that same snippet passes; a candidate that adds one pin, one that drops one, and one that changes a pin's version each fail `samePinSet`, while a pure permutation passes; two candidates both claiming `chronology` fail `distinctPrinciples`, four candidates fail it, and `[chronology, argument]` passes; **the module exports nothing that takes a `Complete`** (assert with `@ts-expect-error` on passing one to each guard).
- [ ] **Step 2: Run** — `npx vitest run tests/piece-contract.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run tests/piece-contract.test.ts` Expected: both pass. Then assert the zero-LLM contract for the whole namespace as an exit code: `! grep -rqE 'Complete|complete\(|pi-ai|llm' src/piece/` Expected: exit 0.
- [ ] **Step 5: Verify no field can hold a sentence** — `! grep -qE '\b(title|body|prose|transition|text)\??:' <(grep -A8 "export type Pin\|export type Gap\|export type Arrangement =\|export type Piece =" src/piece/contract.ts)` Expected: exit 0. `Marginalia.text` is exempt and lives outside those four blocks by design.
- [ ] **Step 6: Commit** — `git commit -m "feat: the Piece contract and its five guards"`

---

### Task 3: PieceStore — markdown persistence with an empty body [CHANGE SITE]

**Orient:** Q-3 makes the markdown the truth, and this is the only module that writes it. The body of every file it writes is empty, deliberately: a Piece file with a body is a place for a title or an agent sentence to appear later, and the shortest way to guarantee that never happens is to have nowhere to put it.
**Flow position:** Wave 1 — consumes T2's types and guards; T6 and T10 consume this interface.
**Q-refs:** Q-3 (markdown is truth, indexes derived), Q-1 (empty bodies), Q-41 (`setDownAt` is nullable and reversible; nothing is ever deleted), Q-61 (these files land in the vault git repo and are committed by the next Docket run).

<contracts>
**Upstream (T2 → this):** the `PieceStore` interface and the five guards, imported by name.

**Downstream (this → T6, T10):** `createPieceStore(root: string): PieceStore`, mirroring `createVault` / `createQueueStore`.

**On-disk shape**, exactly as *Storage layout* above specifies: `vault/pieces/<pieceId>/piece.md` and `vault/pieces/<pieceId>/arrangements/<aid>.md`, written with `matter.stringify('', fm)`, read with `matter.read`.

**Behavioral invariants:**
- **Every optional frontmatter field is written under a guard, never as a present key holding `undefined`** — `matter.stringify` throws on that and the whole write is lost. `src/queue/queue.ts:230` is the pattern to copy, verbatim in spirit.
- `pickUp` **removes** `setDownAt` and `setDownBy` from the frontmatter rather than writing `null`. An absent key and a key holding null are different facts, and only the first means "picked up".
- `putArrangement` runs `noProse`, `noTitle` and `pinsResolve` before writing and throws on the first reason. Nothing reaches disk unvalidated.
- **Nothing deletes.** `remove` on the route side rewrites an Arrangement without one entry; the store has no `unlink` and no `delete` method, matching the claim store's posture.
- `list()` and `get()` rebuild from the files alone (Q-3) — no cache, no index.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/store.ts`
- Test: `tests/piece-store.test.ts`

- [ ] **Step 1: Failing tests** — `create` writes a piece dir with `piece.md` and one arrangement file, both with **empty bodies** (assert `matter.read(...).content.trim() === ''` on each); a round-trip through `get` returns deep-equal entries including entry ids; `setDown` then `pickUp` leaves the frontmatter with **no `setDownAt` key at all** (assert `'setDownAt' in data === false`, not `data.setDownAt === undefined`); `putArrangement` with an entry carrying a stray `text` field throws with the guard's reason; a piece with three arrangements round-trips all three and `current` still names the right one; `list()` on a root with no `pieces/` dir returns `[]` rather than throwing.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-store.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run tests/piece-store.test.ts` Expected: both pass. Then `! grep -qE 'unlinkSync|rmSync|rmdirSync' src/piece/store.ts` Expected: exit 0 — nothing here deletes.
- [ ] **Step 5: Commit** — `git commit -m "feat: PieceStore — pieces as markdown in the vault"`

---

### Task 4: The chronological Arrangement — deterministic, and dated by the sitting [CHANGE SITE]

**Orient:** The one Arrangement pass 1 produces, and the reason pass 1 needs no model at all. It is a pure function from a set of snippets to an ordered list of pins, and it must be dated by the **sitting** rather than by capture time — Q-59 says the date is the only thing that makes an imported sitting independent evidence, so a 2018 essay harvested yesterday belongs in 2018, not at the top of the stack.
**Flow position:** Wave 1 — parallel with T3 and T5, disjoint files. T6 calls it once, at Piece creation.
**Q-refs:** Q-59 (the sitting's date, never the import's), Q-5 (a pin names the version that was latest when it was pinned, and stays there), Q-3 (the transcript frontmatter it reads is the truth).

<contracts>
**Downstream:** `chronological(snippets: Snippet[], startedOf: (session: string) => string | null): Pin[]`

- Order: ascending by the snippet's **sitting start date**, taken from `startedOf(s.provenance.session)`. When that returns null — no transcript for the session — fall back to `s.captured`, and never guess anything else.
- Tie-break: snippet id ascending. ULIDs are monotonic, so this is a stable, meaningful second key and makes the function **deterministic**: the same input yields the same output, byte for byte, on every call.
- Each pin gets a fresh `ulid()` entry id and pins the snippet's **current** version — the version that is latest at pin time. It does not track later versions (Q-5, Q-39).
- `startedOf` is injected rather than read here, so this module never touches the filesystem. `src/server.ts` already has `listSessions(root)` returning `{ session, started }`; T6 adapts it.

**Behavioral invariant:** pure, no clock except `ulid()`, no I/O, no model. Given the same snippets and the same `startedOf`, the pin order is identical.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/arrange.ts`
- Test: `tests/piece-arrange.test.ts`

- [ ] **Step 1: Failing tests** — three snippets from sittings dated 2018, 2022 and 2026 order 2018 → 2026 **even when their `captured` timestamps are all today** (this is the Q-59 case and it is the whole point); a snippet whose session has no transcript falls back to `captured` and is not dropped; two snippets from the same sitting tie-break by id, stably, across two calls; the returned pins carry distinct entry ids and the snippets' current versions; an empty input returns `[]`.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-arrange.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run tests/piece-arrange.test.ts` Expected: both pass. Then `! grep -qE "readFileSync|readdirSync|node:fs" src/piece/arrange.ts` Expected: exit 0 — the dates arrive through the parameter or not at all.
- [ ] **Step 5: Commit** — `git commit -m "feat: the deterministic chronological arrangement"`

---

### Task 5: Export — the person's sentences, in order, and nothing else [CHANGE SITE]

**Orient:** The artifact that leaves the app. Q-1's guarantee is at its strongest here: the file contains the pinned versions' prose and not one other word — no title, no Marginalia, no gap marker, no frontmatter, no agent sentence. If a reader of the exported file can tell an agent was involved, this function is wrong.
**Flow position:** Wave 1 — parallel with T3 and T4. T6 serves its output.
**Q-refs:** Q-1 (no agent prose, no titles), Q-5 (the **pinned** version's prose is inlined, not the latest — a stale pin exports the old words on purpose, and Q-39 says why), Q-3.

<contracts>
**Downstream:** `toMarkdown(a: Arrangement, versions: (snippet: string, version: number) => string | null): string`

- Pins render as their pinned version's prose, in `entries` order, separated by one blank line.
- **Gaps render as nothing.** Not a marker, not a comment, not a rule. The exported file is the person's words; a gap is a fact about the draft, not about the text.
- **Marginalia render as nothing.** They are never part of the Piece text (CONTEXT: Marginalia).
- **No frontmatter, no heading, no separator, no trailing metadata.** The file begins with the first sentence.
- A pin whose version cannot be resolved throws rather than silently exporting a hole. An export missing a paragraph with no complaint is worse than a failed export.
- Output ends with exactly one trailing newline.

**Behavioral invariant:** `toMarkdown` is a pure function of the Arrangement and the resolver. Reordering the entries reorders the output and changes nothing else.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/export.ts`
- Test: `tests/piece-export.test.ts`

- [ ] **Step 1: Failing tests** — three pins export as three paragraphs, blank-line separated, in entry order; a Gap between two pins leaves **no trace at all** in the output (assert the output equals the same arrangement with the gap removed, byte for byte); an arrangement carrying three Marginalia exports identically to one carrying none; the output starts with the first snippet's first character (assert no `---` and no `#` anywhere); a pin to `v1` of a snippet whose `v2` exists exports **v1's** prose; an unresolvable pin throws.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-export.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run tests/piece-export.test.ts` Expected: both pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: export a Piece as the person's words alone"`

---

### Task 6: The piece routes — the pass-1 verbs, one mint, one export [CHANGE SITE]

**Orient:** Every pass-1 verb, behind the existing password gate. Two of them carry the invariants that matter most: writing prose in a Piece creates a Snippet with composition provenance (Q-40, no second class of words), and inserting a Gap mints **exactly one** queued question (Q-39) — unless the Piece is set down, in which case the Gap is inserted and nothing is minted, because setting down stops minting and leaves the Arrangement fully editable (Q-41).
**Flow position:** Wave 2 — consumes T2's guards, T3's store, T4's `chronological`, T5's `toMarkdown`. T7 renders it; T8 exercises it end to end.
**Q-refs:** Q-40 (user prose in a Piece becomes a Snippet), Q-39 (exactly one question per Gap; user-declared weight), Q-41 (set-down stops minting; the Arrangement stays editable), Q-50 (composition prose gets its own session, so its cites are independent of the sittings that produced its neighbours), Q-23 (every act logged), Q-25 (the routes sit behind the existing auth middleware), Q-60 (a gap question carries no guessed Target), Q-12 (a user-written gap question is the user's words and is exempt from the composed-question quote gate — see below), Q-3.

<contracts>
**Upstream:** `createPieceStore(root)`, `chronological()`, `toMarkdown()`, the five guards, `deps.vault`, `deps.queue`, and `listSessions(root)` already in `src/server.ts`.

**The pinned-version resolver, which nothing in the tree implements yet (issue 2).** `toMarkdown` takes `versions: (snippet, version) => string | null` and `GET /api/piece/:id` needs the same function, and **`Vault` cannot supply it**: `rebuildIndex()` reads only the newest `v<N>.md` per snippet directory and returns one `Snippet` per id, so every pin would resolve to the latest text and the pinned-version invariant — the highest-value line in the slice, and the thing Q-5 and Q-39 both rest on — would be silently untrue. Nobody would see it until a snippet had a second version, which is exactly when it matters.

So T6 writes it, in `src/server.ts`, following the `listSessions` precedent at `src/server.ts:238` — a small file-reading helper beside its callers rather than a new `Vault` method, because widening `Vault` is another agent's contended seam and this reads one file by a path it already knows:

```ts
/** One snippet version's prose, by path. Older versions stay on disk (Q-5). */
function readVersion(root: string, snippetId: string, version: number): string | null {
  try {
    return matter.read(join(root, 'snippets', snippetId, `v${version}.md`)).content.trimEnd();
  } catch { return null; }
}
```

`matter` and `join` are already imported at `src/server.ts:5-6`. `.trimEnd()` matches what `rebuildIndex` does to a snippet's prose, so a pin to the current version resolves byte-identically through either path — and `tests/piece-routes.test.ts` asserts exactly that, because a resolver that disagrees with the index on the easy case will disagree on the hard one too.

**Eleven endpoints, in ten rows** — `set-down` and `pick-up` share a row because they are one verb and its undo. All sit **after** the auth middleware at `src/server.ts:512`, with the other authenticated routes.

| Route | Body | Effect |
|---|---|---|
| `POST /api/piece` | `{ snippets: string[] }` | `chronological()` over those snippets → `store.create()`. Logs `piece-started`. |
| `GET /api/pieces` | — | Every Piece, with its current Arrangement's pins resolved to prose, for the chooser. |
| `GET /api/piece/:id` | — | One Piece: entries in order, each pin resolved to its **pinned** version's prose and its sitting date, plus Marginalia. |
| `POST /api/piece/:id/reorder` | `{ arrangement, entries: string[] }` | Reorders by entry id. Refuses if the id set differs from what is on disk — a reorder that adds or drops is not a reorder. |
| `POST /api/piece/:id/remove` | `{ arrangement, entry }` | Rewrites the Arrangement without that entry. A removed Gap's question is **left in the Queue to expire on the normal rule** (Q-41) — there is no retract verb anywhere in this design and this slice does not invent one. |
| `POST /api/piece/:id/prose` | `{ arrangement, text, after? }` | See below. Logs `piece-prose-kept`. |
| `POST /api/piece/:id/gap` | `{ arrangement, gap, after?, question }` | See below. `gap` is a **client-minted ULID** and the route is idempotent on it. Logs `gap-inserted` and, when it mints, `gap-question-minted`. |
| `POST /api/piece/:id/gap/accept` | `{ arrangement, gap, snippet, version }` | Replaces the Gap with a Pin to that snippet, in the same position. See *How a Gap clears* below. Logs `gap-cleared`. |
| `POST /api/piece/:id/set-down`, `/pick-up` | — | `store.setDown(id, 'user')` / `store.pickUp(id)`. Logs `piece-set-down` / `piece-picked-up`. |
| `GET /api/piece/:id/export` | — | `toMarkdown()` as `text/markdown` with a `Content-Disposition` filename. Logs `piece-exported`. |

**`POST /api/piece/:id/prose` — the Q-40 path, and it reuses the unprompted-entry shape at `src/server.ts:785` deliberately:**

1. Mint a `sessionId`, `vault.startTranscript(sessionId, { mode: { minutes: 0, energy: 'medium' }, protocol: 'composition', started: at })`, `vault.appendTurn(sessionId, turn)`. **A composition act is its own sitting.** That is what makes Q-50's independence predicate — which resolves a cite to `Provenance.session` — read a Piece paragraph as independent of the sittings that produced the paragraphs around it.
2. `vault.saveSnippet(text, { kind: 'composition', session: sessionId, question: '', questionForm: 'deliberative', piece: pieceId })`. `question` is the empty string exactly as the unprompted path uses it: nothing asked for these words.
3. **No reading is written.** See *The reading-less snippet* above; this is a known hole with a ticket, not an oversight.
4. Append (or insert after `after`) a Pin to that snippet at version 1.
5. **The text is the Snippet, verbatim, uncut.** No model, no proposal, no substring check — there is nothing to check, because no agent touched the words. One paragraph in, one Snippet out.
6. Never log the text. Log `chars=` only, as `unprompted-entry` does.

**`POST /api/piece/:id/gap` — the Q-39 path:**

1. Insert a `Gap` entry at the requested position.
2. **If `piece.setDownAt` is present, stop here.** The Gap exists, the Arrangement is editable, and nothing is minted (Q-41).
3. Otherwise mint **exactly one** `QueueEntry` through `deps.queue.add(draft)` — **the only mint path in this slice.** Nothing here writes a queue file directly, and nothing mints anywhere else in `src/piece/`; the store has no `QueueStore` and cannot reach one. Draft: `source: 'gap-declared'` (the person inserted this gap — `'gap-fill'` is the model's literal and pass 1 never mints it), `license: 'arrangement-gap'`, `question` = the text the person typed, `questionForm: 'deliberative'`, `sharpness: 'weak'`, `horizon: 'session'`, and **no `target`, no `topic`, no `targetFacet`** — absent is not a guess (Q-60). Store the returned entry's id on the Gap.
4. The question is **the person's own words**, so `src/clerk/composed.ts`'s quote gate does not apply and is not called. Q-12 binds questions the *agent* composes; a question the person typed cannot misquote them.

**How a Gap clears, and why this is the end of `insert-Gap` rather than a new verb (Q-39).** Q-39 says a gap "clears only when the USER places a snippet; a fitting later harvest may be offered in the margin, never auto-placed", and the mechanism is already fully specified by the register: the Gap minted one Queue question, that question gets drawn and answered in an ordinary sitting like any other, and the Snippet harvested from that answer is offered in the Piece's margin. Accepting the offer is the placing act.

Two things keep this from becoming a general placement verb, which is what would put it outside ticket 010's locked list:

1. **`GET /api/piece/:id` computes the offer; the client never searches.** For each Gap carrying a `question` id, the offer is every Snippet whose `provenance.gap` equals that Gap's id — the link T1 threaded. No scoring, no similarity, no ranking: it is an exact join on an id the system wrote itself. An empty join is the ordinary case and renders as nothing. (The shaping happens server-side, as `src/server.ts:909`'s comment already requires of every surface.)
2. **`/gap/accept` verifies rather than trusts.** The body names a snippet, because one answer can harvest into several cuts and the person picks which one belongs there. The route then checks `snippet.provenance.gap === gap` and **refuses anything else with 400.** So the route cannot place an arbitrary snippet into an arbitrary hole; it can only complete a link the person's own answer created. "Never auto-placed" is satisfied because nothing places without the POST, and "clears only when the USER places a snippet" is satisfied because the POST is the person's.

Accepting rewrites the Arrangement with a Pin in the Gap's position (same index, fresh entry id), through `putArrangement` like every other write. The Gap's queue entry is already `answered` — the sitting did that — so nothing here touches the Queue. A set-down Piece accepts an offer exactly as a picked-up one does: Q-41 stops *minting*, and this mints nothing.

**Exactly one question per gap, and how the route can actually tell (issue 4).** The body carries a **client-minted `gap` ULID**, and the route is idempotent on it: if an entry with that id already exists in the arrangement, the route mints nothing, inserts nothing, and returns the Piece unchanged with 200. Without that key the route has no gap identifier at all — every POST would create a fresh gap, so a double-submit would silently produce two gaps and two questions while "exactly one question per gap" stayed vacuously true. A 409 was the first instinct and is the wrong verb: the second POST is the *same* request arriving twice, not a conflicting one, and a client that retries on a dropped connection should get the state it asked for rather than an error. The invariant is then enforceable in one line — **a Gap that already carries a `question` id never mints again** — and Q-39 is satisfied by the data rather than by the handler remembering.

**`src/log/format.ts`:** one plain sentence for each of `piece-started`, `piece-prose-kept`, `gap-inserted`, `gap-question-minted`, `gap-cleared`, `piece-exported`, `piece-set-down`, `piece-picked-up`, and one sample per kind appended to `EMITTED` in `tests/log-format.test.ts`. **No sentence may contain an identifier** — `scrubIds` runs on every path and the test asserts it.

**Behavioral invariants:**
- Every write goes through `PieceStore`, so every write passes the guards.
- No route mutates a Snippet. Ever.
- A set-down Piece accepts reorder, remove, prose and gap-insert exactly as a picked-up one does. The **only** difference is that gap-insert mints nothing (Q-41).
</contracts>

**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` (append routes only), `src/log/format.ts` (append sentences only)
- Test: `tests/piece-routes.test.ts` (new), `tests/log-format.test.ts` (extend `EMITTED`)

- [ ] **Step 1: Failing tests** in `tests/piece-routes.test.ts`, against a real `createApp` with `ELICIT_LLM=fake` and a temp vault —
  - `POST /api/piece` with three snippets from three sittings returns them in sitting order.
  - `POST /prose` writes a snippet whose `provenance.kind` is `'composition'`, whose `piece` is the piece id, and whose `session` is **a new session with its own transcript on disk**; the prose appears in the arrangement as a pin at v1; the text appears **nowhere** in the activity log (assert on the log file's bytes).
  - `POST /gap` mints exactly one queue entry with `source: 'gap-declared'` and no `target`, and the entry's id is on the Gap. **The same POST sent twice with the same `gap` id yields one gap and one queue entry** (200 both times, the second a no-op), while two POSTs with different `gap` ids yield two of each.
  - **The pinned-version resolver:** a snippet with `v1` and `v2` on disk, pinned at `v1`, comes back from `GET /api/piece/:id` and out of `GET /export` as **v1's** prose — and a pin at the current version resolves byte-identically to what `vault.rebuildIndex()` reports for that snippet. This is the assertion that fails loudly if anyone routes pins through the index instead of `readVersion`.
  - `POST /set-down` then `POST /gap` inserts the Gap and mints **nothing** — `queue.list({ source: 'gap-declared' })` is unchanged (this is Q-41's exact wording, tested).
  - `POST /pick-up` then `POST /gap` mints again.
  - `POST /remove` on a Gap leaves its queue entry present and `pending`.
  - **The gap offer and its clearing:** a Gap whose queue entry was answered, plus a snippet on disk carrying `provenance.gap` equal to that Gap's id, makes `GET /api/piece/:id` return that snippet as the Gap's offer — and a snippet with **no** `gap` in its provenance, however similar its text, is **not** offered. `POST /gap/accept` with that snippet replaces the Gap with a Pin at the same index; the queue entry is untouched. `POST /gap/accept` naming a snippet whose `provenance.gap` is absent or different returns **400** and the Arrangement is unchanged on disk. Accepting on a set-down Piece succeeds and mints nothing.
  - `GET /export` returns `text/markdown` whose body contains every pinned paragraph and **no `#`, no `---`, and no Marginalia text**.
  - Every route returns 401 without a session cookie.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-routes.test.ts` Expected: FAIL
- [ ] **Step 3: Implement `readVersion` and the routes**, appending to `src/server.ts` after the auth middleware. Re-read the file first — it is contended.
- [ ] **Step 3a: Verify the resolver is the one in use, as an exit code** — `[ $(grep -c "readVersion" src/server.ts) -ge 3 ]` Expected: exit 0 — one definition and at least two call sites (`GET /api/piece/:id` and `GET /export`). Then `! grep -n "toMarkdown(.*rebuildIndex" src/server.ts` Expected: exit 0 — the index never stands in for a pinned version.
- [ ] **Step 4: Add one sentence per new kind** to `src/log/format.ts` and one sample per kind to `EMITTED` in `tests/log-format.test.ts`. Append; reword nothing.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run` Expected: all pass, including `tests/log-format.test.ts`'s derived sweep, which fails both on a kind with no sentence and on a sentence for a kind nothing emits.
- [ ] **Step 6: Verify no identifier reaches the surface** — the sweep test already asserts it; confirm by `npx vitest run tests/log-format.test.ts -t "no formatted line contains a ULID"` Expected: PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat: the piece routes — compose, gap, set down, export"`

---

### Task 7: The Piece surface — a page of text you can rearrange [CHANGE SITE]

**Orient:** The arrangement IS the draft. Not a list of cards with drag handles beside a preview pane — the paragraphs themselves, in a column, and you move one by picking it up. Read `docs/interface-references.md`'s document rule before writing a line: the first wireframe pass failed by accretion into "an admin panel in quiet colors", and a button row on this screen is that failure returning.
**Flow position:** Wave 2 — after T6's routes. T8 exercises the flow behind it; T12 adds one margin word in Wave 4.
**Q-refs:** Q-9 and the document rule (one column, no chrome, typography does the hierarchy, controls in the margin on focus), Q-24 (no "done", no progress language, dormancy is never debt), Q-41 (the margin words are `set down` and `pick up`), Q-26 (touch targets stay at `--touch-min`), Q-5 (a pinned paragraph is not editable).
**Codebooks:** `gesture-disambiguation`

<contracts>
**Two screens, both added to the `Screen` union and `navTo` at `web/main.ts:102-146`:**

- **`material`** — choosing what a Piece is made of. Your snippets as dated paragraphs in one column, in sitting order, read as continuous prose. **Touching a paragraph selects it** — the ink goes from dim to full, exactly as the harvest surface keeps a span by touching it (Q-58's precedent). No checkboxes, no rows, no per-row controls. One margin word, `compose`, appears once at least one paragraph is lit.
- **`piece`** — the Piece. The pinned paragraphs in `entries` order, in the body serif, at full ink. A **Gap is a thin rule across the measure** carrying the dimmed words `ask me?`; touching it opens one line to type the question into, and Enter mints it (T6's route). **A Gap whose question has since been answered carries its offer in the margin** — the harvested sentence, dimmed, beside the rule; touching it places it and the rule becomes a paragraph (T6's `/gap/accept`). The offer arrives already computed by the route; the client neither searches nor scores. Nothing places itself (Q-39). Margin words, dimmed until the page is focused: `set down` (or `pick up`), and `export`. Marginalia sit in the margin, dimmed until hovered — empty in pass 1, which is why the column exists now and stays quiet.

**Reordering.** The paragraph itself is the drag target: `draggable="true"` on the paragraph element, no handle, no grip affordance, no border appearing on hover. A drop reorders locally and POSTs `/reorder` with the new entry-id order. **Nothing in this surface is both draggable and text-editable** — a pinned Snippet version is immutable (Q-5) and renders as non-editable text, and the one editable thing on the page is the new-prose composer, which becomes a pin the moment it is set down. That is what keeps drag from fighting text selection.

**Writing new prose.** One blank line at the end of the column, in the same serif at the same size, with no label and no border — a `textarea` that grows, exactly like `.blank-page` at `web/style.css:392`. It reads as the next paragraph of the document, because that is what it is about to become. Leaving it commits it through `/prose`; it then re-renders as a pin like any other paragraph.

**`web/main.ts:168`'s `GET_PREFIXES`** must learn `/api/pieces` and the two GET piece paths, or the client will POST to a read route. `isReadPath` matches by prefix and `/api/piece/:id` collides with the POST verbs beneath it — match `/api/piece/` GETs the same way `/api/wiki` is matched today: exactly, plus the `/export` suffix.

**Style.** Reuse the existing tokens (`--font-serif`, `--dim`, `--border`, `--max-w`, `--touch-min`) and the existing type scale. **Add no new component pattern.** A Gap's rule is a `border-top: 1px solid var(--border)`, not a box.

**Behavioral invariants:**
- No `<button>` with a visible box anywhere on either screen. Margin words are `.nav-link`-class text.
- The word "done" does not appear (Q-24, Q-41). Neither does "finished", "complete", "draft status", or a count of anything.
- No dialog, no modal, no confirm. Removing a paragraph removes it; nothing here is destructive, because nothing here deletes a Snippet.
</contracts>

**Skill:** `interface-design:interface-design`
**Files:**
- Modify: `web/main.ts`, `web/style.css`

- [ ] **Step 1: The `material` screen** — snippets as dated paragraphs, touch to light, one margin word.
- [ ] **Step 2: The `piece` screen** — the arrangement as the document, gaps as thin rules, margin words for set down / pick up / export.
- [ ] **Step 3: Drag reordering on the paragraph itself**, then the `/reorder` POST.
- [ ] **Step 4: The trailing composer**, committing through `/prose`.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run && npx vite build` Expected: all three pass. Then, as exit codes:
  - `! grep -nE "drag-handle|piece-card|\.card" web/style.css` Expected: exit 0 — no card, no handle.
  - `! grep -niE "\bdone\b|finished|complete\b" <(sed -n '/── Piece surface ──/,/── end Piece surface ──/p' web/main.ts)` Expected: exit 0 — the shame gradient has no vocabulary here. (Mark the section with those two comments so the check has a span to read.)
- [ ] **Step 6: Look at it** — serve with `ELICIT_LLM=fake`, build a Piece from three snippets, drag one, insert a gap, write a paragraph, export. Confirm it reads as a page of writing rather than a tool. If it reads as a tool, the document rule has been violated: re-read it and rebuild the screen, do not add a setting.
- [ ] **Step 7: Commit** — `git commit -m "feat: the Piece surface — the arrangement is the draft"`

---

### Task 8: Pass 1 end to end — the slice hypothesis, with no model anywhere [CHANGE SITE]

**Orient:** The test that proves Q-42's claim that pass 1 ships complete on its own. It runs the whole flow through the real routes with **no model reachable at all**, and it is written now, before any pass-2 file exists, so that every later wave has a fixed thing to stay additive to.
**Flow position:** Wave 2, last — after T6 and T7.
**Q-refs:** Q-42 (pass 1 complete alone), Q-40, Q-39, Q-41, Q-1, Q-3.

<contracts>
One flow, one describe block, against a temp vault and a real `createApp`:

seed three snippets from three sittings dated 2018 / 2022 / 2026 → `POST /api/piece` → the arrangement is in **sitting** order → reorder the last to the front and read it back **from disk** → `POST /prose` → a fourth snippet exists on disk with `provenance.kind === 'composition'` and its own transcript → `POST /gap` → **exactly one** `gap-declared` entry in the queue, and **zero** `gap-fill` entries, because pass 1 has no model to mark a gap → `POST /set-down` → a second `POST /gap` inserts a Gap and mints **nothing** → `POST /pick-up` → a third `POST /gap` mints again → seed a snippet on disk whose `provenance.gap` is the first Gap's id → `GET /api/piece/:id` offers exactly that snippet on that Gap and offers nothing on the others → `POST /gap/accept` turns the Gap into a Pin at the same index, while an accept naming a snippet with no `provenance.gap` returns 400 → `GET /export` → the markdown holds all five paragraphs in the arrangement's order, with the pinned versions' text, and contains no `#`, no `---`, and nothing from the gaps.

**The gap link is seeded, not elicited, and that is deliberate.** Closing the loop for real means drawing the gap's question in a sitting and harvesting the answer, and a sitting needs a model — so this test writes the answering Snippet to disk with `provenance.gap` already set and exercises the offer and the accept from there. That is not a gap in the coverage: `tests/gap-link.test.ts` (T1) proves the link *arrives* through a real drawn turn and a real harvest, and this test proves the Piece *reads* it. Pass 1 stays zero-LLM in its own code — the sitting that answers a gap question is the product that already shipped, not new model work this slice adds. T14 walks the whole loop once with a real model.

**The model must be unreachable, not merely unused.** Set `ELICIT_LLM=fake` and additionally assert that `deps.complete` was never called: pass a `Complete` that throws, and let the test fail loudly if any route reaches for one. A pass-1 flow that quietly works because a fake answered is not evidence that pass 1 works alone.

Assert on **disk state**, not only on responses: the piece dir exists, the arrangement file's body is empty, the snippet files are unmodified, and nothing was deleted anywhere in the flow.
</contracts>

**Skill:** `none`
**Files:**
- Create: `tests/piece-e2e.test.ts`

- [ ] **Step 1: Write the flow above as one describe block**, with a throwing `Complete`.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-e2e.test.ts` Expected: PASS
- [ ] **Step 3: Verify pass 1 is genuinely model-free, as an exit code** — `! grep -rqE 'Complete|complete\(' src/piece/` Expected: exit 0. Then confirm the throwing-`Complete` assertion exists: `grep -q "throw new Error" tests/piece-e2e.test.ts` Expected: exit 0.
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run` Expected: both pass.
- [ ] **Step 5: Commit** — `git commit -m "test: pass 1 end to end, with no model reachable"`

---

### Task 9: Stale-pin lint — a dimmed flag that never re-pins [CHANGE SITE]

**Orient:** Q-39's hardest line: a stale pin gets a dimmed flag and the pin is **never** auto-updated. Pinning a past self's words can be deliberate, and keeping an old pin against a newer version is itself diachronic signal. This module is shaped like `src/wiki/lint.ts` on purpose — a pure graph function that ADDS an annotation and is incapable of changing a pin, so it can run on every Docket pass forever without doing damage.
**Flow position:** Wave 3 — pass 2's zero-LLM half. Parallel with T10, disjoint files. T10's Docket job performs the consequence.
**Q-refs:** Q-39 (dimmed flag, never auto-repins, the choice is recorded either way), Q-31 (the add-only lint shape this copies), Q-5 (a newer version does not invalidate an older one), Q-27 (a past self's words are evidence, which is why re-pinning would destroy something).

<contracts>
**Downstream:** `stalePins(a: Arrangement, snippets: Record<string, Snippet>): Marginalia[]`

- One `stale-pin` Marginalia per pin whose `version` is **less than** the snippet's current version. `on` is the entry id. `text` names the fact in the register's own words and **no `model` field**, because no model wrote it.
- **This module has no write path.** It returns Marginalia; it does not touch `entries`, and there is no code path anywhere in this slice that changes a pin's `version` without a request from the person.
- Pure and memoryless: given the same arrangement and snippet map it returns deep-equal results, in the same order, on every call. It repeats a finding on every run by design, and the caller (T10) decides what to do about the repetition — dedupe by `(on, note)` before writing.
- **No `Complete` parameter.** That absence is the contract, exactly as in `src/wiki/lint.ts`.

**Behavioral invariant:** deep-equal the input arrangement before and after the call. It is unmutated.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/stale.ts`
- Test: `tests/piece-stale.test.ts`

- [ ] **Step 1: Failing tests** — a pin to `v1` where `v3` exists yields exactly one `stale-pin` Marginalia whose `on` is that entry id and which carries no `model`; a pin to the current version yields none; **the arrangement is deep-equal before and after** and in particular no pin's `version` changed; two calls return deep-equal results; a gap entry yields nothing; the module exports nothing taking a `Complete` (`@ts-expect-error`).
- [ ] **Step 2: Run** — `npx vitest run tests/piece-stale.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run tests/piece-stale.test.ts` Expected: both pass. Then, as exit codes: `! grep -qE 'Complete|complete\(' src/piece/stale.ts` and `! grep -qE '\.version\s*=|version:\s*latest' src/piece/stale.ts` Expected: exit 0 each — nothing here assigns a version.
- [ ] **Step 5: Commit** — `git commit -m "feat: stale-pin lint — flag, never re-pin"`

---

### Task 10: Auto-set-down — silent, logged, reversible, and on the Docket [CHANGE SITE]

**Orient:** Q-41's second half. A Piece nobody has touched in a long time is set down by the system rather than left minting questions into a queue the person is not reading. It is **silent** (Q-22: agent initiative ends at the app's edge — nothing reaches out), **logged** (Q-23: the ledger is what makes background autonomy trustworthy), and **reversible** — picking it up resumes minting, and no flag anywhere says "unfinished".
**Flow position:** Wave 3 — parallel with T9's module, and the owner of both Docket jobs. This is the first and only place the Docket learns Pieces exist.
**Q-refs:** Q-41 (set down, never finished; auto-set-down is silent and logged), Q-22 (zero outbound contact), Q-23 (append-only ledger, rendered), Q-24 (dormancy is signal, never debt — the log sentence must carry no reproach), Q-56 (this is a bound, not a selection mechanism, so it ships live and records every clip), Q-35 (the register entry names its graduation condition), Q-39 (the stale-pin consequence).

<contracts>
**`src/piece/dormancy.ts` — pure:**
`isDormant(p: Piece, lastTouched: string, now: number, days: number): boolean` — true when the Piece is **not already set down** and `lastTouched` is older than `days`. `lastTouched` is passed in, never read here.

**`src/wiki/thresholds.ts` — two register entries.** The file is the project's threshold register despite living under `wiki/`; both follow the shape already there, and the type **requires** a `graduatesWhen` sentence, so both are written here rather than left to the implementer's judgment:

```ts
'piece.dormancyDays': {
  value: 45,
  live: true,
  graduatesWhen:
    'Already live, and the liveness is not what is unearned. Q-35 governs SELECTION mechanisms and this selects nothing; Q-56 says bounds ship live. The consequence is one reversible act — gap-question minting stops and picking the Piece up resumes it (Q-41) — so a shadowed auto-set-down would be no feature at all rather than a cautious one. PROVISIONAL in its VALUE: 45 days is a guess with no evidence behind it. It earns a real number when the log shows how long a real Piece sits between touches, and the first evidence is the T14 run.',
},
'piece.gapsPerCandidate': {
  value: 3,
  live: true,
  graduatesWhen:
    'Already live: a cap on how many gaps one model-proposed Arrangement may mark is a bound, and Q-56 puts bounds in force from birth — a shadowed cap writes "I would have stopped at 3" while the model marks without limit, which is worse than no cap because the mechanism is what generated the work. Every clip emits threshold-clipped, so the value stays honest. It is re-tuned from that record, never from argument.',
},
```

The judgment behind `dormancyDays` being live is stated so it can be overruled, and it is also recorded in Open Questions.

**`src/clerk/docket.ts` — two jobs, each independently try/catch-isolated, both taking no model:**
1. **Stale-pin sweep.** For every Piece, `stalePins()` on its current Arrangement; new findings (deduped by `(on, note)` against the Marginalia already on disk) are written through `putArrangement`. Emits `stale-pin-flagged` with a count. **Never touches a pin.**
2. **Dormancy sweep.** For every Piece, `isDormant()`; a dormant one gets `store.setDown(id, 'dormancy')` and emits `piece-set-down-auto`. Nothing is sent anywhere.

`lastTouched` is the newest of: the Piece's `created`, its current Arrangement's `created`, and the `captured` of any snippet pinned in it. **Not** the activity log — the log is evidence, not a dependency, and a job that fails when the log is unreadable is a job that stops the Docket.

Both jobs are injected structurally, the way `runWikiJobs` is at `src/clerk/docket.ts`'s deps block: optional thunks, absent means no piece work this run, and every caller predating the field behaves exactly as before.

**`src/server.ts` — the production call site, and the reason this task owns a fourth file.** `runDocket(` is invoked in production at exactly one place: `runDocketNow()` at `src/server.ts:377`. Two optional thunks that nothing passes are two mechanisms that never run, and **nothing above would fail** — the unit tests build their own deps object and would stay green over a product where neither piece job has ever executed. This repo has shipped that failure before; the memory note is one line long and says an optional parameter no caller passes tests as done and ships inert. So T10 appends to `src/server.ts`:

- `const pieces = createPieceStore(deps.vaultRoot);` — **already in scope** if T6 constructed it for its routes, which it did. Reuse that binding rather than making a second store over the same directory.
- Two thunks in the `runDocket({...})` argument object, beside `runWikiJobs: runWikiJobsNow`, each closing over `pieces`, `deps.vault.rebuildIndex()` for the snippet map, and the threshold register. Neither receives `clerkComplete`.

Nothing else in `src/server.ts` changes. T6 is finished with the file by Wave 3 and T12 does not open it until Wave 4, so the three owners never overlap.

**`deps.onDocketSettled?.()` at the end of `runDocketNow`'s `finally` block is how a test awaits a real run** — that is the hook T10's wiring test uses instead of a timer.

**`src/log/format.ts`:** one sentence each for `stale-pin-flagged`, `piece-set-down-auto`. The second is the one to write carefully — it says what happened and carries no reproach, no count of days, and no suggestion that anything is owed (Q-24).

**Behavioral invariants:**
- Auto-set-down never announces. Grep the diff for any push, any notification, any email path: there is none in the tree and none is added.
- A set-down Piece is never auto-set-down again (`isDormant` returns false), so the log does not repeat.
- Neither job calls a model. The Docket's `complete` is not passed to either.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/piece/dormancy.ts`, `tests/piece-dormancy.test.ts`
- Modify: `src/wiki/thresholds.ts`, `src/clerk/docket.ts`, `src/server.ts` (append-only: two thunks at the `runDocket(` call), `src/log/format.ts`
- Test: `tests/docket.test.ts` (extend), `tests/piece-routes.test.ts` (extend — the through-`createApp` wiring test), `tests/log-format.test.ts` (extend `EMITTED`)

- [ ] **Step 1: Failing tests** — `isDormant` is false for a Piece touched yesterday, true for one touched 60 days ago, and **false for one already set down**; a docket run over a vault with one dormant Piece writes `setDownAt` and `setDownBy: 'dormancy'` to disk and emits `piece-set-down-auto` exactly once; a second run over the same vault emits it **zero** times; a docket run over a Piece with a stale pin writes exactly one `stale-pin` Marginalia and **the pin's version is unchanged on disk**; a second run writes no duplicate Marginalia; a docket run with a `complete` that throws still completes both piece jobs.
- [ ] **Step 1a: The wiring test, and it must go through `createApp`** — in `tests/piece-routes.test.ts`'s style: build a real app over a temp vault holding one dormant Piece with one stale pin, trigger a docket run the way the product does, await `onDocketSettled`, then assert **on disk** that the Piece is set down and the Marginalia is written. **A test that hand-builds a `runDocket` deps object does not close this issue** — that is the shape that passes over an unwired product, and it is why this step exists as its own line.
- [ ] **Step 2: Run** — `npx vitest run tests/piece-dormancy.test.ts tests/docket.test.ts tests/piece-routes.test.ts` Expected: FAIL
- [ ] **Step 3: Implement** the predicate, the two register entries, the two guarded Docket jobs, **and the two thunks at `src/server.ts`'s `runDocket(` call**. Re-read both files first — both are contended.
- [ ] **Step 3a: Verify the mechanism is wired, as an exit code** — `grep -A25 "runDocket({" src/server.ts | grep -cE "stalePins|piece" ` Expected: ≥ 1 — a thunk reaches the one production call site. A green suite with a zero here means both jobs exist and neither runs.
- [ ] **Step 4: Add the two log sentences and their `EMITTED` samples.** Read `piece-set-down-auto`'s sentence out loud; if it sounds like a reminder, rewrite it (Q-24).
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run` Expected: all pass. Then, as exit codes:
  - `! grep -qE 'complete|Complete' <(sed -n '/piece jobs/,/end piece jobs/p' src/clerk/docket.ts)` Expected: exit 0 — no model in either job. (Mark the block with those comments.)
  - `grep -q "piece.dormancyDays" src/wiki/thresholds.ts && grep -rq "piece.dormancyDays" src/piece/ src/clerk/` Expected: exit 0 — a declared threshold nothing reads is a mechanism with undefined behaviour.
- [ ] **Step 6: Commit** — `git commit -m "feat: stale-pin sweep and silent auto-set-down on the docket"`

---

### Task 11: Candidate Arrangements — the one model call, and the boundary it cannot cross [CHANGE SITE]

**Orient:** Up to three orderings of the *same* material under **different named organizing principles** — never three shuffles of one (Q-38). The model receives the pins and full context and returns orderings; every invariant is checked in code at one boundary before anything reaches disk, and a candidate that fails is dropped whole rather than repaired. Freedom in generation, rigidity in validation (Q-36).
**Flow position:** Wave 4 — the only model-touching file in the slice. T12 routes and renders it; T13 tests it end to end.
**Q-refs:** Q-38 (≤3, usually 2, pairwise distinct principles, generated at acceptance time only, pins and Marginalia only), Q-1 (no transitions, no titles — a title is body text), Q-36 (freedom in generation, rigidity in validation), Q-48 (the CLERK model — nobody is waiting), Q-34 (every candidate carries a model stamp), Q-12 (a model-composed gap question must quote the person verbatim), Q-39 (a model-marked gap mints exactly one question), Q-56 (`piece.gapsPerCandidate` is a bound and ships live), Q-29 (the validate-then-apply posture this copies).

<contracts>
**Downstream:** `proposeArrangements(base: Arrangement, snippets: Record<string, Snippet>, complete: Complete, thresholds): Promise<{ candidates: Arrangement[]; dropped: { principle: string; reason: string }[] }>`

**The chronology candidate is never model-generated.** Pass 1 already computes it deterministically, and it is candidate one, free. The model is asked for **argument** and **contrast** only — at most two orderings. That makes "never shuffles of one principle" partly structural rather than wholly a prompt instruction, and it halves what can go wrong.

**One call, one payload, capped.** The pins with their prose and dates, and nothing else. The prompt asks for two orderings and, per ordering, one sentence naming the principle and one short phrase naming each snippet's role. The call ends on a user-role message (llama.cpp 400s otherwise — the discipline `src/clerk/composed.ts` already holds). The whole function is try/catch-isolated: a failure returns `{ candidates: [], dropped: [...] }` and never throws into the route.

**The boundary — every check in code, before any write:**

| Check | On failure |
|---|---|
| `samePinSet(base, candidate)` — a permutation, no pin invented, none dropped, no version changed | drop the candidate, record `reason: 'pin-set'` |
| every pin resolves via `pinsResolve` | drop, `'unresolved-pin'` |
| `noProse` — no entry carries a text field | drop, `'prose-in-body'` |
| `noTitle` — nowhere, on nothing | drop, `'title'` |
| `distinctPrinciples` across the surviving set including chronology | drop the duplicate, `'duplicate-principle'` |
| Marginalia land in `marginalia[]` with `note: 'principle' \| 'role'`, each `on` an entry id in this candidate or null | drop the Marginalia, keep the candidate, record `'orphan-note'` |
| a model-marked Gap's question **sets off an exact phrase of an adjacent pinned snippet** | drop the gap, `'unquoted-gap'` |
| gaps per candidate ≤ `piece.gapsPerCandidate` | drop the excess gaps, `'gap-cap'` |

The gap-question check is `src/clerk/composed.ts`'s posture applied to a new path: the question the *agent* writes must contain the person's words verbatim (Q-12). The adjacency rule is what makes it meaningful — a question about the leap between two paragraphs should quote one of them. **`checkQuotesSource` is not exported from `composed.ts` today**; see Open Questions. If exporting it means editing `composed.ts`, that file is not in this plan's ownership table — implement the check locally in `arrangements.ts` against the same rule and file a ticket to converge them.

**This function mints nothing.** It has no `QueueStore` parameter and cannot reach one. A model-marked Gap carries its verified question text and no `question` id; T12's `/choose` route mints it if and when the person takes that candidate. A proposer that minted would put three candidates' worth of questions in the Queue for one the person kept.

Each surviving candidate is stamped `model` (Q-34) and gets a fresh `ulid()` per entry — **entry ids are never reused across candidates**, because Marginalia target entry ids and a shared id would make one note appear in two arrangements.

Every drop is logged: `arrangement-rejected` with the reason, and `arrangements-proposed` with the surviving count. **The rejection rate is the metric that says whether the model can do this job at all** — T14 reads it.

**Behavioral invariants:**
- Nothing this function returns can contain a word the model wrote **inside** the Piece body. Marginalia are Marginalia; they live in their own array and the exporter already omits them.
- The base Arrangement is never mutated. Deep-equal it before and after.
- Zero candidates is a valid, non-exceptional outcome. The person keeps the chronology they already had.
</contracts>

**Skill:** `tdd`
**Files:**
- Create: `src/clerk/arrangements.ts`
- Test: `tests/clerk-arrangements.test.ts`
- Modify: `src/log/format.ts`, `tests/log-format.test.ts`

- [ ] **Step 1: Failing tests**, scripted fake `Complete` throughout — a well-formed response yields two candidates whose principles are `argument` and `contrast`, both permutations of the base pin set; a response that **adds** a pin is dropped with `'pin-set'`; one that **drops** a pin is dropped the same way; one that changes a pin's version is dropped; a response carrying a `title` is dropped with `'title'`; a response carrying a transition sentence as an entry is dropped with `'prose-in-body'`; two candidates both claiming `argument` yield one and a `'duplicate-principle'` drop; a model gap whose question quotes **no** adjacent snippet is dropped while its candidate survives; five gaps in one candidate leave three; malformed JSON returns zero candidates and does not throw; **the base arrangement is deep-equal before and after every one of these**; every surviving candidate carries a `model` stamp; every prompt ends on a user-role message.
- [ ] **Step 2: Run** — `npx vitest run tests/clerk-arrangements.test.ts` Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Add sentences for `arrangements-proposed` and `arrangement-rejected`** to `src/log/format.ts` plus `EMITTED` samples.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run` Expected: all pass. Then, as exit codes:
  - `grep -c "samePinSet\|noTitle\|noProse" src/clerk/arrangements.ts` Expected: ≥ 3 — every guard is actually called, not merely imported.
  - `! grep -qE 'QueueStore|queue\.|QueueDraft' src/clerk/arrangements.ts` Expected: exit 0 — the proposer cannot reach the Queue, so it cannot mint.
- [ ] **Step 6: Commit** — `git commit -m "feat: candidate arrangements under distinct organizing principles"`

---

### Task 12: The candidates, on the page — one margin word and a choice [CHANGE SITE]

**Orient:** Pass 2's whole visible surface is one dimmed word in the margin and, after it, two or three ways to read the same page. Q-38 says candidates are generated **at acceptance time only** — nothing warms them in the Docket — so the word is a request, and the person makes it.
**Flow position:** Wave 4 — after T11. T13 tests the flow.
**Q-refs:** Q-38 (acceptance-time generation, ≤3, named principles), Q-9 and the document rule (a margin word, never a panel), Q-22 (nothing arrives unrequested), Q-39 (a model-marked gap reads exactly like a user-inserted one — same object), Q-41 (a set-down Piece may still be re-read this way; nothing here mints).

<contracts>
**Two routes**, appended to `src/server.ts` after T6's:
- `POST /api/piece/:id/arrangements` → `proposeArrangements(...)` with the CLERK model (Q-48), then `store.addArrangement` per survivor. Returns the Piece with all candidates. Slow by design; the surface says so in the register `beginWait` already speaks.
- `POST /api/piece/:id/choose` `{ arrangement }` → `store.setCurrent`, **then** mint one `QueueEntry` per model-marked Gap in the chosen candidate that does not already carry a `question` id: `source: 'gap-fill'` (ordinary weight — the model marked this one, not the person), `license: 'arrangement-gap'`, the question text the model composed and the boundary already verified quotes an adjacent snippet. Emits `arrangement-chosen` and one `gap-question-minted` per gap.

**Model-marked gaps mint at CHOOSE time, never at propose time**, and that is load-bearing rather than tidy: three candidates carrying three gaps each would put nine questions in the Queue for two arrangements the person then discarded. Q-39's "exactly one question per gap" is a rule about gaps that exist in the draft, and a gap in an unchosen candidate is a suggestion, not a hole. Setting a Piece down suppresses this minting exactly as it suppresses the person's own (Q-41): the candidate is still choosable, and nothing is minted.

**The surface.** A dimmed margin word — `other orders?` — on the Piece screen. Requesting re-renders the page under each candidate in turn, switched by its **principle name** in the margin (`chronology · argument · contrast`), not by a tab bar and not by a side-by-side diff. The page is the same paragraphs in a different order; that is the whole comparison and it needs no chrome.

Skeleton Marginalia appear in the margin column T7 already built: the principle sentence beside the top of the page, each role phrase beside its paragraph, all dimmed until hovered. **A stale-pin flag renders in the same column, dimmed, and is not a control** — there is nothing to click, because Q-39 forbids the only action a control could offer.

Choosing one makes it `current`. The others stay on disk (Q-38: a Piece may hold several candidate Arrangements until the person settles) and nothing is deleted.

**Behavioral invariants:**
- Nothing generates without being asked. No background call, no prefetch, no "we prepared some options".
- A model-marked Gap renders identically to a user-inserted one — same thin rule, same `ask me?` (Q-39: same object).
- No candidate is ever auto-chosen, including when there is only one.
</contracts>

**Skill:** `interface-design:interface-design`
**Files:**
- Modify: `src/server.ts`, `web/main.ts`, `web/style.css`

- [ ] **Step 1: The two routes.** Re-read `src/server.ts` first.
- [ ] **Step 2: The margin word, the principle switcher, the Marginalia column.**
- [ ] **Step 3: Verify** — `npx tsc --noEmit && npx vitest run && npx vite build` Expected: all three pass. Then `! grep -nE "tab-bar|\.panel|side-by-side" web/style.css` Expected: exit 0.
- [ ] **Step 4: Look at it** — serve with `ELICIT_LLM=local`, ask for other orders on a real Piece, switch between them. Confirm the page reads as the same writing rearranged rather than as a comparison tool.
- [ ] **Step 5: Commit** — `git commit -m "feat: candidate arrangements as a margin word"`

---

### Task 13: Pass 2 end to end — additive, proven [CHANGE SITE]

**Orient:** The test that proves pass 2 added rather than corrected. It appends to `tests/piece-e2e.test.ts` and **touches nothing T8 wrote** — if a pass-1 assertion has to change to make pass 2 pass, pass 2 is a correction and Q-42 has been broken.
**Flow position:** Wave 4, last.
**Q-refs:** Q-42 (additive by construction), Q-38, Q-39, Q-41, Q-34.

<contracts>
One appended describe block, scripted fake model: a Piece from pass 1's flow → `POST /arrangements` → two candidates on disk under distinct principles, both permutations of the base pin set, both model-stamped, each carrying one model-marked Gap → **the Queue is unchanged at this point: proposing mints nothing** → `POST /choose` → `current` changes, **the other candidates are still on disk**, and **exactly one** `gap-fill` entry appears — the chosen candidate's gap and not the discarded one's → a new snippet version makes one pin stale → a docket run writes exactly one `stale-pin` Marginalia and **the pin's version on disk is unchanged** → the Piece goes untouched past `piece.dormancyDays` → a docket run sets it down with `setDownBy: 'dormancy'` → `POST /gap` now inserts a Gap and mints nothing → `POST /pick-up` → minting resumes.

**And the additive check, as a step:** `git stash` the pass-2 source files, run `npx vitest run tests/piece-e2e.test.ts -t "pass 1"`, confirm PASS, restore. Pass 1 does not depend on pass 2 in either direction.
</contracts>

**Skill:** `none`
**Files:**
- Modify: `tests/piece-e2e.test.ts` (append one describe block)

- [ ] **Step 1: Write the flow above as one appended describe block.**
- [ ] **Step 2: Run** — `npx vitest run tests/piece-e2e.test.ts` Expected: PASS, both blocks.
- [ ] **Step 3: Verify pass 1's block was not edited** — `[ $(git diff HEAD~1 -- tests/piece-e2e.test.ts | grep -c '^-[^-]') -eq 0 ]` Expected: exit 0. The `[^-]` matters: a unified diff opens with a `--- a/…` header, so a bare `grep -c '^-'` has a floor of 1 and can never report zero — the check would pass by arithmetic rather than by evidence.
- [ ] **Step 4: Verify the additive property** — remove `src/piece/stale.ts`, `src/piece/dormancy.ts` and `src/clerk/arrangements.ts` to a temp location, run `npx vitest run tests/piece-e2e.test.ts -t "pass 1"`, Expected: PASS. Restore them.
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run` Expected: both pass.
- [ ] **Step 6: Commit** — `git commit -m "test: pass 2 end to end, and pass 1 still standing alone"`

---

### Task 14: Real-model run — the slice hypothesis, measured

**Orient:** The ticket's hypothesis in the person's own hands: *stacked snippets plus visible gaps produce a finished piece the user recognizes as their own writing.* Nothing above measures recognition; only this does.
**Flow position:** Wave 5 — Micah, the real corpus, the local model.
**Q-refs:** Q-38 (are the principles genuinely distinct, or three shuffles wearing labels?), Q-40 (did writing in the Piece feel like writing, or like filing?), Q-41 (did set-down feel reversible?), Q-48 (the clerk model's behaviour on this payload), Q-2.

<contracts>
Compose a real Piece from the real vault. Record, in `docs/superpowers/plans/2026-08-02-composition-slice.RESULTS.md`:
- Whether the exported markdown reads as the person's own writing. This is the hypothesis and the answer is a sentence, not a number.
- The **`arrangement-rejected` rate by reason**, straight from the activity log. A model that mostly fails `pin-set` cannot do this job; a model that mostly fails `unquoted-gap` needs a different gap rule, not a bigger model.
- Whether the argument and contrast candidates were genuinely different orders or the chronology with noise (Q-38's actual failure mode).
- How many gaps were inserted by hand versus marked by the model, and whether any gap question was worth answering.
- Whether pass 1 alone would have been enough.
</contracts>

**Skill:** `none`
**Files:**
- Create: `docs/superpowers/plans/2026-08-02-composition-slice.RESULTS.md`

- [ ] **Step 1: Compose a real Piece end to end with `ELICIT_LLM=local`.**
- [ ] **Step 2: Read the export as writing, not as output.**
- [ ] **Step 3: Pull the rejection counts** — `grep -h arrangement-rejected vault/log/*.jsonl | wc -l` and the same per reason.
- [ ] **Step 4: Write the RESULTS file.**

---

## Execution Waves

Fourteen tasks, six waves. The ordering rule: **no task compiles against a type a sibling in the same wave has not written yet**, and **pass 1 is finished and tested before a single pass-2 file exists.**

- **Wave 0** — T1 (shared patch: types + queue), T2 (piece contract + guards). Two parallel agents, disjoint files. **Dispatch T1 first and confirm its field list before T2 starts** — it is the only task that edits `src/types.ts`, `src/queue/queue.ts` or `src/queue/source-label.ts` in any wave, and its complete list is: `Provenance.kind += 'composition'`, `Provenance.piece?`, `QueueEntry.source += 'gap-declared' | 'gap-fill'`, `QueueEntry.gap?`, `Turn.gap?`, `CutProposal.gap?`, `Provenance.gap?`, `isUserDeclaredWeight` at two call sites, a label per new literal in `src/queue/source-label.ts` (compile-forced), and the gap link's five call sites across `elicitor.ts` and `harvester.ts`. **T1 is done when `tests/gap-link.test.ts` follows one gap id from mint to a snippet file on disk** — the four type additions on their own are the inert half. A field T1 forgets is a Wave-0 file reopened in Wave 2 by an agent forbidden to touch it.
- **Wave 1** — T3 (store), T4 (arrange), T5 (export). Three parallel agents, fully disjoint, all pure or persistence, all tested without a model.
- **Wave 2** — T6 (routes + pass-1 log kinds), then T7 (the surface), then T8 (pass-1 e2e). **Serial**: T7 needs T6's routes, T8 needs both, and T6 and T7 both touch contended files. **Pass 1 ships at the end of this wave.** Stop here and use it before Wave 3 starts — the whole point of Q-42 is that this is a product, and the fastest way to learn whether pass 2 is even wanted is to arrange your own sentences for an evening.
- **Wave 3** — T9 (stale lint), T10 (dormancy + thresholds + docket + **the production wiring in `src/server.ts`** + Wave-3 log kinds). Two agents; T9's module is pure and disjoint, T10 owns every shared file in the wave. **T10 is not done when the two Docket jobs exist — it is done when a run through `createApp` executes them.**
- **Wave 4** — T11 (the model call), then T12 (routes + surface), then T13 (pass-2 e2e). **Serial**, contended files.
- **Wave 5** — T14 (Micah + real model + RESULTS).

**Per-wave verification.** Each wave ends with the same three commands, and a wave is not done until all three are green: `npx tsc --noEmit`, `npx vitest run` (the **whole** suite, not the wave's tests), `npx vite build`. Plus one wave-specific gate:

| Wave | Gate | Expected |
|---|---|---|
| 0 | `npx vitest run` with **no test edited outside T1's three test files** (`tests/queue.test.ts`, `tests/queue-source-label.test.ts`, `tests/gap-link.test.ts`) and T2's | all pass — a red test elsewhere means the union widening hit an exhaustive reader, or a gap-link hop changed behaviour it should not have |
| 1 | `! grep -rq -e Complete -e 'complete(' -e pi-ai src/piece/` | exit 0 |
| 2 | `npx vitest run tests/piece-e2e.test.ts` with a throwing `Complete` | PASS — pass 1 works with no model reachable |
| 3 | `grep -rq piece.dormancyDays src/piece/ src/clerk/`; `! grep -rq Complete src/piece/`; and the wiring gate — `grep -A25 "runDocket({" src/server.ts | grep -q piece` | exit 0 each |
| 4 | pass-1 block of `tests/piece-e2e.test.ts` passes with the three pass-2 source files moved aside | PASS |
| 5 | the RESULTS file exists and names a rejection rate | — |

---

## Open Questions

Unresolved, recorded rather than guessed. **The working tree is being edited by other agents today**, so every assumption below about existing behaviour is a reading of the code as of 2026-08-02 and may have moved under this plan.

### Blocking — all four resolved before dispatch

**Nothing in this section blocks Wave 0.** Every entry below was open when the plan was written and has since been ruled or verified; each keeps its reasoning so the decision can be reviewed rather than re-made. A new blocking question found during execution belongs here, at the top.


- **RESOLVED 2026-08-02: widening `Provenance.kind` breaks no exhaustive reader.** The grep was run. There is no `switch` over the union anywhere in `src/` or `web/`; the declaration is `src/types.ts:142`, and the only other sites are three places that *construct* a Provenance with a literal kind — `src/harvester/harvester.ts:673` (`'restatement'`), `src/clerk/wiki-jobs.ts:611` and `src/wiki/clash.ts:178` (both synthetic `'harvest'` objects). Widening a union does not touch a constructor, so T1's edit is additive. **T1 still runs the grep as Step 1** — the import work is in flight in these files today and the answer is only as old as the reading.
- **RESOLVED 2026-08-02: `PieceStore` is its own interface. `Vault` does not grow piece methods.** The warrant is repo precedent rather than taste — `QueueStore` already answered this exact question the same way, and a Piece shares no persistence logic with a Snippet beyond the vault root. Growing `Vault` would put a new artifact class into an interface every existing `Vault` consumer compiles against, for nothing.

  The tree holds **two** shapes of that precedent, and this plan follows the newer one, which is worth stating so nobody reads T2/T3 as a deviation:

  - the older — `QueueStore` declared in `src/types.ts:313`, factory `createQueueStore` in `src/queue/queue.ts:18`;
  - the newer — `ClaimStore` and `Registry` declared in `src/wiki/contract.ts:505` and `:537`, factory `createClaimStore` in `src/wiki/store.ts:57`.

  T2 declares `PieceStore` in `src/piece/contract.ts` and T3 puts `createPieceStore` in `src/piece/store.ts`, which is the `wiki/` shape exactly: the interface beside the guards it is checked by, the implementation beside nothing else. `src/types.ts` therefore gains no piece type at all, which keeps T1's edit to that file as small as it already is.
- **RESOLVED before dispatch: `QueueEntry.source` HAS an exhaustive reader, and it is not a `switch`.** `src/queue/source-label.ts` holds `const SOURCE_LABELS: Record<QueueEntry['source'], string>` — verified 2026-08-02 by reading the file. Widening the union without adding both labels is a compile error, not a runtime gap, so the label work is inside T1 rather than a follow-up. `src/types.ts:240`'s comment ("Nothing switches over this union") predates that module and is now misleading; T1 corrects it. The hand-check T1 still owes is the one that comment describes: confirm no other equality test against a source literal exists outside `draw`, `expire` and `sourceLabel`.

- **RESOLVED 2026-08-02 — how a Gap clears, ruled as a deduction from Q-39 rather than a new decision.** Q-39 already names the mechanism: each gap mints exactly one Queue question, a fitting later harvest is offered in the margin and never auto-placed, and the gap clears only when the USER places a snippet. So the loop closes through machinery that already ships — the question is drawn and answered in an ordinary sitting, and the Snippet harvested from that answer is offered beside the Gap. A general "place any snippet in any hole" verb was rejected: it is outside ticket 010's locked verb list, and it is not what the register describes.

  Built in **T1** (the four-hop gap link, so a Snippet can name the Gap it answers), **T6** (`GET /api/piece/:id` computes the offer as an exact id join; `POST /gap/accept` verifies `provenance.gap` and refuses anything else) and **T7** (the margin offer). Nothing here blocks dispatch. Two residual questions came out of the ruling and are **exploratory** — they are filed under *Exploratory* below, as the last two entries, so that a reader scanning this section for blockers does not stop on them.

### Exploratory — answerable during implementation

- **`checkQuotesSource` is not exported from `src/clerk/composed.ts`.** (T11, Wave 4.) The quote gate T11 needs for model-marked gap questions lives there as a module-private function. **Assumed:** T11 reimplements the same rule locally rather than editing `composed.ts`, which is outside this plan's ownership. That duplicates a security-relevant check, which is exactly the kind of drift Q-1 exists to prevent. The honest fix is to export it, in **ticket 082** (`docs/wayfinder/tickets/082-export-the-quote-gate.md`).
- **Should a Gap leave a visible mark in the export?** (T5, Wave 1.) **Defaulted to no** — the exported file is the person's words and nothing else, which is Q-1's guarantee at its strongest. The cost is that the person loses their own sense of where the hole was once the file leaves the app. An HTML comment would preserve it without putting agent prose in the document; it was not chosen because a comment is still a word the person did not write. Revisit after T14.
- **Should the export carry frontmatter?** (T5.) **Defaulted to no.** Frontmatter with the pin list would make the export auditable and, under Q-57, re-importable — which is a reason *against* it, since re-importing an export would duplicate every snippet in it under a new date.
- **Auto-set-down ships live rather than shadow.** (T10, Wave 3.) The reasoning is in T10's contract: Q-35 governs selection mechanisms and this selects nothing, Q-56 says bounds ship live, and the action is reversible with a costless consequence. If Q-35 is meant to bind every mechanism without exception, the honest consequence is that auto-set-down is a shadow feature in this slice — one boolean in the register and one test line. Decide before T10 lands.
- **45 days is a guess.** (T10.) Nothing in the register fixes a dormancy period. It is a bound under Q-56 so it ships live, but its value has no evidence behind it and T14's run is the first data.
- **A composition Snippet has no Facet reading.** (T6, Wave 2.) See *The reading-less snippet*. Assumed acceptable; ticket filed. The risk is that the corpus quietly accumulates uncitable snippets and nobody notices until a Piece's paragraphs are invisible to the Wiki.
- **Piece files are committed by the Clerk's git author.** (T3, Wave 1.) Q-61 makes the Docket commit the vault once per run authored as `elicit-clerk`, and pass-1 piece writes happen outside any run, so they land in the working tree and get committed under the Clerk's name. The person wrote them. This is the existing behaviour for every user-driven vault write, so this slice does not change it — but Q-61's whole tamper-evidence argument rests on the author distinguishing a hand edit from an app write, and this is a third category.
- **Stale-pin lint is zero-LLM but is specced into pass 2.** (T9, Wave 3.) Staleness is a graph fact — `version < latest` — and needs no model, so it could ship in pass 1. It is in pass 2 because the ticket's scope lock puts it there. Nothing depends on the placement; if pass 1 wants it, T9 moves to Wave 1 unchanged.
- **How does a person get to the `material` screen?** (T7, Wave 2.) **Assumed:** a dimmed margin word on the waiting surface, alongside the existing navigation. The waiting surface is where background work waits and a Piece is not background work, so this may belong on the mode screen instead. A design call for T7, not a blocker.
- **Does `web/main.ts`'s `Screen` union still look as read?** (T7.) Read at `web/main.ts:102` on 2026-08-02: nine members, switched in `navTo`. Contended file; re-read before editing.

- **Should accepting a gap offer be undoable as a distinct act?** (T6, Wave 2 — from the Q-39 ruling above.) Today it is not: the Gap became a Pin, and getting the hole back means removing the Pin and inserting a new Gap, which mints a second question. Nothing is lost, but the second question is noise the person did not ask for. Defaulted to leaving it, because a Gap filled and then unfilled is rare enough that no evidence exists either way, and Q-39's "clears only when the user places" reads as a decision rather than a step.
- **What if a gap question's answer harvests into no admissible Snippet at all** — every cut became a Bud? (T6, Wave 2 — from the same ruling.) Then the Gap has an answered question and an empty offer, and the margin shows nothing: honest, but silent. The Bud is where the material went, and Buds are not placeable in Pieces by definition (CONTEXT). Recorded; T14 is the first chance to see whether it happens.

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/types.ts` | patch | `'composition'` |
| `src/queue/queue.ts` | patch | `isUserDeclaredWeight` |
| `src/piece/contract.ts` | create | `distinctPrinciples` |
| `src/piece/store.ts` | create | `createPieceStore` |
| `src/piece/arrange.ts` | create | `chronological` |
| `src/piece/export.ts` | create | `toMarkdown` |
| `src/piece/stale.ts` | create | `stalePins` |
| `src/piece/dormancy.ts` | create | `isDormant` |
| `src/clerk/arrangements.ts` | create | `proposeArrangements` |
| `src/wiki/thresholds.ts` | patch | `piece.dormancyDays` |
| `src/clerk/docket.ts` | patch | `stale-pin-flagged` |
| `src/server.ts` | patch | `/api/piece/:id/gap` |
| `src/server.ts` | patch | `/gap/accept` |
| `src/server.ts` | patch | `readVersion` |
| `src/server.ts` | patch | `runDocket` wiring — grep `-A25 "runDocket({"` for `piece` |
| `src/log/format.ts` | patch | `piece-set-down-auto` |
| `web/main.ts` | patch | `renderPiece` |
| `web/style.css` | patch | `.piece-gap` |
| `tests/piece-contract.test.ts` | create | `samePinSet` |
| `tests/piece-store.test.ts` | create | `setDownAt` |
| `tests/piece-arrange.test.ts` | create | `startedOf` |
| `tests/piece-export.test.ts` | create | `toMarkdown` |
| `tests/piece-routes.test.ts` | create | `gap-declared` |
| `tests/piece-stale.test.ts` | create | `stale-pin` |
| `tests/piece-dormancy.test.ts` | create | `isDormant` |
| `tests/clerk-arrangements.test.ts` | create | `duplicate-principle` |
| `tests/piece-e2e.test.ts` | create | `pass 1` |
| `src/queue/source-label.ts` | patch | `gap-declared` |
| `src/elicitor/elicitor.ts` | patch | `gap` on the drawn-entry Turn |
| `src/harvester/harvester.ts` | patch | `proposal.gap` |
| `tests/gap-link.test.ts` | create | `provenance.gap` |
| `tests/queue.test.ts` | patch | `gap-declared` |
| `tests/queue-source-label.test.ts` | patch | `gap-fill` |
| `tests/log-format.test.ts` | patch | `piece-set-down-auto` |
| `tests/docket.test.ts` | patch | `dormancy` |
| `docs/wayfinder/tickets/081-readings-for-composition-snippets.md` | create | `composition` |
| `docs/wayfinder/tickets/082-export-the-quote-gate.md` | create | `checkQuotesSource` |
| `docs/superpowers/plans/2026-08-02-composition-slice.RESULTS.md` | create | `arrangement-rejected` |
<!-- PLAN_MANIFEST_END -->

---

## Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-1 | Sole Authorship: no agent prose, no titles, enforced in code | T2 (Wave 0), T5 (Wave 1), T6 (Wave 2), T11 (Wave 4); Storage layout |
| Q-2 | Local models only | T14 (Wave 5) |
| Q-3 | Markdown files are the source of truth; indexes derived | T2, T3 (Wave 1), T4, T6; Storage layout |
| Q-4 | Facet and Stance are agent readings citing `snippet@version` | *The reading-less snippet*; Open Question (T6) |
| Q-5 | Snippet versions are immutable | T2, T4 (Wave 1), T5, T7 (Wave 2), T9 (Wave 3) |
| Q-9 | Focus-friendly interface, no chrome, typography does the hierarchy | T7 (Wave 2), T12 (Wave 4) |
| Q-12 | A composed question must quote the user verbatim | T6 (the user-typed exemption), T11 (the model-marked gap rule) |
| Q-13 | Constraints then chance; never argmax | T1 (Wave 0) |
| Q-15 | Verification questions are a last resort; nothing on a surface may accuse | T1 (Wave 0) — the two source labels |
| Q-22 | Zero outbound contact; agent initiative ends at the app's edge | T10 (Wave 3), T12 (Wave 4) |
| Q-23 | Every act logged to the append-only Activity Log | T6, T10, T11 |
| Q-24 | No shame gradient; dormancy is signal, never debt | T7 (Wave 2), T10 (Wave 3) |
| Q-25 | The interface is password-locked | T6 (Wave 2) |
| Q-26 | Phone sittings supported; touch-sized quiet actions | T7 (Wave 2) |
| Q-27 | Re-reading serves self-recognition | T9 (Wave 3) |
| Q-29 | Validate at one boundary; the model never writes status | T3 (Wave 1), T11 (Wave 4) |
| Q-31 | Zero-LLM lint may add and annotate, never remove or restructure | T9 (Wave 3) |
| Q-34 | Every agent-authored artifact carries a model stamp | T2, T11 (Wave 4) |
| Q-35 | Shadow-first graduation per selection mechanism | T10 (Wave 3), Open Question (T10) |
| Q-36 | Freedom in generation, rigidity in validation | T11 (Wave 4) |
| Q-37 | Agent-side Piece offers are passive, licensed by citation-cluster density | **EXCLUDED** — *What this slice does NOT build* |
| Q-38 | ≤3 candidate Arrangements, pairwise distinct principles, acceptance-time only | T2 (Wave 0), T11, T12 (Wave 4), T14 (Wave 5) |
| Q-39 | Gaps and stale pins annotate and offer, never act; a gap clears only when the user places a snippet | T1 (Wave 0 — the four-hop gap link), T2, T6 (Wave 2 — the offer join and `/gap/accept`), T7 (the margin offer), T9, T10 (Wave 3), T11, T12 (Wave 4) |
| Q-40 | User prose in a Piece becomes a Snippet with composition provenance | T1 (Wave 0), T6 (Wave 2), T14 (Wave 5) |
| Q-41 | A Piece is set down, never finished; auto-set-down is silent and logged | T2 (Wave 0), T3 (Wave 1), T6, T7 (Wave 2), T10 (Wave 3), T13 (Wave 4) |
| Q-42 | Two passes; pass 1 zero-LLM and complete alone; pass 2 strictly additive | Execution Waves; T8 (Wave 2), T13 (Wave 4); *Four decisions* §1 |
| Q-48 | Two models by role; the Clerk gets the careful one | T11, T12 (Wave 4), T14 (Wave 5) |
| Q-50 | Two cites are independent only across different sittings | T6 (Wave 2) — the composition session |
| Q-56 | Q-35 governs selection; bounds ship live and record every clip | T10, T11 (`piece.gapsPerCandidate`) |
| Q-57 | The importer has one door: a folder of dated files | Open Question (T5) — why the export carries no frontmatter |
| Q-58 | The review surface renders prose whole, kept by touching a span | T7 (Wave 2) — the `material` screen's precedent |
| Q-59 | An imported file's date comes from the sitting, never from import time | T4 (Wave 1) |
| Q-60 | Absent is never a guessed value | T1 (Wave 0), T6 (Wave 2) |
| Q-61 | The vault is a git repo; the Docket commits it | Storage layout; Open Question (T3) |

---

## Shape Changes

| Date | Role | Finding | Summary |
|---|---|---|---|
| 2026-08-02 | author | — | Plan written from ticket 010's locked scope and the composition grill (Q-37..Q-42). |
| 2026-08-02 | author | review 1, issue 1 | T10 gains `src/server.ts` in Wave 3 (append-only) and a through-`createApp` wiring test: two Docket thunks nothing passed were an inert mechanism. |
| 2026-08-02 | author | review 1, issue 2 | T6 gains `readVersion()` — the pinned-version resolver `Vault` cannot supply, since `rebuildIndex` reads only the newest `v<N>.md`. |
| 2026-08-02 | author | review 1, issue 3 | T1's Files block gains `src/queue/source-label.ts` and its test, which the contract already required. |
| 2026-08-02 | author | review 1, issue 4 | The gap route takes a client-minted `gap` ULID as an idempotency key; the 409 is dropped for a 200 no-op. |
| 2026-08-02 | author | review 1, issue 5 | T1 Step 6's grep floor is `-ge 3`, with the two-line sort key named. |
| 2026-08-02 | author | review 1, issue 6 | T13 Step 3 counts `^-[^-]`, so the diff header cannot floor the check at 1. |
| 2026-08-02 | author | ruling: gap clearing | Option (b) adopted per Q-39. T1 threads a four-hop gap link (QueueEntry → Turn → CutProposal → Provenance) and gains `elicitor.ts` + `harvester.ts`; T6 gains the offer join and `/gap/accept`; T7 renders the margin offer. |
| 2026-08-02 | author | review 2, issue 1 | Hop 2's `drawFallback` path spelled out — `emitProbe` has no Turn literal, so its opts widen and `agentTurn` gains the spread; `targetFacet` dropped as precedent (it reaches the Probe, not the Turn). Step 6a's elicitor floor raised 2 → 4. |
| 2026-08-02 | author | review 2, issue 2 | New-ticket rows renumbered 072/073 → 081/082; 072-074 are live and 080 was taken the same day. Both body references updated. |
| 2026-08-02 | author | ruling: PieceStore | Separate interface confirmed on `QueueStore`/`ClaimStore` precedent; the last blocking open question is resolved. `Vault` gains nothing. |
| 2026-08-02 | author | review 2, cosmetics | T6's heading no longer says "five verbs"; the Wave-0 gate names all three of T1's test files; the two exploratory questions from the Q-39 ruling moved under *Exploratory* with a pointer left behind. |
| 2026-08-02 | author | review 1, advisories | Wave-1 gate's escaped-pipe grep replaced with `-e` forms; both `graduatesWhen` sentences written; Provenance.kind blocker marked resolved with the grep's result; the Q-39 gap-clearing hole added as a BLOCKING open question; route count and `/prose` body corrected; `queue.add()` named as the only mint path. |
