# The composition featureset — ground-up redesign

Date: 2026-08-09. Status: **proposed**. Four points were settled with Micah in
the 2026-08-09 composition conversation and are marked **[settled]**; the rest
is recommendation awaiting ruling.

Evidence base: all four compositions in the live and archived vaults, the
piece subsystem source (`src/piece/`, `src/clerk/arrangements.ts`,
`web/piece.ts`), `docs/redesign-2026-08-08.md` §10, and the decision register.

Governing statement, in Micah's words: **a composition is an organising method
for like-minded snippets across sittings.** Two things come out of it — a
document you can polish into standalone writing through elicitation, and new
questions for sittings that only this arrangement could have raised.

That second output is the reframe. A composition is not a document editor
bolted to the side of the product. It is the product's **second question
engine**, sitting beside the one that reads the wiki. The wiki engine asks
*what is stale or inconsistent in what you believe*. The composition engine
asks *what is missing in what you are trying to say*. Everything below follows
from taking that seriously.

---

## 1. The evidence — pass 2's ordering is convicted

`docs/redesign-2026-08-08.md` §10 already cut "pieces pass 2" and kept "pieces
pass 1" as core: *deterministic, tiny, and it is the thesis*. Per Q-42, pass 2
is precisely: candidate Arrangements under distinct organizing principles
(Q-38), skeleton Marginalia, stale-pin lint, and auto-set-down.

The cut was ruled but never executed. The vault now shows what it was ruling
on. Every composition that exists, with its generated candidates:

| composition | base order | second candidate | third candidate |
|---|---|---|---|
| `01KZ2Q8R…` | 1 paragraph | identical | identical |
| `01KZ365N…` | 1 paragraph | identical | identical |
| `01KZ366P…` | `A B C D E F G` | identical | `A B C D F G E` |
| `01KZJS70…` | `A B C` | identical | `A C B` |

Eight model-generated candidates across four compositions. **Six are
byte-identical to the base** under a different principle name. The two that
differ are each a single-element move. One was ever adopted — a swap of two
adjacent paragraphs.

Two compositions held **one paragraph**, where order does not exist, and the
generator fired anyway and offered three of them.

This convicts under both laws ratified on 2026-08-09:

- **No decision without a discernible difference.** Three orders were put on
  screen as a choice. In six of eight cases the outcomes were the same
  document.
- **No machinery without citations.** The generator must beat the simplest
  fallback. Its fallback is the deterministic chronological order, and across
  the whole archive it produced two single-swap departures from it.

The mechanism failed silently because `distinctPrinciples`
(`src/piece/contract.ts:170`) checks the **label**, not the sequence. Two
identical orderings pass the guard as long as they are named differently.

**Micah's judgment [settled]:** ordering is a presumptuous lever — permuting
paragraphs written in isolation cannot produce the improvement it advertises.
`samePinSet` makes this structural: the model may only permute, never write
the connective tissue that would make a new order mean anything.

## 2. What replaces it

The model's real competence over a sequence is noticing that **a seam does not
hold** — not permuting. The discipline for that already exists in the code
that is being deleted: `arrangements.ts:365-375` enforces Q-12 by requiring a
gap question to quote one of the two paragraphs it sits between.

That guard is the good part of the subsystem, currently in service of the bad
part. It survives; the ordering does not.

A named seam leaves both resolutions open — move something, write something,
or ask for what is missing — and the person picks. Naming a lack is not
presumptuous. Proposing a shuffle is.

## 3. Reconciling with the razor

This design **re-admits model involvement in compositions**, which pass 2's cut
removed. That must be stated plainly rather than smuggled.

Pass 2's model work was *ordering*, and the archive convicts it. This design's
model work is different in kind: *gathering* (which passages belong) and
*noticing lacks* (where the writing fails). Neither has ever run, so neither is
convicted or acquitted.

By the razor's own rules that means **probation with a named floor**, not core.
Terms in §10 below.

Two parts of pass 2 that the cut swept up should be reconsidered separately,
because this design changes their footing:

- **Auto-set-down (`src/piece/dormancy.ts`)** — worth keeping, and it gets
  *more* load-bearing here, not less. Its own docstring states the reason: a
  composition nobody touches should stop minting questions into a queue the
  person is not reading. A design that mints more questions needs that brake
  more. It is pure, memoryless, model-free.
- **Role marginalia** — the per-paragraph note naming what a paragraph does.
  A genuine reading aid that currently rides along with the ordering pass. If
  it is not re-homed onto the gap sweep it dies with code that deserves to.

Both are re-proposals of cut machinery and are Micah's call, not a quiet
reinstatement. Stale-pin lint (`src/piece/stale.ts`) is model-free, pure, and
annotate-only; recommendation is to keep it on the same footing as dormancy.

## 4. The shape

Today `Piece.entries` is an ordered list and the *set* of passages is frozen at
creation. For an organising method across sittings that is inverted. The two
layers separate:

- **The gathering** — which passages belong. Alive; grows as sittings happen.
- **The order** — what sequence they sit in. Yours, by drag, silently.

```
Composition {
  subject: string        // the person's words; the gathering criterion; never exported
  entries: (Pin | Gap)[] // one list — no arrangements, no `current`
  offers: Offer[]        // passages a sitting produced that may belong
  declined: string[]     // durably refused offers, never re-offered
  marginalia: Marginalia[]
  setDownAt?, setDownBy?, discardedAt?
}

Gap {
  id
  placedBy: 'person' | 'model'
  kind?: 'leap' | 'unsupported' | 'thin' | 'unclosed'   // model-placed only
  question?   // the minted QueueEntry
  pending?    // verified text awaiting mint
}
```

`placedBy` is the field the current contract lacks and it is load-bearing: it
decides queue weight, expiry rate, and whether the hole renders as your
commitment or as a suggestion you may refuse.

`subject` is not a title. It never reaches the export, so Q-1 is untouched —
Q-1 governs the body of the document, and the subject describes the gathering,
not the writing. **[settled: proceed on this reading.]**

## 5. Gathering

Three doors, deliberately. They are not redundant; they serve different states
of knowing.

1. **Multiselect at creation [settled: keep].** The fast path for when you
   already know which passages. It was only ever a problem as the *sole* door,
   because it forced commitment to the whole set before you had seen a line in
   place. Beside the other two, it costs nothing.
2. **Search and place.** Any passage, any sitting, at any time.
3. **Auto-gather [settled].** After each harvest, one model call per open
   composition asks whether any of that sitting's passages belong, judged
   against the subject line and the existing material. Candidates render
   **below the piece**, each with accept and deny.

Auto-gather never adds. It offers. Q-39's rule — nothing is placed without the
person's touch — holds without exception.

Deny is **durable**: a denied passage is never offered again, stored the way
`DirectionRecord.declinedOptions` stores a refused quest option. Without
durable denial the feature becomes a nag and gets switched off within a week.

This licensing differs from Q-37, deliberately. Q-37 licenses piece offers on
citation-cluster density through shared claims. The claim layer is on deep
probation leaning cut (`redesign-2026-08-08.md` §10), so a claim-dependent
offer is unbuildable. Subject line plus existing material is claim-free and
costs one call per sitting per open composition — not one per snippet.

## 6. Output A — the annotated export

Two exports, because they serve different moments:

- **clean** — your words, in order, gaps omitted. What ships.
- **with the questions** — your words, plus every open gap in the margin as a
  blockquote, plus the open offers listed at the end. The working document.

**Both are zero-LLM.** They print holes that already exist. Whether a hole was
placed by you or found by the model is decided elsewhere, which means Output A
carries none of §10's probation risk and can ship on pass 1's footing.

The discipline that must survive: the model contributes **questions, never
sentences**. `noProse` (`contract.ts:78`) must extend to cover the new gap
fields, so a model-placed gap can carry only `{id, kind, placedBy, question,
pending}`. If the model can put prose into the export, the composition stops
being yours and the whole apparatus is pointless.

## 7. Output B — the composition sweep

Gap-finding moves out of `runArrangements` and becomes its own docket job,
beside the four in `src/clerk/sweeps.ts`, shaped like `runOutcomeQuestions`:
iterate open compositions, cap per run, mint under a join key.

The four kinds the model may find, reading the sequence:

| kind | what it saw | what it asks |
|---|---|---|
| `leap` | two adjacent passages do not connect | what goes between these |
| `unsupported` | an assertion stated once, never grounded | the instance behind it |
| `thin` | the subject is under-covered relative to the rest | write more about X |
| `unclosed` | opened early, never returned to | how did that end |

`thin` is the "suggestions for writing more" output; the other three fill gaps.
A pass is capped at 3 findings and they must be **distinct kinds** — otherwise
the model returns twelve `thin`s. `thresholds.gapsPerCandidate` becomes this
cap, renamed.

New queue source **`composition-gap`**, keyed `(composition, gap)`. That is the
pattern `claim`, `quest`, `bud`+`failure` and `snippet` already follow in
`QueueEntry`, so "one question per found gap" is expressible and a re-run
cannot double-mint.

Weight it **below** `gap-declared`. Your own hole is the strongest signal in
the system; the model's noticing is a suggestion. Model-placed gaps also expire
faster: if you ignored it for three sittings, the model was wrong.

The return trip needs no new code. The answer's Provenance already carries the
gap id (Q-39, threaded by T1), so the harvested passage surfaces beside its
hole and you place it. That closes the loop and is what makes a composition an
engine rather than a document.

**What is being fixed here is a trigger, not a mechanism.** Model gap-finding
already works (`arrangements.ts:378` → `routes.ts:491-507`). It fires only if
you press `other orders?` **and then** adopt a candidate. Composition-as-
question-source is currently a side effect of accepting a reordering — which
explains why it has produced nothing.

## 8. The verbs

Eleven, across four sites. Each acts on a different object; that is the
organising rule. The toolbar keeps only what changes the document's *status*,
so verbs that change the document itself live with the text.

**On a passage in the piece** — margin, revealed on focus:

| verb | what it writes |
|---|---|
| `take out` | the entry, removed — `routes.ts:233` exists today, unwired |
| `ask here` | a hole, `placedBy: 'person'`, plus a queue entry at `gap-declared` weight |
| *drag* | the order — silent, no word, no model |

**On a candidate below the piece:**

| verb | what it writes |
|---|---|
| `put it in` | the pin, appended |
| `not this one` | a durable denial |

**On a model-found gap:**

| verb | what it writes |
|---|---|
| `ask this` | the queue entry, at `composition-gap` weight |
| `not a gap` | dismissed, never re-found |
| `place it` | the answered passage into the hole |

**On the composition** — toolbar:

| verb | what it writes |
|---|---|
| `set down` / `pick up` | `setDownAt` — Q-41's reversible shelf |
| `discard` | `discardedAt`, a field write; the file stays (Q-3) |
| `save as it stands` | the clean export |
| `save with the questions` | the two-ink export |

The model proposes exactly two things: passages that may belong, and seams that
do not hold. Both refusable, both durably. Every accept, deny, place and ask is
the person's.

## 9. What gets deleted

**Convicted (§1) — the ordering subsystem:**

- `Piece.arrangements[]` → `entries[]`; `Piece.current` gone
- `PieceStore.addArrangement`, `setCurrent` (`contract.ts:62-63`)
- `POST /api/piece/:id/arrangements`, `POST /api/piece/:id/choose`
  (`routes.ts:437`, `:468`)
- `samePinSet` (`contract.ts:147`) — its only caller validated reorder
  candidates
- `distinctPrinciples`, the `Principle` enum, `MarginaliaNote: 'principle'`
- the `arrangement` parameter threaded through **every** piece route body
- `registry.ts:658`; `log/format.ts:830`, whose `?? 'chronology'` fallback
  becomes "kept the order you chose"
- web: `viewedArrangementId`, the principle switcher, `other orders?`,
  `keep this order`, the viewing-a-candidate line — the entire toolbar centre
- most of `arrangements.ts` (425 lines), surviving as a ~150-line gap-finder

**Redundant:**

- `add question` in the toolbar (`web/piece.ts:122-127`) — an exact duplicate
  of the seam it scrolls to
- `license: 'arrangement-gap'`, replaced by the `composition-gap` source.
  `source: 'gap-fill'` itself stays; the bud and construct sweeps use it

**Must survive the deletion — the trap:**

- the `quotesAdjacent` / Q-12 guard at `arrangements.ts:365-375`. It is what
  keeps a `leap` from degenerating into a generic writing prompt. It must
  **move with** the gap-finding into the sweep
- `noProse`, `noTitle`, `pinsResolve` — and `noProse` gets extended
- `stale.ts`, `dormancy.ts`, role marginalia — see §3

## 10. Probation terms

New machinery enters under the razor with a named floor. If the floor wins or
ties, the mechanism is deleted, not tuned.

| mechanism | floor | the fingerprint that saves it |
|---|---|---|
| Auto-gather | manual gathering only (multiselect + search) | compositions that grew by accepted offer, reaching passages from sittings the person did not go looking through |
| The gap sweep | every gap placed by hand (`ask here`) | a model-found gap that survives all three steps: `ask this` pressed, answered in a sitting, and the answer placed into the hole |

The gap sweep's test is deliberately demanding. A found gap that mints a
question nobody answers is noise; one that mints a question answered but never
placed found the wrong hole. Only the full round trip proves the engine.

Flooding cap, per recommendation: N open compositions × 3 found gaps, hard,
with faster expiry on model-placed gaps than on yours. The queue already has
fifteen sources and this sweep can out-produce all of them.

## 11. Canon touched

| decision | change |
|---|---|
| Q-38 | **Retired.** Arrangement candidates under distinct named principles are convicted by §1. The three-principle enum goes with it. |
| Q-39 | **Amended.** Gap detection stays dual-authority, but the model's half no longer happens "while arranging" — it happens in the composition sweep. Annotate-and-offer is untouched. |
| Q-42 | **Amended.** Pass 2's ordering is deleted rather than deferred. Auto-set-down and role marginalia are re-proposed on new grounds (§3); stale-pin lint is kept. |
| Q-37 | **Amended.** Piece offers are licensed by the subject line and existing material, not by citation-cluster density through claims — the claim layer may not survive. Offers render below the composition, not on the waiting surface. |
| Q-1 | **Untouched.** `subject` is the gathering criterion and never exports. |
| Q-41, Q-40, Q-12, Q-5, Q-3 | **Untouched**, all load-bearing here. |

## 12. Bugs to fix before any of this

Three, all live today, all cheap:

1. **The library tabs hide nothing.** `web/piece.ts:677` toggles `.hidden`, but
   `.material-pieces` (`style.css:2334`) and `.library-directions` (`:2409`)
   set `display: flex`. An author rule beats the UA `[hidden]` rule regardless
   of specificity, so pieces and directions are both always visible under
   every tab. Fix: `[hidden] { display: none !important; }`. **This is a
   prerequisite** — the offers region below the piece walks into the identical
   trap.
2. **`take out` is unrouted.** `POST /api/piece/:id/remove` exists at
   `routes.ts:233` with no caller in `web/` and no registry entry. Composition
   is add-and-reorder only.
3. **`set down` has no visible effect.** The server sends `setDownAt`
   (`routes.ts:191`); `PieceLite` (`web/piece.ts:67`) drops it and the board
   renders every composition identically. The field crosses the wire and dies.

## 13. Build order

1. The three bugs in §12. Prerequisites, not scope.
2. **Gathering** — subject, search-and-place, `take out`, `discard`. Zero-LLM.
   This is what makes it an organising method; everything else is decoration
   without it.
3. **Delete the ordering subsystem** (§9). Do it before building on top, not
   after — the `arrangement` parameter is threaded through every route.
4. **Auto-gather + the offers region.** First probation entry.
5. **The gap sweep**, with its cap and the Q-12 guard carried across. Second
   probation entry.
6. **The annotated export.** Last, and easiest — worth nothing until there are
   found gaps to print.
