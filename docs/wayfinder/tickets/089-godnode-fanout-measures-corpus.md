---
title: "Fix: lint.godNodeFanout measures corpus size, not fan-out"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 7)
blocked_by: []
---

## Question

From RESULTS §16.8. `lint.godNodeFanout=12` fires on every facet exceeding
12 claims — but facets are a closed vocabulary of eight, so every common
facet exceeds 12 on any real corpus. The shadow record measures corpus
size, not fan-out. Either scope the fanout to referents (where a god-node
is a real risk — T11's open question) or scale the threshold with corpus
size. Decide with the shadow record in hand; record the reasoning in the
threshold register (graduatesWhen).

Acceptance: the facet-fanout false-positive class is gone from the shadow
log on the 144-claim corpus; the register entry's reason updated; suite
green.

## Resolution (2026-08-03) — scoped to referents; the facet reading measured corpus size

**The decision.** `lint.godNodeFanout` now groups live claims by the registry
referent slugs they name (`c.referents`, deduped within a claim via `new
Set`), fires when one referent is named by more than `t.value` live claims,
and emits the finding kind `god-node-referent` (was `god-node-facet`). The
value (12) and liveness (false) are unchanged.

**Why referents and not scaled facets.** The shadow record shows the facet
reading measured corpus size, not fan-out. Facets are a closed vocabulary of
eight, so the count on `facet=fact` climbed monotonically with the corpus —
15→20→27→34→36→42→48→49 — while the vocabulary stood still. A category with
many members is not a god-node; no threshold scaling with corpus size can fix
a predicate that fires on every common category of any real corpus. A god-node
is one registry entity named by many claims — the same node-dominance hazard
`REFERENT_FANOUT_CAP` bounds quadratically in `src/wiki/clash.ts`. The
'no split op' consequence (Q-31) is unchanged: the finding is a note, never a
removal.

**BEFORE — the shadow record (SOURCE lines, all `shadow-decision`
`threshold=lint.godNodeFanout value=12`):**

- `vault/log/2026-08-02.jsonl:73` — `facet=fact claims=15` (first pass;
  line 72 is the adjacent `referent-minted slug=archie`)
- `vault/log/2026-08-02.jsonl:108` — `facet=fact claims=20`
- `vault/log/2026-08-02.jsonl:148-149` — `episode=13`, `fact=27`
- `vault/log/2026-08-02.jsonl:336-338` — `construct=15`, `episode=17`, `fact=34`
- `vault/log/2026-08-02.jsonl:674-676` — `construct=16`, `episode=21`, `fact=36`
- `vault/log/2026-08-02.jsonl:1121-1124` — `construct=24`, `episode=25`, `fact=42`, `general-event=15`
- `vault/log/2026-08-02.jsonl:2124-2127` — `construct=31`, `episode=25`, `fact=48`, `general-event=18`
- `vault/log/2026-08-02.jsonl:3170-3171` — `construct=31`, `episode=25` (partial pass)
- `vault/log/2026-08-03.jsonl:49-52` — **last pass: FOUR facet findings** —
  `construct=31`, `episode=25`, `fact=49`, `general-event=18`

So the class fired four findings per pass, every pass, growing with the
corpus — the false-positive class the ticket names.

**AFTER — the new predicate, measured (`scripts/measure-089-godnode.ts`, new;
patterned on `scripts/remeasure-087-mint.ts`, read-only — noop log, no vault
writes; run with `npx tsx scripts/measure-089-godnode.ts`):**

```
vault: 152 claims, 152 live (0 archived/superseded), 156 snippets, 152 readings, 5 referents
live-claim-per-referent distribution (the after-count is grounded in this):
  archie: 1 live claim(s)
  are-na: 1 live claim(s)
  channapatna-team: 1 live claim(s)
  iiif: 1 live claim(s)
  janastu: 1 live claim(s)
lint findings by kind, lint.godNodeFanout flipped live:
  (none)
god-node-referent findings: 0
god-node-facet findings: 0
```

`god-node-referent` findings with the threshold flipped live: **0** — every
referent is named by exactly one live claim, and the facet-fanout class is
gone structurally: the predicate no longer groups by facet at all (the
facet distribution the script prints for contrast still shows the old
class — fact=49, construct=31, episode=25, general-event=18 — all above the
fanout, all now silent).

**Files touched:** `src/wiki/lint.ts` (godNodeFindings re-scoped + header),
`src/wiki/contract.ts` (kind union), `src/queue/source-label.ts` (lintNote
label key + new label 'one name now carries many claims'),
`src/wiki/thresholds.ts` (graduatesWhen records this decision + doc-comment
example), `docs/superpowers/plans/2026-08-02-the-clerk.md` (ledger cell,
LintFinding type line, shadowDecision example, findings bullets, creates
table), `tests/wiki-lint.test.ts` (god-node describe rewritten: fatReferent
helper, two-referent + no-referent case added), `tests/queue-source-label.test.ts`,
`tests/log-format.test.ts`, `tests/wiki-thresholds.test.ts`,
`tests/wiki-contract.test.ts` (would-strings migrated to
`note god-node on referent=archie`), `scripts/measure-089-godnode.ts` (new),
and this ticket.

**Deliberate non-changes:** `docs/decisions/elicit.md` Q-31 is the historical
decision record and the principle it states — lint notes, never removes — is
unchanged; left as-is. `docs/superpowers/plans/2026-08-02-the-clerk.RESULTS.md`
and the historical shadow-log quotes it carries were left verbatim (they
record what the old predicate emitted at the time).
`docs/wayfinder/tickets/008-build-clerk.md`'s sequencing note naming this
ticket is unchanged. The threshold key `lint.godNodeFanout` itself is
unchanged. `src/registry.ts` and ticket 074's in-flight files were untouched.
`./vault` shows no changes (`git status` clean there).

**Verified:** targeted `npx vitest run tests/wiki-lint.test.ts
tests/wiki-thresholds.test.ts tests/log-format.test.ts
tests/queue-source-label.test.ts tests/wiki-contract.test.ts` — 5 files,
207 tests passed. `npx tsx scripts/measure-089-godnode.ts` — output above.
A grep for `god-node-facet|god-node on facet` across src/, web/, tests/ and
the clerk plan returns nothing. Driver verification remains: `npx tsc
--noEmit` and the full suite, which this ticket does not run. Nothing
committed; the tree ships uncommitted for driver review.
