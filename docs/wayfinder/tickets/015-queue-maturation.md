---
title: "Queue maturation: exposure control and uptake — waits on usage data"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

> UNBLOCKED 2026-08-02: 002-slice2-results, 004-transformative-deck closed.

> PARTIALLY OVERTAKEN 2026-08-02: ticket 042 shipped the facet-balance
> filter (shadow-first) and 045 adds the Target filter. What remains here is
> exposure control (needs the asked-history), uptake-as-signal (needs
> ticket 041's answered state), and FSRS horizons — all data-bound.

## Question

Implement the two locked-but-unbuilt Q-13 filters: form-exposure via
asked-history, and facet-balance's shadow session via aggregated readings.

> NARROWED 2026-08-02. The Q-18 randomizer draws were listed here AND in
> [Build: Randomizer draws](026-randomizer-build.md), which specifies them
> properly. They belong to 026 alone; double-counting them made this ticket
> look bigger than it is and 026 look optional.

> NOT TAKEABLE YET, and this is the honest reason rather than a claim. What
> remains is data-bound in a way the rest of the map is not. Exposure control
> needs an asked-history; uptake-as-signal needs `answeredAt`, which ticket 041
> landed on 2026-08-02 and which therefore has **zero** rows; FSRS horizons need
> weeks of real sittings. The 139 imported snippets (ticket 057) are CORPUS, not
> usage — they were never asked, never drawn, never answered, so they add
> nothing to any of these three.
>
> Building these now means calibrating three mechanisms against an empty table
> and shipping them in shadow (Q-35) where their record would stay empty. The
> graduation condition is the ticket's real blocker: come back when the Activity
> Log holds a month of drawn and answered questions. Q-35 was written for
> exactly this situation — mechanisms earn the right to act, and there is
> nothing yet for these to earn it on.

> CODEX PRECEDENT 2026-08-02 (research-codex-lessons.md, lesson 6) — one
> piece is NOT data-bound and should not wait: the stamps themselves.
> Codex's phase-2 memory selection ranks by usage_count, then most-recent
> last_usage/generated_at, with a max_unused_days window and a
> fresh-never-used fallback. That schema names exactly what to start
> logging NOW — a usage stamp on claims and snippets when they are
> surfaced (drawn, cited on a reading surface, quoted in a composed
> question) — so the month of data this ticket waits on starts
> accumulating today instead of the day the ticket is picked up. Stamps
> are Activity-Log lines, not new state; the aggregation stays here,
> data-bound as ruled.

## Stamps landed (2026-08-02)

The usage stamp exists and started logging today. Kind `surfaced`, one
Activity-Log line per surfacing act: the artifact ids in `refs`, the
surface in the detail (`surface=draw|wiki|composed-question`). Written by
`src/log/surfaced.ts` (declared live in the mechanism registry), rendered
in `src/log/format.ts`, verified by `tests/surfaced.test.ts` (real routes,
real log) and the emitted-kinds sweep. No counters, no aggregation, no
state beyond the log lines.

Stamping now:

- `draw` — a randomizer resurfacing draw served as the opening question
  (POST /api/session). Refs = the snippet id. Actor `elicitor`.
- `wiki` — GET /api/wiki, one stamp per served claim: refs = the claim id
  plus its `snippetId@version` citations. The default reading stamps the
  live claims; `?all=1` stamps the whole record. Actor `system`.
- `composed-question` — a queue question actually served, at opening
  (POST /api/session) or from the mid-sitting fallback draw (POST
  /api/session/:id/turn). Refs = the entry's `cites`. Actor `elicitor`.
  All four Clerk sources carry cites (composed, still-true,
  contradiction-remeasure, lint-still-true); `user-declared` entries have
  none and do not stamp.

Not stamping yet, and why:

- Deck draws — a dealt card is a curated question, not a claim or
  snippet, and the aggregation this feeds ranks claims and snippets. The
  draw record (`randomizer-drawn`) already carries the card ref.
- /api/snippets — the whole pool is display support, not display; only
  the citations a page actually renders are surfaced material.
- A skipped or deferred question — it stamped when its draw served it; a
  re-show is not a new surfacing.

Aggregation (usage_count, last_usage, max_unused_days window) remains
here, data-bound as ruled: the month of stamps is now accumulating.
