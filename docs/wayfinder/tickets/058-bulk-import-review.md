---
title: "Build: bulk import and review — bringing an existing body of writing into the vault"
labels: [wayfinder:task]
status: open
assignee: claude (omp executing)
blocked_by: []
---

## Question

A person arrives at Elicit with a decade of writing already on disk. Today the
only doors are a sitting and the single-paste unprompted box, so that corpus
either enters one paste at a time or not at all. `scripts/ingest-posts.ts` is
the one-off that proved the shape against Micah's 47 posts; this ticket makes
it a surface.

This is not a chore feature. The corpus a person already wrote is the largest
single source of person-knowledge Elicit will ever get, and it is the only one
that arrives with real DATES attached — which under Q-50 is what makes cite
independence possible at all. A first sitting on an empty vault has nothing to
resonate against; a first sitting after an import has nine years.

### What the script established, and the surface must keep

1. **One item, one sitting, dated to when the prose was written.** Q-50 makes
   independence cross-sitting, so a blob import makes a whole archive one piece
   of evidence and nothing drawn from it can ever reach `evidenced`. The date
   is the highest-value property of imported material and the easiest to throw
   away silently.
2. **The frontmatter/body distinction is a ruling, not a detail** — Micah ruled
   2026-08-02 that YAML frontmatter is not his prose. Any importer that reads
   structured metadata as text will fill the vault with marketing register.
3. **Q-51 has to be enforceable HERE**, because import is where unseparable
   authorship arrives. Co-authored items are excluded whole. The surface needs
   somewhere to record "this one is joint" and have that mean something.
4. **Quoted and cited passages are excluded at cut level.** The mechanical rule
   the script uses — drop any paragraph carrying an inline citation — caught the
   real hazard, which was three quotations set as ordinary paragraphs, one of
   them with no quote marks AND no citation because the citation sat on the next
   paragraph.
5. **`channel: 'pasted'`** on everything imported (048).
6. **Split on paragraph boundaries, never mid-sentence.** `propose()` verifies
   each cut against its own turn; a split through a sentence destroys any cut
   spanning it.
7. **Dry run before write, always.** The review is the decision record and the
   user's edits to it are the input to apply — not a conversation, a file.

> **RULED 2026-08-02 — Q-58.** The import review IS the harvest review
> (`web/main.ts:975`), pointed at an imported piece: same surface, same
> controls at the point of attention, three verbs (approve / trim / discard).
> `restate` drops — you cannot restate a 2018 essay without producing prose
> from today wearing an eight-year-old date. One change, forced by the source:
> the piece renders WHOLE with cuts marked IN PLACE, because misleading
> excision is the only failure this review can catch (fabrication is already
> caught by the substring check) and judging it needs the surrounding text.
> No batch accept. The section below is the reasoning that produced it.

> **RULED 2026-08-02 — Q-58.** The import review IS the harvest review
> (`web/main.ts:975`), pointed at an imported piece: same surface, same
> controls at the point of attention, three verbs (approve / trim / discard).
> `restate` drops — you cannot restate a 2018 essay without producing prose
> from today wearing an eight-year-old date. One change, forced by the source:
> the piece renders WHOLE with cuts marked IN PLACE, because misleading
> excision is the only failure this review can catch (fabrication is already
> caught by the substring check) and judging it needs the surrounding text.
> No batch accept. The section below is the reasoning that produced it.

> **RULED 2026-08-02 — Q-58.** The import review IS the harvest review
> (`web/main.ts:975`), pointed at an imported piece: same surface, same
> controls at the point of attention, three verbs (approve / trim / discard).
> `restate` drops — you cannot restate a 2018 essay without producing prose
> from today wearing an eight-year-old date. One change, forced by the source:
> the piece renders WHOLE with cuts marked IN PLACE, because misleading
> excision is the only failure this review can catch (fabrication is already
> caught by the substring check) and judging it needs the surrounding text.
> No batch accept. The section below is the reasoning that produced it.

### The design problem worth grilling before building

The document rule (`docs/interface-references.md`) says every surface is a page
of text with controls only at the point of attention. Bulk review wants a list
with checkboxes — which is the opposite shape. That tension is the actual
design question here and it should not be resolved by reflex.

The promising reading: a review is not a table of cuts, it is **the imported
piece re-read with the proposed cuts marked in it**, in place, in order. You
read your own 2018 essay and see which sentences Elicit wants to keep,
underlined where they sit. Rejecting one is a control at the point of
attention. That preserves the document rule AND gives the user the context the
cut came from — which a flat list destroys, and which is exactly what is needed
to catch misleading excision.

### Open questions

- ~~What does a person point the importer AT?~~ **RULED — Q-57.** One door: a
  folder of files on disk. The app never opens a socket. Leaflet and Pixelfed
  become export SCRIPTS that write a folder, never importers. ADR-0001 is not
  the reason; separability is — a feed hands over rendered HTML, and the three
  quotations that nearly entered the corpus were catchable only because the
  markdown source preserved citation structure.
- ~~Where does the DATE come from when a file has none?~~ **RULED — Q-57.**
  Frontmatter only. Never mtime, never inferred, never asked per item. A file
  with no date is REFUSED with a reason, because under Q-50 the date is what
  makes cite independence possible and a guess corrupts it silently.
- ~~Import is long-running.~~ **RULED — Q-58.** Extraction runs AHEAD of
  review, in the docket, under 047's single-flight. The cost is paid before the
  person sits down; the browser may close. Review is per-item and resumable —
  each piece commits as its own dated sitting and the next waits.
- ~~Does an imported item get a Target?~~ **RULED — Q-60.** None, and no
  control is offered. Q-55 made Target a filter that never relaxes, so a wrong
  Target silently removes the material from half of all sittings while an
  absent one serves both. A heterogeneous folder has no true batch-level
  answer.
- ~~What happens on RE-import of a changed file?~~ **RULED — Q-59.** Identity
  is the content hash; identical → skip. A changed file is a NEW ITEM — a
  second dated sitting at `lastmod` — never a new snippet version, because
  versioning it would date 2027 prose to 2018 and corrupt Q-50 at the root.
  The edited post becomes its own evidence of drift instead.

**All open questions are now ruled. This ticket is ready to plan.**

### Acceptance

- An archive imports as dated sittings whose `started` values span the real
  range, verified against the source.
- Every snippet is an exact substring of its SOURCE file — asserted against the
  files, never against the transcript the importer itself wrote.
- Nothing is written before a review is shown and accepted.
- Re-running imports nothing twice.
- The review surface obeys the document rule, or the ticket records why it
  cannot and what replaced it.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-bulk-import-review.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-bulk-import-review.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-bulk-import-review.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.
