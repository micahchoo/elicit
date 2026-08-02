---
title: "Build: record the capture channel on every Snippet"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 4)
blocked_by: []
---

> PART ONE LANDED 2026-08-02 (commit 28202cd). `Provenance.channel` is
> declared and round-trips through the vault, with absent-stays-absent proven
> on disk. It rode Wave 0 of the Clerk plan rather than reopening
> `src/types.ts` after T1 closed it.
>
> STILL OPEN: the three capture PATHS must actually set it — turn,
> unprompted, restatement. The client knows a paste from a keystroke; the
> server cannot infer it, so it must be sent. Blocked on `src/server.ts`,
> held by ticket 043.
>
> HAZARD, verified directly: a PRESENT `channel: undefined` key throws in
> `matter.stringify` (js-yaml: "unacceptable kind of an object to dump") and
> loses the whole snippet write, not just the field. Conditional spread only,
> never `channel: body.channel`.
>
> OPEN QUESTION raised by T1, recorded rather than guessed: `Turn.spoken` and
> `Provenance.channel` are two carriers of one fact and can only be kept in
> agreement by deriving one from the other at a single site. The cleaner shape
> is to replace `Turn.spoken?: true` with `Turn.channel?` — one vocabulary at
> both levels. But the two levels genuinely differ for `pasted`: pasting into
> the answer box produces a typed-looking transcript turn, so derivation alone
> cannot cover all three paths and the client must still send the
> Snippet-level value on unprompted and restatement.

> DEFERRED 2026-08-02 by file contention, not by doubt. The three capture
> paths all run through `decide()` in `src/harvester/harvester.ts`, which
> ticket 037 holds. Sequence it AFTER 037 lands: 037 may change what `decide`
> receives, and the channel wants to ride that shape rather than be retrofitted
> onto it. Design settled while looking: the server keeps an index-aligned
> per-turn channel on `SessionState` (same lifetime as `openQueueEntryId`),
> `decide()` gains a `channelOf` reader for approve/trim, and the restatement
> carries its own channel on the decision — because the user may paste a
> restatement into the review box and no derivation from the turn can see that.

## Question

From the 2026-08-02 HANDOFF review, and the honest completion of ticket 046.

046 made CONTEXT.md and the README say the true thing: Sole Authorship
guarantees that no agent wrote or reworded your words, and does NOT guarantee
you are the author. Pasted text is indistinguishable from reflection.

The review's observation is that this is only true AFTER capture. Typed,
spoken and pasted are all distinguishable the moment they arrive — the
transcript Turn already carries `spoken` for voice — and the distinction is
lost forever one tick later. One field added now stops the corpus quietly
filling with other people's sentences.

Build: `Provenance.channel: 'typed' | 'spoken' | 'pasted'`, set at capture on
every path (turn, unprompted, restatement). The client knows a paste from a
keystroke; the server cannot infer it, so it must be sent. Absent stays absent
for every snippet already on disk — this is evidence, not a gate, and nothing
filters on it until a later decision says it should.

## Resolution (2026-08-02)

All three capture paths now set `Provenance.channel`. The server keeps an
index-aligned per-turn channel on `SessionState.turnChannels` (one slot per
user turn, in the same ordinal space `CutProposal.sourceTurn` uses, in-memory
only — the same lifetime class as `openQueueEntryId`); `decide()` gains a
`channelOf` reader for approve/trim; a restatement carries its own channel on
the decision, because the user may paste a restatement into the review box and
no derivation from the turn can see that. `Turn.spoken` stays as-is — the two
vocabularies are NOT unified in this ticket (deferred, as recorded above).

Files touched: `src/types.ts` (`CaptureChannel` type; `HarvestDecision.channel`;
`SessionState.turnChannels`; `Provenance.channel` retyped), `src/harvester/harvester.ts`
(`decide` gains optional `channelOf`; conditional spreads on approve/trim and
restate provenance), `src/server.ts` (turn/unprompted/harvest endpoints accept
and record the channel; `isCaptureChannel` validation, module-private), `web/main.ts`
(paste detection and channel sending at all three capture sites),
`tests/capture-channel.test.ts` (new — 11 tests). `src/registry.ts` untouched:
no new runtime exports — `CaptureChannel` is a type and the validators are
module-private. `web/style.css` untouched.

Mechanism: the client sends the channel on every capture request (turn body
`channel`, unprompted body `channel`, restate decision `channel`); the server
validates it (a present non-vocabulary value is a 400 — a client bug class) and
records it per user-turn ordinal, pushing `undefined` when absent so ordinals
never shift. `decide()` resolves approve/trim channels through `channelOf`
(proposal.sourceTurn → `state.turnChannels`), and restatement channels from the
decision itself. Unprompted sessions have no `SessionState`, so their single
turn's channel rides `unpromptedChannels` (a session-keyed map) until harvest.

Paste-detection rule (exact): each text box keeps a running `pastedChars`
counter — a `paste` event adds the clipboard text length; an `input` event
resets it to 0 whenever the box's value is empty, so it only ever counts pasted
characters still present. On submit, the capture is `'pasted'` iff pasted
characters are a STRICT MAJORITY of the submitted text (`pastedChars * 2 >
text.length`); a tie or less falls through. Precedence on the answer box:
pasted > spoken (the turn included dictation, `turnHadSpeech`) > typed
(default). Unprompted and restate boxes: pasted > typed. The counter resets at
submit.

HAZARD honored: conditional spread ONLY — a present `channel: undefined` key
throws in `matter.stringify` (js-yaml "unacceptable kind of an object to dump")
and loses the whole snippet write, so every provenance build uses
`...(x !== undefined ? { channel: x } : {})`. Absent stays absent for every
snippet already on disk; nothing filters or scores on the field.

Deliberate behavior changes: none for older clients — an absent channel is
accepted and stays absent (existing e2e/unprompted tests pass unchanged); the
only new rejection is an invalid non-undefined channel (400).

Verification: `npx tsc --noEmit` exit 0; `npm test` 58 files, 1383 passed,
2 skipped (includes the 11 new capture-channel tests); `npx vite build` clean.

Remainders: `Turn.spoken` ↔ `Provenance.channel` unification (one vocabulary at
both levels) remains open and is blocked on the derivation problem recorded
above; nothing filters on the field yet — by design, it is evidence, not a gate.
