---
title: "Build: Randomizer draws — deck shuffle + forgotten-snippet resurfacing"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

> UNBLOCKED 2026-08-02: 004-transformative-deck closed.

## Question

Q-18 locks the design (shuffle never invent; two sources: user-curated
decks, depth-stratified resurfacing of forgotten snippets; agent may not
veto); ticket 004 curates the deck CONTENT; nothing builds the DRAW. Audit
gap found 2026-08-01.

Build: deck storage format (vault markdown, Q-3), the two draw channels,
license check (dry spell / stale region — Q-16, from activity + queue
history), the Mode-screen "shuffle a deck" sentence (see board
`elicit-interface`), and question Provenance carrying deck/resurfacing
source.

## Resolution (2026-08-02) — commit `287cc63`

New module `src/randomizer/` — deliberately not `src/queue/`, because the
Randomizer reads snippets, transcripts, decks and the Activity Log and never
touches a queue entry; filing it under `queue` would imply it draws from one.

**Q-18 is enforced structurally.** No model handle exists anywhere in the
module — verified by grep, asserted by test. The agent cannot invent a "random"
question because it has nothing to invent one with.

**Depth stratification is two levels, and the corpus forced it.** 76 of the 139
snippets are one sitting (the March 2020 capstone), so a flat draw is a draw
from March 2020 more often than not — and band-only does not fix it, because
`deep` is 89 snippets of which 76 are the capstone. Band → sitting → snippet
defeats both the era skew and the document skew. Bands hold **89 / 31 / 16 / 3**
against the real vault, all non-empty.

**Snippets are dated by their sitting's `started`, never by `captured`.** The
import gave 139 snippets a capture date of today and a written date spanning
nine years; dating by capture would have collapsed the entire corpus into
`recent` and made stratification meaningless on the only corpus that exists.

**Q-16's two clauses were split**, because they pull apart. A user shuffle
reaches the pool with no license in its path — refusing an explicit shuffle is
the veto Q-16 forbids — while a system-initiated offer needs a ground AND a
graduated threshold. The license is still computed and logged beside a user
draw, as free evidence.

"Forgotten" is the 30-day cooldown, not the `recent` band: depth makes old
material reachable, the cooldown makes it forgotten. Excluding `recent` would
delete a band rather than de-weight it.

Resurfaced prose is never truncated — trimming it would be the agent editing
the person's words (Q-1).

44 tests; 21 mutations, 21 caught. Two initially survived and exposed a bad
test: 20 sequential draws against one root accumulated cooldowns that shifted
the index into a thin band, so the strata test was measuring the cooldown
wearing stratification's clothes.

### Doc-vs-tree disagreements, code followed in each

- The ticket says decks are vault markdown; the curated decks are JSONL in
  `data/decks/` (ticket 042 already recorded that nothing loads them). Both are
  supported: shipped JSONL as repo assets, hand-written vault markdown as the
  user-curated path Q-18 names. A vault deck **replaces** a shipped deck by
  name — that is what "the user retains prune authority" looks like.
- Ticket 004's resolution says 250 entries in one deck; the tree has **371
  across two** (`transformative` 178, `episodes` 193) because 042 re-curated
  and 004 was never updated.
- `docs/interface-references.md` says Mode is "a typed sentence, not three
  dropdowns"; the screen is three dropdowns. Matched the code.

## Resolution (2026-08-02) — commit `287cc63`

New module `src/randomizer/` — deliberately not `src/queue/`, because the
Randomizer reads snippets, transcripts, decks and the Activity Log and never
touches a queue entry; filing it under `queue` would imply it draws from one.

**Q-18 is enforced structurally.** No model handle exists anywhere in the
module — verified by grep, asserted by test. The agent cannot invent a "random"
question because it has nothing to invent one with.

**Depth stratification is two levels, and the corpus forced it.** 76 of the 139
snippets are one sitting (the March 2020 capstone), so a flat draw is a draw
from March 2020 more often than not — and band-only does not fix it, because
`deep` is 89 snippets of which 76 are the capstone. Band → sitting → snippet
defeats both the era skew and the document skew. Bands hold **89 / 31 / 16 / 3**
against the real vault, all non-empty.

**Snippets are dated by their sitting's `started`, never by `captured`.** The
import gave 139 snippets a capture date of today and a written date spanning
nine years; dating by capture would have collapsed the entire corpus into
`recent` and made stratification meaningless on the only corpus that exists.

**Q-16's two clauses were split**, because they pull apart. A user shuffle
reaches the pool with no license in its path — refusing an explicit shuffle is
the veto Q-16 forbids — while a system-initiated offer needs a ground AND a
graduated threshold. The license is still computed and logged beside a user
draw, as free evidence.

"Forgotten" is the 30-day cooldown, not the `recent` band: depth makes old
material reachable, the cooldown makes it forgotten. Excluding `recent` would
delete a band rather than de-weight it.

Resurfaced prose is never truncated — trimming it would be the agent editing
the person's words (Q-1).

44 tests; 21 mutations, 21 caught. Two initially survived and exposed a bad
test: 20 sequential draws against one root accumulated cooldowns that shifted
the index into a thin band, so the strata test was measuring the cooldown
wearing stratification's clothes.

### Doc-vs-tree disagreements, code followed in each

- The ticket says decks are vault markdown; the curated decks are JSONL in
  `data/decks/` (ticket 042 already recorded that nothing loads them). Both are
  supported: shipped JSONL as repo assets, hand-written vault markdown as the
  user-curated path Q-18 names. A vault deck **replaces** a shipped deck by
  name — that is what "the user retains prune authority" looks like.
- Ticket 004's resolution says 250 entries in one deck; the tree has **371
  across two** (`transformative` 178, `episodes` 193) because 042 re-curated
  and 004 was never updated.
- `docs/interface-references.md` says Mode is "a typed sentence, not three
  dropdowns"; the screen is three dropdowns. Matched the code.

## Resolution (2026-08-02) — commit `287cc63`

New module `src/randomizer/` — deliberately not `src/queue/`, because the
Randomizer reads snippets, transcripts, decks and the Activity Log and never
touches a queue entry; filing it under `queue` would imply it draws from one.

**Q-18 is enforced structurally.** No model handle exists anywhere in the
module — verified by grep, asserted by test. The agent cannot invent a "random"
question because it has nothing to invent one with.

**Depth stratification is two levels, and the corpus forced it.** 76 of the 139
snippets are one sitting (the March 2020 capstone), so a flat draw is a draw
from March 2020 more often than not — and band-only does not fix it, because
`deep` is 89 snippets of which 76 are the capstone. Band → sitting → snippet
defeats both the era skew and the document skew. Bands hold **89 / 31 / 16 / 3**
against the real vault, all non-empty.

**Snippets are dated by their sitting's `started`, never by `captured`.** The
import gave 139 snippets a capture date of today and a written date spanning
nine years; dating by capture would have collapsed the entire corpus into
`recent` and made stratification meaningless on the only corpus that exists.

**Q-16's two clauses were split**, because they pull apart. A user shuffle
reaches the pool with no license in its path — refusing an explicit shuffle is
the veto Q-16 forbids — while a system-initiated offer needs a ground AND a
graduated threshold. The license is still computed and logged beside a user
draw, as free evidence.

"Forgotten" is the 30-day cooldown, not the `recent` band: depth makes old
material reachable, the cooldown makes it forgotten. Excluding `recent` would
delete a band rather than de-weight it.

Resurfaced prose is never truncated — trimming it would be the agent editing
the person's words (Q-1).

44 tests; 21 mutations, 21 caught. Two initially survived and exposed a bad
test: 20 sequential draws against one root accumulated cooldowns that shifted
the index into a thin band, so the strata test was measuring the cooldown
wearing stratification's clothes.

### Doc-vs-tree disagreements, code followed in each

- The ticket says decks are vault markdown; the curated decks are JSONL in
  `data/decks/` (ticket 042 already recorded that nothing loads them). Both are
  supported: shipped JSONL as repo assets, hand-written vault markdown as the
  user-curated path Q-18 names. A vault deck **replaces** a shipped deck by
  name — that is what "the user retains prune authority" looks like.
- Ticket 004's resolution says 250 entries in one deck; the tree has **371
  across two** (`transformative` 178, `episodes` 193) because 042 re-curated
  and 004 was never updated.
- `docs/interface-references.md` says Mode is "a typed sentence, not three
  dropdowns"; the screen is three dropdowns. Matched the code.
