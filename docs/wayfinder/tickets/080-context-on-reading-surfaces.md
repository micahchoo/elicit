---
title: "Build: antecedent context on the wiki surface and randomizer draw — 073's named remainder"
labels: [wayfinder:task]
status: closed
assignee: claude (omp)
blocked_by: []
---

## Question

Ticket 073 landed capture, backfill, and the harvest-review rendering, and
named this remainder honestly: the wiki reading surface and the randomizer
draw still show a snippet's text bare, with its `Provenance.context` and
eliciting question sitting unread in frontmatter. 99 of 139 vault snippets
now carry context (backfill applied 2026-08-02); no reading surface shows it.

Render, matching the harvest-review card's treatment (dimmed, the snippet's
own boundary unmistakable, question and context visually agent-plane): the
wiki surface wherever a cited snippet's text is displayed, and the
randomizer's resurfaced draw. The lineage invariant from 073 stands — the
context is display-only ink, never quoted into anything, never indexed.

Constraint from today's concurrency: `src/wiki/store.ts` and `src/server.ts`
are owned by the ticket-075 agent. If the draw payload or wiki payload lacks
the provenance fields and adding them requires `src/server.ts`, record that
exact seam as the remainder instead of touching the file.

Acceptance: a snippet with context renders it dimmed beside the text on both
surfaces; a snippet without context renders exactly as today (absent is not
an empty box); the ticket-073 invariant test still holds; existing suites
green.

## Resolution (2026-08-02)

Built by Claude (omp) in two parallel slices. Status is open-with-remainder:
the wiki surface is fully rendered, and the randomizer draw now carries its
lineage in the payload, but the response seam that would carry it to the
frontend sits in `src/server.ts`, which this ticket forbids touching. The
exact seam is recorded below.

### What was built

**Wiki surface — rendered** (`web/main.ts` + `web/style.css`):
- `lineageBlock(question, context)` — a shared helper producing the exact
  harvest-review treatment: `div.lineage-provenance` (font-ui, 0.72rem,
  `--dim`, 2px left border) holding an italic up-arrow question and the
  context ending with the em-dash cut boundary. Returns `null` when both are
  absent, so absent lineage renders nothing. `renderProposal` now uses it;
  the CSS classes were consolidated from `proposal-*` to `lineage-*`
  (identical declarations).
- `quoteBlock(prose, iso?, prov?)` — prepends the lineage block inside the
  blockquote, above the prose, when the snippet's provenance carries
  question or context.
- `paintWiki` passes `s.provenance` for every cited snippet
  (`quoteBlock(s.prose, s.captured, s.provenance)`), and the contradiction
  exhibits do a best-effort exact match (`s.prose === quoteText`) against
  the loaded snippets — a partial quote matches nothing and renders exactly
  as today.
- `/api/snippets` already returned full `Provenance`, so no server change
  was needed for this surface.

**Randomizer draw — payload carries the lineage** (`src/randomizer/`):
- `DatedSnippet` gains `question?` and `context?` (display-only lineage,
  stamped from `provenance` in `datedSnippets` via conditional spreads).
- `RandomizerDraw` gains `snippetQuestion?` and `context?`; `resurfaceDraw`
  stamps them via conditional spreads. The framed question
  (`resurfaceQuestion`) is untouched — context is never quoted into it, so
  it never enters the transcript. Deck draws never carry either field.

**Tests** (`tests/randomizer.test.ts`, +4):
- resurfaced draw carries the snippet's question and context verbatim;
- both fields absent AND keys absent when the provenance holds nothing;
- the resurfacing question never contains the context text (invariant guard
  at the draw seam);
- a deck draw never carries lineage.

### Remainder — the one seam that needs `src/server.ts`

The randomizer draw's lineage reaches the frontend only through the session
response, and that response is shaped in the forbidden file:

- **Seam:** `src/server.ts`, POST `/api/session`, response construction
  (~lines 686-692): `return c.json({ sessionId, question, target,
  ...(draw && draw.question === opener.text ? { source: draw.provenance }
  : {}) })`.
- **Fix, when the file is free:** forward the draw's lineage when it exists
  and the opener is a resurfacing draw — conditionally spread
  `snippetQuestion` and `context` off `dealt.draw` into the response (both
  are already optional on `RandomizerDraw`; absent provenance keeps them
  absent).
- **Frontend follow-up (web/main.ts, already structured for it):**
  `begin()` stores the two fields on state, and `renderExchange` renders
  `lineageBlock(state.lineageQuestion, state.lineageContext)` above the
  question block, so the dimmed question and context sit above the
  resurfaced prose exactly as on the wiki and review card.

### Verified

- `npx tsc --noEmit`: clean.
- `npm test`: 48/48 files, 1292/1292 tests pass — includes the ticket-073
  invariant test and the 4 new randomizer tests.
- `npx vite build`: succeeds.

## Remainder wired (2026-08-02, closes the ticket)

The one recorded seam landed once `src/server.ts` freed up, exactly as
specified above:

- `src/server.ts` POST `/api/session` response now conditionally spreads
  `...(draw.snippetQuestion ? { snippetQuestion: draw.snippetQuestion } : {})`
  and `...(draw.context ? { context: draw.context } : {})` — absent
  provenance keeps both keys absent.
- `web/main.ts`: `SessionResponse` declares the two optional fields;
  `begin()` stores them as `lineageQuestion`/`lineageContext`; the opener
  exchange renders `lineageBlock(...)` above the question block via
  `openerLineage`, and both turn-advance sites (probe branch and
  `takeNextQuestion`) null the state and remove the block, so lineage never
  outlives the resurfaced opener.

Verified under the settled tree by the ticket-068 suite run: `npx tsc
--noEmit` clean; `npm test` 1307/1309 — the 2 failures are the ticket-077
registry oracle flagging `src/import/body.ts` (ticket 058's concurrent,
separately-owned namespace), nothing in this ticket's surfaces.
