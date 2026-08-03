# Interface design references

The interface draws from focus-friendly markdown editors, not from chat apps
or productivity dashboards. The reference class: iA Writer, Typora,
ghostwriter, WriteRoom/FocusWriter, Bear, Ulysses, Zettlr, Obsidian zen mode.

What to take from them:

- **One column, no chrome.** The Q&A screen shows the question and the answer
  field. Queues, Directions, and the Wiki stay off-screen until summoned.
- **Focus dimming.** While the user writes, everything but the current
  paragraph recedes (iA Writer focus mode). Agent probes arrive quietly in
  the dimmed layer, not as chat bubbles.
- **Typewriter scroll.** The caret stays vertically centered during long
  answers.
- **Live markdown, no split pane** (Typora). What the user types is what the
  Snippet is.
- **Typography does the hierarchy.** One good duospace/serif face, size and
  weight instead of borders and cards. Monochrome base; color reserved for
  Marginalia and Contradiction flags.
- **No settings fiddling** (iA Writer's stance): strong defaults, few options.

Per-screen consequences:

- **Q&A screen**: indistinguishable from a quiet writing app that happens to
  ask questions. The Protocol changes pacing and affordances, never the calm.
- **Reviewer**: stacking stays subdued — Snippet blocks read as paragraphs
  first, blocks second. Marginalia sits literally in the margin, dimmed
  until hovered. Gaps are quiet empty slots, not alert boxes.

## The document rule (added 2026-08-01, after the first wireframe pass)

The first end-state wireframes failed by accretion: button rows, status
chips, managed lists — an admin panel in quiet colors. The correction is one
rule that subsumes the bullets above: **every surface is a page of text;
controls exist only at the point of attention, in the margin, on focus.**

Consequences the board (`elicit-interface`) now encodes:

- The home surface is a dated page that *says* what waits, in sentences —
  not a dashboard of lists. Navigation is two dimmed words in a margin.
- Mode declaration is a typed sentence ("10 quiet minutes, about myself"),
  not three dropdowns.
- Harvest is re-reading your own words as continuous prose with proposed
  cuts pre-underlined — keep by touching a span, trim by dragging its edge.
  Never rows with per-row button sets.
- The wiki reads as a long essay in two inks: agent claims in light ink,
  the user's quoted words in dark serif. Range is an em-dash clause in the
  sentence; cites ARE the dated quotes. Facets are section headings.
- Claim verbs appear only when a claim is focused, as six small margin
  words (yes · no · narrower · unlink · push down · rewrite); the page dims
  around the focused claim.
- A contradiction is typeset as two facing quotes with dates — an exhibit,
  never an alert. Status is carried typographically (ink weight), not by
  chips.
- Time is a scrollbar: dragging back re-renders the essay as it stood then
  (the re-reading surface is the wiki under a time lens, not a separate
  room).

## The verb-grammar rule (added 2026-08-02)

The document rule is the display grammar of two verbs — writing and
reading — and had been over-applied to all five verbs. Each verb earns its
own surface:

- **writing/dictating** = the void (full-bleed input, context dimmed, no
  feedback until done).
- **reading** = the essay (hierarchy, ink as evidence, navigation only).
- **reviewing** = the queue (verdict state per item, progress count,
  consequence-weighted verbs).
- **correcting** = the diff (before/after co-visible, constraint stated,
  live validation, explicit commit and cancel).
- **composing** = the board (overview plus detail, drag affordances, draft
  vs committed visible).

The rule: a surface renders its dominant verb's grammar; secondary verbs
enter as explicit mode shifts — chrome arrives on entry and leaves on exit,
never interleaved at rest. The exchange's focus dimming and the defer-row
reveal are the existing precedents.
