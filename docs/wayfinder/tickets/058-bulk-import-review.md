---
title: "Build: bulk import and review — bringing an existing body of writing into the vault"
labels: [wayfinder:task]
status: open
assignee: 
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

- What does a person point the importer AT? A folder, a zip, a paste, an RSS
  feed? Micah has three sources already: markdown on disk, Leaflet posts, a
  Pixelfed feed. Fetching from the network is a new capability and touches
  ADR-0001's spirit even though it is not a model call.
- Where does the DATE come from when a file has none? Asking per item does not
  scale to hundreds; guessing corrupts the thing that makes import valuable.
  Filesystem mtime is a lie for anything ever copied.
- Import is long-running — measured ~40s per chunk on the clerk model, so a
  real archive is hours. That needs the waiting-state vocabulary and progress,
  and it must survive a closed browser. The docket's single-flight pattern
  (047) is the precedent.
- Does an imported item get a Target? The script writes none, on the grounds
  that nothing was asked and no time was spent, which leaves openers minted
  from it drawable into either kind of sitting (045). Is that right, or should
  import ask once per batch?
- What happens on RE-import of a changed file — a new version (Q-5), a new
  sitting, or a skip? The script skips by session id; that is the cheap answer,
  not necessarily the correct one.

### Acceptance

- An archive imports as dated sittings whose `started` values span the real
  range, verified against the source.
- Every snippet is an exact substring of its SOURCE file — asserted against the
  files, never against the transcript the importer itself wrote.
- Nothing is written before a review is shown and accepted.
- Re-running imports nothing twice.
- The review surface obeys the document rule, or the ticket records why it
  cannot and what replaced it.
