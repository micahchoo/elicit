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
