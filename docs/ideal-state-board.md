# Elicit — the ideal state, as a workflow board

Captured 2026-08-02 from the tldraw board `elicit-ideal-state`
(live, editable copy: http://localhost:3002/?board=elicit-ideal-state —
the board persists on the local tldraw server; this file is the in-repo
record). It draws the human and agentic workflows of the harness once all
mapped work is complete, with the project jargon spelled out in place.

Three frames, one contract each:

- **THE PERSON** — every entry consented, every word yours.
- **THE MACHINE** — local models behind code gates; it may offer, never act on you.
- **THE VAULT** — plain markdown is the only truth; every index is disposable.

## THE PERSON

**Sitting** — A 10-20 question interview you choose to start, declaring a
Mode (how much energy/time you have) and a Target (yourself, or a work
domain you know).

**Answer** — Typed, spoken (local voice transcription you can edit), or
pasted — and which of those it was is recorded forever as the capture
channel.

**Sounding** — A consented descent into one thread: each answer becomes the
next question's verbatim foothold. Every rung shows the same three quiet
words — continue / park (resumable) / another day (closed, record kept).

**Harvest review** — The machine proposes cuts from your own words; you
approve, trim, or restate each one. Each cut is shown with the question
that drew it and the sentences before it, so nothing dangles.

**Import** — Point at a folder of your past writing. Each piece is re-read
WHOLE with proposed cuts underlined in place, one piece at a time, dated to
when you wrote it — never to today.

**Wiki reading** — The machine's claim graph about you, always inspectable.
You edit with six verbs: attest, refute, edit range, detach a citation,
propagate, or rewrite the sentence — rewriting makes it YOUR claim.

**Piece (composition)** — Stack your own snippets, drag paragraphs into an
order that says something, write the connecting sentence you were missing,
mark Gaps you cannot fill yet. Export is pure you — no agent prose, ever.

**Randomizer** — A true shuffle of your forgotten material. The model
cannot veto the draw and cannot invent one — architecturally: this code
path has no model handle.

## THE MACHINE

**Elicitor (live, fast model)** — Composes each question, but every
question MUST quote your words verbatim and pass code guards (no echoes, no
repeats, no fake randomness). A question rejected twice falls back to a
fixed floor — never served anyway.

**Harvester (background)** — Proposes snippet cuts that are
character-exact substrings of what you said — enforced in code, so the
model physically cannot reword you. Its output shape is
grammar-constrained at generation.

**Admissibility gates (code, not model opinion)** — Refusals, deflections
and comments on the question stay in the transcript — they are how you
talked, not facts about you. Words you quoted from someone else are never
filed as yours.

**Bud** — A fragment not yet fit to stand alone. Never silently dropped:
held, and later minted into a gap-fill question that asks you for the
missing piece.

**Docket** — The background work queue. Runs after each sitting AND drains
itself until no work remains — deferred work is a claimable record on
disk, so a restart loses nothing. Skips whole jobs when the vault's git
diff says nothing changed.

**Clerk (background, careful model)** — Reads snippets and mints Claims.
It proposes; code disposes: claim status (unconfirmed → evidenced →
contested) is COMPUTED from citations across separate sittings — the model
can never assert its own confidence.

**Contradiction pipeline** — When two claims about one construct look
opposed, it never accuses. It asks you again, differently, in a later
sitting (a re-measure). Often the answer names WHERE each side holds — the
boundary is the prize, not the clash.

**Resonance** — Recall of your own past words — by phrasing (lexical) and
by meaning (embeddings) — surfaced beside a new answer as a juxtaposition:
here is what you said then. Meeting, never confronting.

**Coach** — Advice as margin notes only, inside the app only: options,
never prescriptions. No streaks, no reminders, no guilt — dormancy is
signal, never debt.

**Activity Log** — Every act — human and machine — rendered as plain
sentences on the interface. Zeros render as words ("rejected none"),
because a check that prints nothing cannot be told from a check that is
not running.

## THE VAULT

**Snippet** — One verbatim passage of your prose, immutably versioned
(edits create v2, v1 remains). Carries provenance: which sitting, which
question, what came before it, how it was captured. The only thing claims
and pieces may cite.

**Transcript** — The append-only record of each sitting — including
imported pieces, which become sittings dated to when the prose was
written.

**Claim** — One agent sentence about you + a mandatory Range (where it
holds — no context-free trait claims) + citations. Reaches 'evidenced'
only when separate sittings independently support it.

**Queue** — Banked questions waiting for the right sitting: openers from
your recent words, still-true checks on old material, re-measures,
gap-fills, parked Soundings.

**Git witness** — The vault commits itself after every docket run. A hand
edit and an app write are forever distinguishable in history —
tamper-evidence without ceremony.

## The wiring (31 edges)

The person's loop:

- Elicitor —asks→ Sitting; Queue —banked questions→ Elicitor
- Sitting → Answer; Answer —recorded→ Transcript
- Answer —checked against your past→ Resonance —juxtapositions→ Elicitor
- Elicitor —offers a descent, you consent→ Sounding —parked ladder,
  resumable→ Queue
- Randomizer —resurfaced draws→ Sitting; Snippet —forgotten material→
  Randomizer
- Activity Log —visible on the waiting surface→ Sitting

The harvest path:

- Answer —your words→ Harvester → Admissibility gates
- Gates —proposed cuts→ Harvest review —what you keep→ Snippet
- Gates —fragments→ Bud —gap-fill questions→ Queue
- Import —piece by piece→ Harvest review

The claim path:

- Snippet —readings→ Clerk —mints→ Claim —always readable→ Wiki reading
- Wiki reading —six verbs→ Claim
- Clerk → Contradiction pipeline —re-measure question→ Queue
- Docket —schedules→ Clerk; Docket —commits each run→ Git witness;
  Docket —every act→ Activity Log

The composition path:

- Snippet —your material→ Piece; Piece —new prose becomes snippets→
  Snippet; Piece —gaps mint questions→ Queue
- Coach —margin notes only→ Piece
