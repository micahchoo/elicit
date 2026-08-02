# The Soundings Slice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sounding runs as working software. Late in a sitting, on a thread that has already held for three turns, the agent offers one descent and states how long it will take; the person accepts or declines in a word, and a decline is never asked again. Inside the descent every question is built from a verbatim phrase of the *previous* answer, three quiet margin words sit under every rung, a counter-driven checkpoint interrupts at the halfway rung, and the descent ends because a counter ran out or because code found the answers echoing — never because a model said so. Parking writes the whole ladder to disk and puts a pointer in the Queue; picking it up composes a fresh question from a compacted view of the ladder, not from the whole thing.

**What this slice does NOT build — a named non-goal, not an omission:** the stateful instruments ticket 011 listed alongside the descent — the five-slot episode probe and the full triadic rep-grid as *scripts with slots*. See *The instruments question* below. They need their own grill before they can be built, and this plan does not touch `src/protocols/`.

**Architecture:** One new namespace, `src/sounding/`, holds the whole descent: six pure modules and one persistence module. It contains no prompt and makes no LLM call. The rung question is composed by `src/clerk/sounding-rung.ts`, a thin wrapper over machinery that already exists — `redLights` + `composeFollowUp` in `src/clerk/composed.ts` — because Q-12 already forces a composed question to contain a verbatim substring of the user's words, which is precisely what "each answer becomes the next question's foothold" means. The one new LLM prompt in the slice is the ladder's one-line summary, and it runs on the Docket, in the background, on the clerk model (Q-48). Seven existing files are patched, each for a stated reason and each with a named owner.

**T19 has landed, so this slice is dispatchable.** Ticket 012 carried a `NOT DISPATCHED` note whose whole reason was that the always-present gate (Q-44) is a control the person presses, and no exchange screen existed to press it on. Commit `8ef5e24` ("clerk: T19 the wiki reading surface — ink, not status words") landed `web/main.ts`, and `renderExchange()` at `web/main.ts:650-967` is the screen the gate rides on. The note is cleared. Its warning is not: **Wave 2 lands gate state and gate UI together**, in one wave, because a server-side gate with nothing to press is inert by construction, and this repo has shipped that failure before.

**Tech stack:** unchanged — TypeScript (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`), gray-matter, ulid, Hono, Vitest, `@mariozechner/pi-ai` → llama.cpp. Two models by role (Q-48): the rung question is live, so it goes to the elicitor model; the ladder summary has nobody waiting, so it goes to the clerk model.

---

## Four constraints that shape everything below

### The gate is a control, not a state field

Q-44 makes the mid-descent gate **always present** — the same three margin words under every rung, never triggered by anything, plus a mechanical checkpoint at the halfway rung. Three consequences run through every task here:

1. **Nothing infers discomfort. Anywhere.** No model is asked whether the person is struggling, no heuristic reads short answers as distress, no field stores a `distressed` boolean. The recorded signal is behavioural only: which gate word was pressed, at which rung, after how long. If a task in this plan seems to want a "is this hard for them?" judgment, the task is wrong, not the constraint.
2. **The checkpoint is a counter.** At rung `ceil(allowance / 2)` the gate stops being three quiet words in the margin and becomes the thing on the screen. It fires on rung index arithmetic and on nothing else, so it fires identically for a person breezing through and a person struggling.
3. **The gate blocks at the checkpoint, and only there.** Ruled 2026-08-02, and it is a DEDUCTION from Q-44's own text rather than a preference, so it is not open to re-litigation by a task that finds it inconvenient:
   - On an ordinary rung the descent advances with the answer. `park, depth kept` and `another day` are live controls at every moment of every rung; pressing either acts immediately, with no confirmation step.
   - `continue` is what answering already does, so on an ordinary rung it renders as the reading of where you are — `continuing · rung 3 of 10` — not as a control. A button that does nothing when pressed teaches the person within two rungs that the gate is decorative, which is the exact opposite of what Q-44 buys.
   - At the checkpoint all three become controls and no next question is composed until one is pressed. That is the one place `continue` is a real choice, and it sits on a counter rather than on a judgment.

   **Why this follows from Q-44 rather than from taste.** Three phrases in Q-44 do the work, and each one is void under the rival design (press-to-advance on every rung):

   - Q-44 says every rung carries the three margin words "**plus** a mechanical checkpoint at the halfway rung". *Plus* makes the checkpoint an addition to the margin words, so it has to be a different thing from them. If every rung blocked, the checkpoint would add nothing to the rung it lands on and the word would be describing nothing.
   - Q-44's rationale says "the counter-based checkpoint **breaks answering-momentum** without diagnosing anyone". Momentum can only be broken where it exists. Press-to-advance means no rung ever builds any, so the clause has no referent and the checkpoint's stated purpose is unachievable.
   - Q-44 says "an **always-available** gate is stronger than detection because **stopping never requires being noticed**". That is a claim about availability, not about compulsion. `park` and `another day` live on every rung satisfy it exactly; requiring a press is a strictly different property, and not the one Q-44 argues for.

   And the rival design lands where Q-47's rationale says not to go: "an uncapped consent-gated descent is how consent becomes an endurance test, however good the gates are". A ten-rung descent that demands a click per rung is that endurance test with a cap on it — the gates would be good and the experience would still be the thing Q-47 exists to prevent.

   One honesty note for anyone re-checking this argument: the phrase "stops being three quiet words in the margin and becomes the thing on the screen" is **this plan's gloss** (item 2 above), not Q-44's wording. The deduction above rests only on Q-44's actual text — *plus*, *breaks answering-momentum*, *always-available* — because an argument that quotes a plan back to itself proves nothing.

   No new `Q-N` was minted for this, deliberately: applying a decision is not the same as making one, and a deduction from Q-44 is Q-44 being applied. T14 step 4 still gathers evidence — not to reopen the ruling, but because the deduction fixes the mechanism and leaves the wording untested.

### Ending is checked on the answer path, not on the gate

Q-46's end conditions are worthless if nothing calls them. **`descentEnd` runs immediately after `addRung`, on every answer, before any next question is composed.** A ladder that hits its cap or starts echoing closes whether or not the person ever touches the gate — which is the whole point of a structural end condition. `applyGate('continue')` calls `descentEnd` too, because the checkpoint's continue is the other path by which the descent proceeds.

Two call sites, one function, and T13's end-to-end walk asserts a descent reaching its cap with the gate untouched. Without that assertion `src/sounding/convergence.ts` is a tested module nothing runs — the inert-mechanism failure in a new costume.

### The rung question is already a solved problem, and the chain runs backwards

Q-45 forbids storing a pre-composed next question. Q-12 requires a composed question to contain the user's quoted fragment as an exact substring, and `src/clerk/composed.ts` already enforces it twice over — `redLights` drops any light whose `phrase` is not a verbatim substring of the turn (`composed.ts:308-310`), and `composeFollowUp` re-checks the question around the phrase and returns `null` rather than ship an unquoted one (`composed.ts:331-376`).

So a rung is: take the answer, find its red lights, compose a follow-up quoting one of them, run it past `checkQuestion` (`src/elicitor/guards.ts:298`). **This slice writes no new question prompt.**

The direction of the chain is the thing to hold on to, because it is easy to state backwards and every task below depends on getting it right:

```
licensing answer ──foothold──> question 1 ──> answer 1 ──foothold──> question 2 ──> answer 2 …
```

A rung is the pair (question asked, answer it drew). The rung's `foothold` is the phrase that *built its question*, so the foothold is a verbatim substring of the **preceding** answer — of the licensing answer for rung 0, and of `rungs[n-1].answer` for rung n. It is emphatically **not** a substring of the answer stored in the same rung; the person has no reason to repeat the phrase back, and a check written that way rejects nearly every real rung.

### The instruments question

Ticket 011's Question named "stateful instruments (five-slot episode probe, full triadic rep-grid) as scripts with slots" in the same breath as the descent. Its **resolution locked five questions and none of them is about instruments**: Q-43 is entry, Q-44 is the gate, Q-45 is park and resume, Q-46 is ending, Q-47 is budget. Every one governs the descent state machine.

So the instruments are a **named non-goal of this slice**, on three grounds:

- No `Q-N` constrains them. This project's rule is that scope arrives locked; building an unconstrained mechanism next to a locked one is how the locked one acquires undocumented dependencies.
- They are a different mechanism. CONTEXT calls Protocols "data, not an enum", and `src/protocols/registry.ts` loads them as markdown with one prompt each. A script with slots is a *stateful protocol runner* — it suspends question selection while active (CONTEXT, Question Source: "Instrument step … suspends selection while active"), it must survive a slot going unanswered, and a rep-grid has to persist a grid. None of that is answered anywhere.
- The descent does not need them. A Sounding chains composed follow-ups; it never fills a slot.

**Action for the wayfinder, not for this plan:** file a grill ticket for stateful instruments, blocked by nothing, naming the three unresolved questions above. This plan does not touch `src/protocols/` and adds no Protocol definition.

---

## Activity Log kinds — every emitting task ships its own rendering

`tests/log-format.test.ts` fails **bidirectionally** on kind drift: a kind emitted with no rendering fails, and a rendering for a kind nothing emits fails too. So a task that adds the emit and a later task that adds the rendering commits a red tree in either order, whichever goes first.

**The rule for this plan: a task that emits a kind adds that kind's `case` in `src/log/format.ts` in the same commit.** There is no separate log task. Three tasks touch `format.ts` and each adds only its own cases.

| Kind | Emitted by | Detail | Renders as |
|---|---|---|---|
| `sounding-license` | T8 | `late=… energy=… sustained=… unoffered=… licensed=…` | the license ran and what it found |
| `sounding-offered` | T8 | `session=… rungs=…` | offered a descent, N questions long |
| `sounding-declined` | T8 | `session=…` | the offer was declined |
| `sounding-entered` | T8 | `session=… sounding=… rungs=…` | began a descent |
| `sounding-rung` | T8 | `sounding=… rung=… of=…` | asked rung N of M |
| `sounding-gate` | T8 | `sounding=… rung=… choice=…` | the gate word pressed, at which rung |
| `sounding-parked` | T8 | `sounding=… rungs=… entry=…` | parked with the depth kept |
| `sounding-ended` | T8 | `sounding=… rungs=… endedBy=…` | the descent closed, and why |
| `sounding-summarized` | T11 | `sounding=… model=…` | wrote one line about a descent |
| `sounding-resumed` | T12 | `sounding=… rungs=… verbatim=…` | picked a descent back up |

Two rules bind every one of them:

- **`scrubIds` still runs on every path.** No ULID reaches the surface — the JSONL keeps identifiers, the page does not (`format.ts:1-7`).
- **No kind renders a judgment about the person.** `sounding-gate` says which word was pressed. It does not say the descent was hard, that the person stopped early, or anything a reader could take as the system's opinion of them. Q-44's recorded signal is behavioural, and the render layer is where a behavioural record most easily becomes a verdict. T8 owns the test that enforces this across every sounding kind.

Note the naming: the license event is `sounding-license`, not `sounding-license-shadow`. Under Q-62 the license is not a shadowed mechanism — it is offer-shaped, so it ships live and owes this record instead. T8 emits it on **every** evaluation, licensed or not, which is what Q-62's "logging every evaluation it makes" requires and what the `0.15` threshold will eventually be re-tuned against.

---

## Flow Map

The descent, as nodes. Task headers name their position against this map, and no task may read this section at execution time — every node name it needs is inlined in its own header.

**Offer path**
`user-turn → license-check → offer-compose → consent-ask → [decline → record-and-never-again] | [accept → enter]`

**Descent path**
`enter → allowance-set → rung-compose → rung-answer → add-rung → end-check → [ended → descent-close] | [checkpoint → gate-block] | [ordinary → gate-render → rung-compose]`

`end-check` is `descentEnd` and it sits on the answer path, before any composition. `gate-block` is the checkpoint, and it is the only node that waits for a press. `gate-render` draws the three words that `park` and `another day` hang off, on every rung.

**Gate path (available from `gate-render` and `gate-block` alike)**
`gate-press → apply-gate → [continue → end-check → rung-compose] | [park] | [another-day]`

**End path**
`descent-close → sitting-close (open door → bookmark)`

**Park path**
`park → ladder-write → queue-pointer → waiting-surface → pick-up → ladder-read → compaction → rung-compose`

**Background path**
`docket-run → ladder-summary-compose → marginalia-write`

---

## Storage layout (Q-3: markdown is truth, indexes derived)

```
vault/
  soundings/
    <soundingId>.md          # the FULL ladder — frontmatter metadata + rungs
  marginalia/
    sounding-summaries/
      <soundingId>.md        # the one-line summary, model-stamped (Q-8, Q-34)
  queue/
    <ulid>.md                # source: parked-sounding, soundingId: <soundingId>
```

`vault/soundings/<id>.md` frontmatter:

```yaml
id: 01K...
session: 01K...
started: 2026-08-02T...
ended: 2026-08-02T...          # absent while live
endedBy: park | another-day | cap | convergence   # absent while live
construct: "the phrase the descent started from"
licensingAnswer: "the whole answer that licensed the descent"
allowance: 9
checkpointRung: 5
rungs:
  - question: "..."
    foothold: "the exact substring quoted, taken from the PRECEDING answer"
    answer: "..."
    at: 2026-08-02T...
```

`licensingAnswer` is stored, not derived. Rung 0's foothold has to be checkable against something, and the turn that licensed the descent lives in the transcript where the ladder cannot reach it. Without this field the invariant is stated in three places and enforceable in none.

Rungs live in frontmatter rather than in the body, matching `queue/*.md` (`src/queue/queue.ts:239`) rather than `transcripts/*.md`. The reason is round-tripping: a parked ladder is *read back* by `resume`, and one YAML parse is one code path where a body-block parser would be a second, hand-written one. T7 owns the round-trip test that makes this claim checkable.

The full ladder stays on disk for good, including after a descent ends by cap or convergence, because Q-45 makes the ladder the truth and the compaction only a prompt-time view. An `another-day` ladder is written too — it is simply not pointed at by a Queue entry.

---

## File Structure

**Created — `src/sounding/` (new namespace, no LLM calls, no prompts):**

| File | Responsibility |
|---|---|
| `src/sounding/license.ts` | Is a Sounding offerable right now? Three mechanical facts, no model. |
| `src/sounding/budget.ts` | Remaining budget → rung allowance, checkpoint rung, and the sentence that states expected length. |
| `src/sounding/convergence.ts` | Structural end conditions: cap, lexical echo, content-free pivot. |
| `src/sounding/ladder.ts` | The state machine: enter, add a rung, apply a gate choice, ask whether it ends. |
| `src/sounding/park.ts` | Ladder ↔ markdown, and the Queue pointer. The only module here that touches disk. |
| `src/sounding/compaction.ts` | Full ladder → last-1-2 verbatim + one summary line. |
| `src/sounding/resume.ts` | Parked pointer → live `SoundingState` + the compacted view to compose from. |

**Created — elsewhere:**

| File | Responsibility |
|---|---|
| `src/clerk/sounding-rung.ts` | The fresh-rung composer, in one place: `composeRung` (from an answer) and `composeFromCompacted` (from a resumed ladder). Wraps `redLights` + `composeFollowUp`; writes no prompt of its own. |
| `src/clerk/sounding-summary.ts` | The one new prompt: a ladder's one-line summary, clerk model, Marginalia-class. |

**Patched — seven files, with named owners:**

| File | Owner | Why it must change |
|---|---|---|
| `src/types.ts` | T1 | `Rung`, `SoundingState`, `GateChoice`, `SoundingEnd`, `ParkedLadder`, `GateReading`; `SessionState` gains `sounding`, `soundingOffer` and `finishedSounding` (the finished-ladder carrier); `QueueEntry.source` gains `'parked-sounding'`; `QueueEntry.soundingId`. |
| `src/index/lexical.ts` | T2 | One exported wrapper over the private `tokenize` + `extractContentWords` pair, plus `jaccard`. The license needs both and must not re-implement them. |
| `src/elicitor/elicitor.ts` | **T6, alone** | The descent branch in `userTurn`, ahead of the existing priority ladder. T5 is a no-code spike and owns nothing; T1 writes only `src/types.ts`, because the finished-ladder carrier lives on `SessionState` rather than on `Probe`. One file, one owner. |
| `src/queue/queue.ts` | T7 | One new **non-relaxable** draw filter excluding `parked-sounding` entries. A parked ladder is a pointer, not a question; if the ordinary draw can hand it to the elicitor, the person gets asked a stale rung out of nowhere. |
| `src/server.ts` | **T8 lands the shell, T12 fills one body.** | T8 writes all four routes and implements three of them; `POST …/sounding/resume` lands as a shell returning 501 with a `TODO(T12)` marker, because its body needs `src/sounding/resume.ts` which does not exist until Wave 3. T12 fills exactly that handler and touches nothing else in the file. |
| `web/main.ts` | T9 (`renderExchange`), T12 (`renderWaiting`) | The offer control and the gate row; then the parked section. Two functions, no overlap. |
| `web/style.css` | **T9 alone** | Every sounding class — the gate row, the offer, the checkpoint state, and the `.parked-*` classes T12 renders against. One task owns the stylesheet so two agents never append competing rules. |
| `src/log/format.ts` | T8 (eight kinds), T11 (one), T12 (one) | Each task adds only its own cases, in the same commit as the emit. See *Activity Log kinds*. |
| `src/clerk/docket.ts` | T11 | One guarded call to the ladder-summary job. |

### File ownership — read this before dispatch

This repo has had cross-agent collisions, and the working tree was being modified by build agents on the day this plan was written. **No task may edit a file it does not own in the table above.** A task that finds it needs a change in someone else's file stops and reports the dependency rather than making it. Where a file has two owners, the table names the exact function or handler each one may touch.

---

## Task 1 — Wave 1

### Task 1: Shared contracts — the Sounding types [CHANGE SITE]

**Orient:** Every later task in this slice reads or writes a ladder, and without one agreed shape for a rung they will each invent one, so this task writes the types before any behaviour exists.
**Flow position:** Wave 0 skeleton for all of them — produces the contract that `license-check`, `rung-compose`, `add-rung`, `end-check`, `gate-render`, `park` and `compaction` all consume.
**Skill:** `tdd`
**Files:**
- Modify: `src/types.ts` (append a `// ── Soundings ──` block after `SessionState`, around line 356). **This task touches no other file** — see the carrier note in the contract below.
- Test: `tests/sounding-types.test.ts`

<contracts>
**Downstream (this-node → every other sounding node):**
- `type Rung = { question: string; foothold: string; answer: string; at: string }`
- `type GateChoice = 'continue' | 'park' | 'another-day'`
- `type SoundingEnd = 'park' | 'another-day' | 'cap' | 'convergence'`
- `type GateReading = { rung: number; of: number; checkpoint: boolean }`
- `type SoundingState = { id: string; session: string; started: string; construct: string; licensingAnswer: string; allowance: number; checkpointRung: number; rungs: Rung[]; pendingQuestion?: { text: string; foothold: string } }`
- `type ParkedLadder = SoundingState & { ended: string; endedBy: SoundingEnd }`
- `SessionState` gains `sounding?: SoundingState`, `soundingOffer?: 'offered' | 'declined' | 'entered'`, and `finishedSounding?: ParkedLadder`
- `QueueEntry['source']` gains `'parked-sounding'`; `QueueEntry` gains `soundingId?: string`
- **`finishedSounding` is the carrier, and it is the ONLY carrier.** When a descent ends on the answer path, `closeDescent` clears `s.sounding` — so without this field the finished ladder is unreachable and the route that must write it has nothing to write. The route reads `state.finishedSounding`, writes the ladder, derives both wire fields from it (`descentClosed: it.endedBy`, `soundingId: it.id`), then clears it. Absent means no descent finished on this turn, which is a different fact from `sounding` being absent (no descent is running).
- **Why on `SessionState` and not on `Probe`.** `src/elicitor/elicitor.ts` already has exactly this pattern: `openQueueEntryId` is set by the elicitor, consumed by the next turn, and `delete`d rather than set to `undefined` (`elicitor.ts:276-279`, and the comment there says why). `finishedSounding` is the same shape of handoff and should look like it. Putting a whole `ParkedLadder` on `Probe` would fatten a type that is otherwise a lean question-plus-provenance record, and it would give the route two places to learn one fact.
- **Deliberate deviation from the review note:** the reviewer offered `SessionState.finishedSounding` *or* `closeDescent` returning the ladder beside the probe. Taking the first made `Probe.descentClosed` redundant — the route can read `endedBy` off the ladder it already holds — so `Probe` gains nothing in this plan and T1 no longer touches `elicitor.ts` at all. Two carriers of one fact drift; one does not. The client-facing `descentClosed` field is unchanged, and is built by the route.
- **Behavioral invariant (the one every task depends on):** `Rung.foothold` is a verbatim substring of the **preceding** answer — `SoundingState.licensingAnswer` for `rungs[0]`, and `rungs[n-1].answer` for `rungs[n]`. It is NOT a substring of the answer in its own rung. `licensingAnswer` exists on `SoundingState` for exactly this reason: rung 0's half of the invariant is otherwise unenforceable, because the licensing turn lives in the transcript and the ladder cannot reach it. T6 enforces this in code; T13 asserts it end to end against the file on disk.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import type { Rung, SoundingState, ParkedLadder, GateChoice } from '../src/types.js';

test('a rung records the foothold its question was built from', () => {
  const r: Rung = { question: 'What do you mean by "the pull"?', foothold: 'the pull', answer: 'It started in a shed', at: '2026-08-02T10:00:00.000Z' };
  expect(r.foothold).toBe('the pull');
});

test('a ladder keeps the answer that licensed it, so rung 0 has something to quote', () => {
  const s: SoundingState = {
    id: 'x', session: 's', started: '2026-08-02T10:00:00.000Z',
    construct: 'the pull', licensingAnswer: 'I keep feeling the pull to be seen working',
    allowance: 9, checkpointRung: 5, rungs: [],
  };
  expect(s.licensingAnswer).toContain('the pull');
});

test('a parked ladder records how it ended', () => {
  const p: ParkedLadder = { ...aLiveLadder, ended: '2026-08-02T10:20:00.000Z', endedBy: 'park' };
  expect(p.endedBy).toBe('park');
});

test('the three gate words are the only gate words', () => {
  const all: GateChoice[] = ['continue', 'park', 'another-day'];
  expect(all).toHaveLength(3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-types.test.ts`
Expected: FAIL — `Rung` is not exported from `src/types.ts`.

- [ ] **Step 3: Add the types**

Append the `// ── Soundings ──` block to `src/types.ts`. Add `'parked-sounding'` to the `QueueEntry['source']` union, `soundingId?: string` to `QueueEntry`, and the three fields to `SessionState`. Every optional field carries a comment saying what its absence means — the file's existing convention (see `QueueEntry.target`, `types.ts:260-269`): absent `sounding` means no descent is running, absent `soundingOffer` means none has been offered yet (a different fact from `'declined'`), and absent `finishedSounding` means no descent ended on this turn.

Nothing outside `src/types.ts` changes in this task. `Probe` is not touched — see the carrier note in the contract — so `src/elicitor/elicitor.ts` has exactly one owner in this plan, which is T6.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and no new type errors. `QueueEntry['source']` is a union nothing switches over (`types.ts:238-245` says so and says why), so widening it must not break `src/queue/queue.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/sounding-types.test.ts
git commit -m "sounding: types for the ladder, the gate, and the parked pointer"
```

---

### Task 2: The entry license — three mechanical facts [CHANGE SITE]

**Orient:** A Sounding is offered, never auto-entered, and the offer itself has to be licensed, or the agent proposes descents into whatever the person happened to say last — this task decides when an offer is permitted, in code, with no model involved.
**Flow position:** Step 2 of 5 in the offer path (`user-turn` → **`license-check`** → `offer-compose`).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/license.ts`
- Modify: `src/index/lexical.ts` (add one exported wrapper — see contracts)
- Test: `tests/sounding-license.test.ts`

<contracts>
**Upstream (`user-turn` → this-node):**
- `SessionState` — `turns: Turn[]`, `questionCount: number`, `mode: Mode`, `soundingOffer?: 'offered' | 'declined' | 'entered'`

**Downstream (this-node → `offer-compose`):**
- `licenseSounding(s: SessionState): { licensed: boolean; reasons: LicenseReasons; construct?: string }`
- `type LicenseReasons = { late: boolean; energy: boolean; sustained: boolean; unoffered: boolean }`
- Behavioral invariant: `licensed` is true only when all four reasons are true. `reasons` is always fully populated even when `licensed` is false, because the record logs what failed, not just that something did.
- `construct` is the content word shared by the last three user turns with the highest frequency inside them — the thread's name, used only as the descent's label. It is NOT a foothold and never reaches a prompt.

**Sideways (`src/index/lexical.ts`) — the real API, not the one you would guess:**
- `extractContentWords` takes `Token[]`, not a string (`lexical.ts:56`), and `tokenize` is private (`lexical.ts:32`). A caller holding a string cannot reach it.
- So this task adds ONE new exported wrapper that adapts both, and exports `jaccard` unchanged:
  - `export function contentWordsOf(text: string): Set<string>` — body is `extractContentWords(tokenize(text))`, three lines, no logic of its own
  - `export function jaccard(a: Set<string>, b: Set<string>): number` — the existing private function (`lexical.ts:65-72`), exported, body untouched
- Behavioral invariant: `tokenize` and `extractContentWords` stay private and stay byte-identical. The Resonance path must behave the same after this task as before it, which its own tests are what prove.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { licenseSounding } from '../src/sounding/license.js';

// A helper that builds a SessionState with N agent/user turn pairs is fine here;
// the license reads turns, questionCount, mode and soundingOffer, nothing else.

test('an early sitting is not licensed, however good the thread', () => {
  const s = sitting({ questionCount: 2, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
  expect(licenseSounding(s).licensed).toBe(false);
  expect(licenseSounding(s).reasons.late).toBe(false);
});

test('a sitting already in its close is not licensed either', () => {
  // budget 20, close begins at 18 — an offer here would eat the two close moves (Q-47)
  const s = sitting({ questionCount: 18, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
  expect(licenseSounding(s).reasons.late).toBe(false);
});

test('a low-energy mode is not licensed', () => {
  const s = sitting({ questionCount: 12, minutes: 20, energy: 'low', userTurns: threeOnOneThread() });
  expect(licenseSounding(s).reasons.energy).toBe(false);
});

test('three turns that share no vocabulary are not a sustained thread', () => {
  const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: ['I cycle to work', 'My sister called', 'Rain again'] });
  expect(licenseSounding(s).reasons.sustained).toBe(false);
});

test('late, energetic, three turns on one thread, never offered — licensed', () => {
  const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
  const v = licenseSounding(s);
  expect(v.licensed).toBe(true);
  expect(v.construct).toBeTruthy();
});

test('a decline is never re-licensed in the same sitting', () => {
  const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread(), soundingOffer: 'declined' });
  expect(licenseSounding(s).licensed).toBe(false);
  expect(licenseSounding(s).reasons.unoffered).toBe(false);
});

test('an accepted offer is not re-licensed either', () => {
  const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread(), soundingOffer: 'entered' });
  expect(licenseSounding(s).licensed).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-license.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/license.js`.

- [ ] **Step 3: Add the lexical wrapper**

Add `contentWordsOf` and export `jaccard` in `src/index/lexical.ts`. Do not change `tokenize` or `extractContentWords`.

Run: `npx vitest run tests/lexical.test.ts tests/semantic-resonance.test.ts tests/resonance-paraphrase.test.ts`
Expected: PASS — unchanged behaviour, including the recorded 0/8 paraphrase recall fixture.

- [ ] **Step 4: Write the license**

Four checks, all mechanical:

```ts
const budget = Math.min(20, Math.max(10, s.mode.minutes));   // the elicitor's own formula
const late = s.questionCount >= Math.ceil(budget / 2) && s.questionCount < budget - 2;
const energy = s.mode.energy !== 'low';
const unoffered = s.soundingOffer === undefined;
const sustained = meanAdjacentJaccard(lastThreeUserTurns) >= SUSTAINED_THRESHOLD;
```

`SUSTAINED_THRESHOLD = 0.15`, exported as a named constant with the comment that it is the one tunable number in the file. `late`'s upper bound matters as much as its lower: past `budget - 2` the close has already begun (`elicitor.ts:308-310`), and a descent offered there would eat the two close moves Q-47 reserves.

**This mechanism ships LIVE, and Q-62 is why.** Q-62 amends Q-35 a second time: a mechanism whose only power is to OFFER — one proposal the person declines in a word, with nothing done on decline — ships live from day one and logs every evaluation; a mechanism that ACTS on its own judgment stays shadow-first. The dividing line is the consequence on silence, and here silence means no descent happens, so the license is an offer. There is no shadow flag, no `ELICIT_*` env gate, and no "would have offered" branch in this file. What the license owes instead is the record: T8 emits `sounding-license` on **every** evaluation with all four reasons, licensed or not, which is what will eventually re-tune `0.15` with evidence behind it.

Nothing in this file asks a model anything, and nothing in it reads emotional state.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/sounding-license.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sounding/license.ts src/index/lexical.ts tests/sounding-license.test.ts
git commit -m "sounding: the entry license — late, energetic, three turns on one thread, offered once"
```

---

### Task 3: The rung allowance and the sentence that states it [CHANGE SITE]

**Orient:** Consent means nothing if the person cannot tell what they are consenting to, so this task turns the sitting's remaining budget into a rung count and writes the sentence that tells them how long the descent runs.
**Flow position:** Step 3 of 5 in the offer path (`license-check` → **`offer-compose`** → `consent-ask`) and step 2 of the descent path (`enter` → **`allowance-set`** → `rung-compose`).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/budget.ts`
- Test: `tests/sounding-budget.test.ts`

<contracts>
**Upstream (`license-check` → this-node):**
- `mode: Mode`, `questionCount: number`

**Downstream (this-node → `consent-ask` and `allowance-set`):**
- `rungAllowance(mode: Mode, questionCount: number): { allowance: number; checkpointRung: number }`
- `expectedLengthSentence(allowance: number): string`
- Behavioral invariant: `8 <= allowance <= 12`, always. `checkpointRung === Math.ceil(allowance / 2)`.
- Behavioral invariant: the two close moves are NEVER inside the allowance. `rungAllowance` computes from `budget - 2 - questionCount` and the caller adds nothing back.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
test('a long remaining budget is capped at twelve rungs', () => {
  expect(rungAllowance({ minutes: 20, energy: 'high' }, 5).allowance).toBe(12);
});

test('a short remaining budget floors at eight rungs', () => {
  // 15m budget = 15; close reserved at 13; entered at question 11 → 2 remaining → floored to 8.
  expect(rungAllowance({ minutes: 15, energy: 'high' }, 11).allowance).toBe(8);
});

test('a mid remaining budget converts straight across', () => {
  // 20m budget = 20; close reserved at 18; entered at question 8 → 10 remaining.
  expect(rungAllowance({ minutes: 20, energy: 'high' }, 8).allowance).toBe(10);
});

test('the checkpoint is the halfway rung, rounded up', () => {
  expect(rungAllowance({ minutes: 20, energy: 'high' }, 5).checkpointRung).toBe(6);
  expect(rungAllowance({ minutes: 15, energy: 'high' }, 11).checkpointRung).toBe(4);
});

test('the consent sentence states a number the person can hold', () => {
  const line = expectedLengthSentence(9);
  expect(line).toContain('9');
  expect(line.toLowerCase()).not.toContain('deep');   // no promise about what it will find
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-budget.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/budget.js`.

- [ ] **Step 3: Write the module**

```ts
const MIN_RUNGS = 8;
const MAX_RUNGS = 12;

export function rungAllowance(mode: Mode, questionCount: number) {
  const budget = Math.min(20, Math.max(10, mode.minutes));
  const remaining = budget - 2 - questionCount;          // the two close moves, reserved (Q-20, Q-47)
  const allowance = Math.min(MAX_RUNGS, Math.max(MIN_RUNGS, remaining));
  return { allowance, checkpointRung: Math.ceil(allowance / 2) };
}
```

**The floor at 8 is ruled, not inferred — Q-63.** When a Sounding is licensed with fewer than 8 questions of budget remaining, the allowance floors at 8 and the sitting grows past its declared minutes. Q-63 takes "a Sounding becomes the rest of the sitting" literally: the descent *is* the sitting from that point, the two close moves stay reserved beyond the allowance, and the consent ask states the real expected length, which is what keeps the overrun consented rather than suffered. The rival reading — license requires ≥8 remaining — was declined, because it makes late-sitting offers rare in exactly the short Modes where a held thread is most worth descending. So `MIN_RUNGS = 8` is a ruled constant: do not make it configurable, and do not add a guard in `src/sounding/license.ts` that refuses to license a short sitting. `expectedLengthSentence` says the number plainly and promises nothing about what the descent will find.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sounding-budget.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sounding/budget.ts tests/sounding-budget.test.ts
git commit -m "sounding: remaining budget becomes the rung allowance, close reserved beyond it"
```

---

### Task 4: Structural end conditions — cap, echo, content-free [CHANGE SITE]

**Orient:** A descent must end for a reason a person could check afterwards, so this task detects the end in code — a counter, a lexical echo, and the pivot heuristic — and never asks a model whether the conversation has converged.
**Flow position:** Step 5 of the descent path (`add-rung` → **`end-check`** → `descent-close` or `rung-compose`). Called on the answer path and from `applyGate('continue')`; see *Ending is checked on the answer path*.
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/convergence.ts`
- Test: `tests/sounding-convergence.test.ts`

<contracts>
**Upstream (`add-rung` → this-node):**
- `SoundingState` with at least one rung, newest last.

**Downstream (this-node → `descent-close`):**
- `descentEnd(s: SoundingState): SoundingEnd | null` — `'cap'`, `'convergence'`, or `null` for "keep going"
- Behavioral invariant: pure. No I/O, no `complete`, no `Date.now()`.
- Behavioral invariant: `'cap'` is checked first, so a ladder that is both full and echoing reports the cap — the simpler, more checkable reason.
</contracts>

- [ ] **Step 1: Write the failing test**

Note the fourth test name: `resonate` returns `[]` for any query under three tokens (`src/index/lexical.ts:222`), so an answer of one or two words can never register as an echo however many times it repeats. That is a real floor on this mechanism and the test name records it rather than leaving a later reader to rediscover it.

```ts
test('a full ladder ends at the cap', () => {
  expect(descentEnd(ladder({ allowance: 8, answers: nineDistinctAnswers.slice(0, 8) }))).toBe('cap');
});

test('a content-free answer ends the descent', () => {
  expect(descentEnd(ladder({ allowance: 12, answers: [...threeRichAnswers, 'dunno'] }))).toBe('convergence');
});

test('two answers of 3+ tokens echoing earlier rungs end the descent', () => {
  const answers = [
    'the pull is about wanting to be seen doing the work',
    'I notice it most when nobody is watching me work',
    'it comes back to wanting to be seen doing the work',
    'again it is about wanting to be seen doing the work',
  ];
  expect(descentEnd(ladder({ allowance: 12, answers }))).toBe('convergence');
});

test('answers under three tokens can never echo — resonate floors at 3 (lexical.ts:222)', () => {
  const answers = ['being seen matters to me a great deal', 'being seen', 'being seen', 'being seen'];
  // 'being seen' is 2 tokens, so resonate returns [] for it; the content-free
  // check is what ends this ladder, and the echo check contributes nothing.
  expect(descentEnd(ladder({ allowance: 12, answers }))).toBe('convergence');
});

test('one echo alone does not end the descent', () => {
  const answers = [
    'the pull is about wanting to be seen doing the work',
    'I notice it most when nobody is watching me work',
    'it comes back to wanting to be seen doing the work',
    'my father built furniture in a shed and never showed anyone',
  ];
  expect(descentEnd(ladder({ allowance: 12, answers }))).toBe(null);
});

test('a short ladder never converges — there is nothing to echo yet', () => {
  expect(descentEnd(ladder({ allowance: 12, answers: ['a rich first answer here', 'a rich second answer here'] }))).toBe(null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-convergence.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/convergence.js`.

- [ ] **Step 3: Write the module**

Three checks in order:

1. `s.rungs.length >= s.allowance` → `'cap'`.
2. `isContentFree(lastAnswer)` (`src/elicitor/answer-shape.ts:56`) → `'convergence'`. This is the pivot heuristic Q-46 names, already in the elicitor and already the thing that decides an answer carries nothing.
3. Both of the last two answers echo an earlier rung → `'convergence'`. Build a `LexicalIndex` over `rungs[0 .. n-3]`'s answers with `buildIndex` and call `resonate(index, answer)` for each of the last two; a non-empty hit list is an echo. Fewer than four rungs means step 3 cannot fire and returns `null`.

**The adapter, and the hazard in it.** `buildIndex` takes `Snippet[]` (`src/index/lexical.ts:174`), and rung answers are not Snippets — they have not passed admissibility, they are not evidence, and none of them is ever written to `vault/snippets/`. Write a local `rungsAsIndexInput(rungs): Snippet[]` inside `convergence.ts` with a comment saying exactly that, and give the synthetic ids a `rung:` prefix so a stray one is obvious in a debugger. If a later reader finds these values escaping this module, that is a bug, not a feature.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sounding-convergence.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sounding/convergence.ts tests/sounding-convergence.test.ts
git commit -m "sounding: structural end conditions — cap, lexical echo, content-free pivot"
```

---

### Task 5 [SPIKE]: What the exchange screen and the session map actually look like today

**Orient:** Build agents were editing this tree on the day this plan was written, so before Wave 2 patches `renderExchange` and `POST /api/session/:id/turn`, one task confirms those seams are still where the plan says they are — a wrong assumption here costs a whole wave.
**Flow position:** Precedes every Wave 2 task; blocks T6, T8, T9.
**Skill:** `hybrid-research`
**Time cap:** one task, no code, no file ownership.
**Files:**
- Read only: `web/main.ts`, `src/server.ts`, `src/elicitor/elicitor.ts`, `src/log/format.ts`, `tests/emitted-kinds.ts`

- [ ] **Step 1: Answer six questions in writing**

1. Does `renderExchange()` still build its controls as `harvestBtn` / `skipBtn` / `laterBtn` plus a `deferRow`, appended to `answerArea` (was `web/main.ts:685-698`)? If the control row has been restructured, record the new shape — T9 appends to it.
2. Does `setControlsBusy(busy)` still exist in `renderExchange` (was `web/main.ts:798-804`)? T9's gate controls must join it or they will race a call in flight.
3. Is `sessions` still a module-level `Map<string, SessionState>` inside `createApp` (was `src/server.ts:440`)? T8 reads and mutates `state.sounding` through it.
4. Does `POST /api/session/:id/turn` still return `{ kind, text, questionForm, phase, juxtaposition? }` (was `src/server.ts:660-666`)? T8 adds three optional fields to that object and one new `kind`.
5. Does `tests/log-format.test.ts` still fail bidirectionally on kind drift — an unrendered emit AND a rendering for an unemitted kind? Record exactly how, because the *Activity Log kinds* rule above depends on it. Both that file and `src/log/format.ts` were modified in the working tree at plan time.
6. Does `userTurn` still run the close branches, then `isContentFree`, then juxtaposition → red-light → generic probe (was `src/elicitor/elicitor.ts:284-396`)? T6 inserts the descent branch after the close branches and before `isContentFree`. Also grep for every caller that switches on `userTurn`'s return `kind`, because T6 widens that union.

- [ ] **Step 2: Report**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: the suite's current state recorded as the baseline Wave 2 is measured against. If it is already red, say which tests and stop — Wave 2 must not start on a red tree.

Output is six written answers appended to this plan's *Shape Changes* section as an `author` row. No commit of source.

---

## Task 6 — Wave 2

### Task 6: The ladder — rungs that chain backwards, and a stop that runs on every answer [CHANGE SITE]

**Orient:** This is the descent itself: the object that knows which rung it is on, that every question was built from the answer before it, and whether the whole thing is finished — everything else in the slice either feeds it or renders it.
**Flow position:** Steps 2-5 of the descent path (`allowance-set` → **`rung-compose` / `rung-answer` / `add-rung` / `end-check`** → `descent-close` or `gate-render`).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/ladder.ts`
- Create: `src/clerk/sounding-rung.ts` (the `composeRung` half; T12 appends `composeFromCompacted`)
- Modify: `src/elicitor/elicitor.ts` (one new branch in `userTurn`, after the close branches at 284-310 and before the pivot rule at 312)
- Test: `tests/sounding-ladder.test.ts`, `tests/sounding-rung.test.ts`

<contracts>
**Upstream (`allowance-set` → this-node):**
- `enterSounding(o: { session: string; construct: string; licensingAnswer: string; mode: Mode; questionCount: number; at: string }): SoundingState`
- `licensingAnswer` is REQUIRED and is the verbatim text of the user turn that licensed the descent. Rung 0's foothold is checked against it and against nothing else; without it the invariant below cannot be enforced for the first rung.

**Downstream (this-node → `end-check`, `gate-render` and `park`):**
- `addRung(s: SoundingState, question: string, foothold: string, answer: string, at: string): SoundingState`
- `gateStateFor(s: SoundingState): GateReading` — `checkpoint` is `rungs.length === s.checkpointRung`, and nothing else makes it true
- `applyGate(s: SoundingState, choice: GateChoice): { state: SoundingState; end: SoundingEnd | null }`
- **Behavioral invariant — the chain runs backwards.** `addRung` THROWS unless `foothold` is a verbatim substring of the PRECEDING answer: `s.licensingAnswer` when `s.rungs` is empty, `s.rungs.at(-1)!.answer` otherwise. It is NOT checked against the `answer` argument being recorded in the same call. The question was composed *before* this answer existed, so checking it against this answer would demand the person repeat the phrase back and would reject nearly every real rung. Q-12 is enforced at composition time and this is the second gate on the same invariant, so a ladder on disk can never claim a foothold it did not quote.
- Behavioral invariant: `applyGate('continue')` returns `end` from `descentEnd` (T4) and from nothing else. The gate never decides the end; it decides whether to ask.
- Behavioral invariant: `applyGate('park' | 'another-day')` returns that choice as `end`, whatever the counter says.

**Downstream (`composeRung` → the elicitor, T8's accept route, T12's resume):**
- `composeRung(answer: string, complete: Complete, guard: (q: string) => GuardVerdict): Promise<{ text: string; foothold: string } | null>`
- Lives in `src/clerk/sounding-rung.ts`, NOT private to the elicitor, because three callers need it: the elicitor's answer path, T8's accept route (which composes rung 0 from the licensing answer), and T12's resume path.
- It writes no prompt. It calls `redLights(answer, complete)`, then `composeFollowUp(answer, light, complete)` per light, then `guard(question)`, and returns the first survivor with `foothold: light.phrase`. `null` means no light produced a guarded, quoted question.
- Behavioral invariant: the returned `foothold` is always a verbatim substring of the `answer` argument — `redLights` has already checked it (`composed.ts:308-310`). This is what makes `addRung`'s backwards check pass one call later.

**Sideways (`src/elicitor/elicitor.ts`):**
- `userTurn` gains one branch, placed AFTER the close-phase branches (`elicitor.ts:284-310`) and BEFORE the pivot rule (`elicitor.ts:312`). The four existing priorities are untouched and unreachable while a descent is live — a Sounding suspends ordinary selection, which is what CONTEXT's Question Source entry means by "Instrument step … suspends selection while active".
- `userTurn`'s return type widens to `Probe | { kind: 'saturated' } | { kind: 'checkpoint' }`. T5 has already listed every caller that switches on `kind`; the only one should be the turn route, and handling it there is T8's job, not this task's.
- **Hands the finished ladder to the route via `s.finishedSounding` (T1's type).** `closeDescent` clears `s.sounding`, so this field is the only way the ladder survives the call. This task sets it and never clears it; T8 reads it, writes the ladder, and clears it. A T6 that closes a descent without setting it produces a cap-ended descent that leaves nothing on disk — which is precisely the failure the answer-path end check was added to prevent, arriving one layer down.
</contracts>

- [ ] **Step 1: Write the failing test**

The second test is the load-bearing one. It passes only under the backwards-chain semantics and fails under the same-call reading.

```ts
const LICENSING = 'I keep feeling the pull to be seen doing the work';

function entered() {
  return enterSounding({ session: 's', construct: 'the pull', licensingAnswer: LICENSING,
    mode: { minutes: 20, energy: 'high' }, questionCount: 8, at: NOW });
}

test('rung 0 must quote the answer that licensed the descent', () => {
  const s = entered();
  expect(() => addRung(s, 'What is "the shove"?', 'the shove', 'anything at all here', NOW))
    .toThrow(/foothold/);
  expect(() => addRung(s, 'What is "the pull"?', 'the pull', 'anything at all here', NOW))
    .not.toThrow();
});

test('rung N quotes rung N-1s answer, never its own', () => {
  const s = addRung(entered(), 'What is "the pull"?', 'the pull',
    'it started in my fathers shed where nobody came', NOW);

  // The question for rung 1 was composed from rung 0s answer. That is a chain.
  expect(() => addRung(s, 'What happened in "my fathers shed"?', 'my fathers shed',
    'I do not remember much of it', NOW)).not.toThrow();

  // A foothold taken from the answer being recorded is not a chain — the question
  // would have had to quote an answer that did not exist when it was composed.
  expect(() => addRung(s, 'What do you mean by "do not remember"?', 'do not remember',
    'I do not remember much of it', NOW)).toThrow(/foothold/);
});

test('the gate reports the rung and the total on every rung', () => {
  const s = addRung(entered(), 'q1', 'the pull', 'the pull is strong in me', NOW);
  expect(gateStateFor(s)).toEqual({ rung: 1, of: 10, checkpoint: false });
});

test('the checkpoint fires on the halfway rung and on no other', () => {
  let s = entered();   // allowance 10, checkpoint 5
  let prev = LICENSING;
  for (let i = 1; i <= 10; i++) {
    const answer = `the pull again, take ${i}, said at some length`;
    s = addRung(s, `q${i}`, footholdFrom(prev), answer, NOW);
    expect(gateStateFor(s).checkpoint).toBe(i === 5);
    prev = answer;
  }
});

test('continue ends the descent only when the structure says so', () => {
  expect(applyGate(ladderWithRungs(10, 10), 'continue').end).toBe('cap');
  expect(applyGate(ladderWithRungs(2, 10), 'continue').end).toBe(null);
});

test('park and another-day end the descent whatever the counter says', () => {
  const short = ladderWithRungs(2, 10);
  expect(applyGate(short, 'park').end).toBe('park');
  expect(applyGate(short, 'another-day').end).toBe('another-day');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-ladder.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/ladder.js`.

- [ ] **Step 3: Write `ladder.ts`**

Pure functions over `SoundingState`, returning new states. No disk, no `complete`, no clock — `at` is passed in, as `Rung.at`. The backwards check is four lines:

```ts
const precedingAnswer = s.rungs.length === 0 ? s.licensingAnswer : s.rungs.at(-1)!.answer;
if (!precedingAnswer.includes(foothold)) {
  throw new Error(`foothold ${JSON.stringify(foothold)} is not a substring of the preceding answer`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sounding-ladder.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/clerk/sounding-rung.ts`**

`composeRung` only, to the signature in the contracts block. It is the existing priority-2 body (`elicitor.ts:341-357`) lifted into a function, plus the foothold returned alongside the question. Add `tests/sounding-rung.test.ts` with two cases:

```ts
test('the foothold is a substring of the answer it was composed from', async () => {
  const r = await composeRung('it started in my fathers shed', scriptedLightsAndFollowUp(), okGuard);
  expect('it started in my fathers shed').toContain(r.foothold);
});

test('an answer whose every light the guard rejects composes nothing', async () => {
  expect(await composeRung('some answer here', scriptedLightsAndFollowUp(), alwaysNearDuplicate)).toBe(null);
});
```

Run: `npx vitest run tests/sounding-rung.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Wire the descent branch into `userTurn`**

```ts
if (s.sounding) {
  const pending = s.sounding.pendingQuestion!;   // set at enter, and after every rung
  s.sounding = addRung(s.sounding, pending.text, pending.foothold, text, now);

  // The end check runs HERE, on the answer path, before anything is composed.
  // Cap and convergence close the descent whether or not the gate is touched.
  const end = descentEnd(s.sounding);
  if (end) return closeDescent(s, end);

  // The checkpoint blocks: no next question until a gate word arrives.
  if (gateStateFor(s.sounding).checkpoint) return { kind: 'checkpoint' as const };

  const next = await composeRung(text, s.deps.complete, (q) => guardQuestion(s, q));
  if (!next) return closeDescent(s, 'convergence');   // no foothold — the chain cannot continue
  s.sounding.pendingQuestion = next;
  return emitProbe(s, next.text, 'deliberative', 'composed');
}
```

`closeDescent(s, end)` is a private helper in `elicitor.ts`, and **the order of its four steps is the whole point** — it clears `s.sounding`, so anything that does not hand the ladder off first loses it:

```ts
function closeDescent(s: SessionState, endedBy: SoundingEnd): Probe {
  // 1. Stamp the live state into a finished ladder.
  const finished: ParkedLadder = { ...s.sounding!, ended: new Date().toISOString(), endedBy };
  // 2. Hand it to the route BEFORE clearing anything. This is the only carrier.
  s.finishedSounding = finished;
  // 3. The descent is over; the sitting is not.
  delete s.sounding;                    // `delete`, never `= undefined` — exactOptionalPropertyTypes
  // 4. The two close moves survive every ending (Q-20, Q-47).
  return emitClosingDoor(s);
}
```

`s.finishedSounding` is what T8's route reads to write the ladder and to build the response's `descentClosed` and `soundingId` fields; the route clears it once written. This helper writes nothing to disk itself, because `elicitor.ts` has no vault root and `src/sounding/park.ts` is T7's — the elicitor's job is to hand over a complete `ParkedLadder`, and the route's job is to persist it.

Note the budget: rungs go through `emitProbe`, which increments `questionCount` (`elicitor.ts:207`). That is correct and load-bearing — a descent consuming the sitting's budget is exactly what Q-47 describes.

**One deliberate asymmetry, so nobody "fixes" it later.** A composer returning `null` here closes the descent as `'convergence'` (the sketch above), while the same failure in T12's resume route is a 503. Both are correct and they are different situations: mid-descent there are rungs on the ladder and a close is a real, recorded outcome the person can pick back up, so the descent ends cleanly; at resume there is no new rung yet, nothing has happened, and closing would silently consume a parked ladder the person just asked to reopen. A failed call the client can retry is the honest answer there. Do not unify them.

- [ ] **Step 7: Run the elicitor suite**

Run: `npx vitest run tests/elicitor.test.ts tests/sounding-ladder.test.ts tests/sounding-rung.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. Every existing elicitor test passes unchanged, because `s.sounding` is absent in all of them and the branch is skipped. `tsc` may flag the turn route's un-handled `'checkpoint'` variant — that is T8's fix, in this same wave; if it does, land T6 and T8 back to back.

- [ ] **Step 8: Commit**

```bash
git add src/sounding/ladder.ts src/clerk/sounding-rung.ts src/elicitor/elicitor.ts tests/sounding-ladder.test.ts tests/sounding-rung.test.ts
git commit -m "sounding: the ladder — a chain that quotes backwards, and a stop checked on every answer"
```

---

### Task 7: Park — the full ladder to disk, a pointer to the Queue [CHANGE SITE]

**Orient:** Parking has to keep everything, because a descent resumed from a rung number is not a descent resumed at all — this task writes the whole ladder to markdown and puts a pointer, not a question, in the Queue.
**Flow position:** Steps 1-2 of the park path (**`ladder-write` / `queue-pointer`** → `waiting-surface`).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/park.ts`
- Modify: `src/queue/queue.ts` (one new non-relaxable draw filter — see contracts)
- Test: `tests/sounding-park.test.ts`

<contracts>
**Upstream (`apply-gate` and `end-check` → this-node):**
- `SoundingState`, a `SoundingEnd`, and an ISO `ended` time

**Downstream (this-node → `waiting-surface` and `ladder-read`):**
- `writeLadder(root: string, l: ParkedLadder): void` → `{root}/soundings/{id}.md`
- `readLadder(root: string, id: string): ParkedLadder | null`
- `parkPointer(queue: QueueStore, l: ParkedLadder, target?: Target): QueueEntry`
- Behavioral invariant: `readLadder(writeLadder(l))` deep-equals `l`, `licensingAnswer` included. Round-trip, every field, including a rung answer containing a colon, a newline, and a quotation mark.
- Behavioral invariant: `parkPointer` writes `source: 'parked-sounding'`, `horizon: 'session'`, `soundingId`, and a `question` field holding **the last rung's question** — a record of what was on the table, never a composed next question. Q-45 forbids storing the next question; this stores the previous one.
- Behavioral invariant (ruled by Q-64): `endedBy: 'another-day'` writes the full ladder and mints **no** Queue entry. The record survives — Q-45's preservation is untouched — but the thread does not resurface unless the person goes looking. `park, depth kept` is the only word that mints a pointer. Q-64's reason is that three words must have three outcomes: continue descends, park suspends with a thread back, another day closes the door without burning the record. If both of the last two minted pointers they would differ only in horizon, and the gate would be two words wearing three labels.

**Sideways (`src/queue/queue.ts`):**
- `drawFilters` gains one filter, `{ name: 'sounding', relaxable: false, keep: (e) => e.source !== 'parked-sounding' }`, placed immediately after `status`.
- `relaxable: false` is the whole point: a parked ladder is a pointer, and the degradation ladder's rung 2 (Q-55) exists to admit user-declared *questions* past a preference, not to hand the elicitor a pointer as if it were a question.
- `FilterName` gains `'sounding'`. Everything that switches on `FilterName` — the floor log at `queue.ts:386-403` — must still compile.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
test('a parked ladder round-trips through markdown, awkward prose included', () => {
  const l = parkedLadder({
    licensingAnswer: 'I keep feeling "the pull": it is hard to say why',
    rungs: [{ question: 'What did you mean by "the pull"?', foothold: 'the pull',
      answer: 'Two things:\n  first, "being seen"; second — the shed.', at: NOW }],
  });
  writeLadder(root, l);
  expect(readLadder(root, l.id)).toEqual(l);
});

test('parking mints a pointer, not a question', () => {
  const entry = parkPointer(queue, parkedLadder({ endedBy: 'park' }));
  expect(entry.source).toBe('parked-sounding');
  expect(entry.soundingId).toBeTruthy();
  expect(entry.question).toBe(lastRungQuestion);
});

test('another day keeps the record and mints nothing', () => {
  const l = parkedLadder({ endedBy: 'another-day' });
  writeLadder(root, l);
  expect(readLadder(root, l.id)).toEqual(l);
  expect(queue.list({ source: 'parked-sounding' })).toHaveLength(0);
});

test('the ordinary draw never returns a parked sounding', () => {
  parkPointer(queue, parkedLadder({ endedBy: 'park' }));
  expect(queue.draw({ minutes: 20, energy: 'high', target: 'self' }, 'mid')).toBe(null);
});

test('a parked sounding does not shadow a real question', () => {
  parkPointer(queue, parkedLadder({ endedBy: 'park' }));
  queue.add(realQuestionDraft());
  expect(queue.draw({ minutes: 20, energy: 'high', target: 'self' }, 'mid')?.source).toBe('composed');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-park.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/park.js`.

- [ ] **Step 3: Write `park.ts`**

`matter.stringify('', fm)` with an empty body, matching `queue.ts:239`. Every optional field written under a guard, never as a key holding `undefined` — `matter.stringify` throws on that and the whole write is lost (`queue.ts:227-229` records this the hard way).

- [ ] **Step 4: Add the queue filter**

One entry in `drawFilters` and one name in `FilterName`. Change nothing else in that file.

Run: `npx vitest run tests/queue.test.ts tests/queue-source-label.test.ts tests/facet-balance.test.ts`
Expected: PASS — no existing entry has `source: 'parked-sounding'`, so the filter is a no-op on every existing case.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/sounding-park.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sounding/park.ts src/queue/queue.ts tests/sounding-park.test.ts
git commit -m "sounding: park writes the whole ladder and queues a pointer the draw will not serve"
```

---

### Task 8: Server — the offer, the consent, the gate, and the log lines for all of it [CHANGE SITE]

**Orient:** The gate and the offer are decisions the person makes, so they need routes to make them through; this task is what turns four pure modules into something a browser can press, and it renders its own log lines so the tree is never red between two commits.
**Flow position:** Bridges `license-check` → `consent-ask` → `enter`, and `gate-press` → `apply-gate` → `park`.
**Skill:** `tdd`
**Files:**
- Modify: `src/server.ts` (the turn route at 604-667; four new routes after the defer route at 726)
- Modify: `src/log/format.ts` (eight cases — see *Activity Log kinds*)
- Test: `tests/sounding-routes.test.ts`, `tests/log-format.test.ts` (extend)

<contracts>
**Upstream (`web/main.ts` → this-node):**
- `POST /api/session/:id/sounding` `{ accept: boolean }`
- `POST /api/session/:id/sounding/gate` `{ choice: 'continue' | 'park' | 'another-day' }`
- `POST /api/session/:id/sounding/resume` `{ queueEntryId: string }` — **shell only in this task.** It validates the body and returns 501 behind a `TODO(T12)` comment; T12 fills the body once `src/sounding/resume.ts` exists. Landing the shell here keeps all four routes in one reviewable place and gives T12 a one-handler edit in a hot file.

**Downstream (this-node → `web/main.ts`):**
- `POST /api/session/:id/turn` response gains **four** optional fields:
  - `soundingOffer?: { construct: string; allowance: number; sentence: string }` — present at most once per sitting
  - `sounding?: GateReading` — present on every rung of a live descent, which is what makes the gate always-present rather than triggered
  - `descentClosed?: SoundingEnd` — present on the probe that closes a descent
  - `soundingId?: string` — present with `descentClosed`, and always with it. This is the cap-and-convergence path: the descent ends on an answer with no gate press anywhere, so the response is the only thing that can tell the client *which* ladder just closed. Without it, T13's Test A cannot read the ladder it just caused to be written, and neither can the person's client.
- The turn route must handle `userTurn`'s new `{ kind: 'checkpoint' }` variant (T6 widened the union) and return `{ kind: 'checkpoint', sounding }` with no question text.
- `POST …/sounding` → `{ kind: 'probe', text, sounding }` on accept; `{ kind: 'declined' }` on decline
- `POST …/sounding/gate` → `{ kind: 'probe', text, sounding }` on continue; `{ kind: 'descent-closed', endedBy, soundingId }` on park, another-day, cap, or convergence
- Behavioral invariant: the offer is computed by `licenseSounding` and by nothing else, and the response NEVER carries an offer when `state.soundingOffer` is set. One offer per sitting, decline recorded, never re-asked.
- Behavioral invariant: on accept, rung 0's question is composed by `composeRung(licensingAnswer, …)` — the same composer the elicitor uses — and `enterSounding` is given that same `licensingAnswer` string. One source for the licensing text, or rung 0's foothold check compares against the wrong string.
- **Behavioral invariant — the answer-path close, spelled out, because this is where the ladder gets lost.** T6's `closeDescent` clears `state.sounding` and leaves the finished ladder on `state.finishedSounding` (T1's carrier). After every `userTurn` call the route does exactly this, and in this order:

  ```ts
  const finished = state.finishedSounding;
  if (finished) {
    writeLadder(deps.vaultRoot, finished);        // T7 — persist BEFORE responding
    delete state.finishedSounding;                 // consumed; `delete`, never `= undefined`
    serverEmit(deps.vaultRoot, 'elicitor', 'sounding-ended',
      `sounding=${finished.id} rungs=${finished.rungs.length} endedBy=${finished.endedBy}`);
    // Both wire fields come off the one object — no second source for either.
    return c.json({ ...probeFields, descentClosed: finished.endedBy, soundingId: finished.id });
  }
  ```

  Cap and convergence are not special cases for persistence: this block is the same code the gate route's park path runs, and it runs whether or not a gate word was ever pressed.
- Behavioral invariant: a `descent-closed` response leaves the session in `phase: 'closing-door'` with the door question already emitted.
- Behavioral invariant: on the gate route, `continue` at the checkpoint composes the next rung from `state.sounding.rungs.at(-1)!.answer` — the answer to the rung the checkpoint interrupted. Not from the licensing answer, and not from any text on the gate request, which carries only a choice word. The gate is a control, not a turn: no user prose arrives with it, so the foothold must come from the ladder. Getting this wrong makes `addRung`'s backwards check throw on the rung after every checkpoint.
</contracts>

- [ ] **Step 1: Write the failing test**

Follow `tests/e2e.test.ts`'s app-construction pattern with a scripted `Complete`.

```ts
test('the offer appears once and states its length', async () => {
  const res = await turnUntilLicensed(app, session);
  expect(res.soundingOffer.sentence).toContain(String(res.soundingOffer.allowance));
});

test('a decline is recorded and never offered again in the sitting', async () => {
  await post(`/api/session/${id}/sounding`, { accept: false });
  for (let i = 0; i < 4; i++) {
    const res = await post(`/api/session/${id}/turn`, { text: aLicensingAnswer() });
    expect(res.soundingOffer).toBeUndefined();
  }
});

test('rung 0 quotes the answer that licensed the descent', async () => {
  await post(`/api/session/${id}/sounding`, { accept: true });
  const ladder = readLadderForSession(root, id);
  expect(ladder.licensingAnswer).toContain(ladder.pendingQuestionFoothold);
});

test('every ordinary rung carries the gate and the next question together', async () => {
  for (let i = 1; i <= 3; i++) {
    const res = await post(`/api/session/${id}/turn`, { text: aRichAnswer(i) });
    expect(res.kind).toBe('probe');
    expect(res.sounding).toEqual({ rung: i, of: expect.any(Number), checkpoint: false });
  }
});

test('the checkpoint rung returns no question until a gate word arrives', async () => {
  const res = await turnToCheckpoint(app, id);
  expect(res.kind).toBe('checkpoint');
  expect(res.text).toBeUndefined();
  expect((await post(`/api/session/${id}/sounding/gate`, { choice: 'continue' })).kind).toBe('probe');
});

test('a descent that reaches its cap closes without the gate being touched', async () => {
  const res = await answerUntilCap(app, id);   // gate never pressed
  expect(res.descentClosed).toBe('cap');
  expect(readLadder(root, res.soundingId).endedBy).toBe('cap');
});

test('park writes the ladder, queues the pointer, and closes with the door question', async () => {
  const res = await post(`/api/session/${id}/sounding/gate`, { choice: 'park' });
  expect(res.kind).toBe('descent-closed');
  expect(readLadder(root, res.soundingId).rungs.length).toBeGreaterThan(0);
  expect(queue.list({ source: 'parked-sounding' })).toHaveLength(1);
  const next = await post(`/api/session/${id}/turn`, { text: 'nothing else' });
  expect(next.phase).toBe('closing-bookmark');   // the door was already asked
});

test('an unknown gate word is a 400, not a guess', async () => {
  expect((await postRaw(`/api/session/${id}/sounding/gate`, { choice: 'stop' })).status).toBe(400);
});

test('resume is a shell until T12', async () => {
  expect((await postRaw(`/api/session/${id}/sounding/resume`, { queueEntryId: 'x' })).status).toBe(501);
});
```

And in `tests/log-format.test.ts`:

```ts
test('no sounding line names a ULID', () => {
  for (const e of everySoundingEvent()) expect(format(e)).not.toMatch(ULID);
});

test('no sounding line says anything about how it went', () => {
  const forbidden = /hard|difficult|struggl|deep|failed|gave up|only/i;
  for (const e of everySoundingEvent()) expect(format(e)).not.toMatch(forbidden);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-routes.test.ts`
Expected: FAIL — 404 on `/api/session/:id/sounding`.

- [ ] **Step 3: Write the routes AND the eight format cases, together**

Follow the defer route's shape (`src/server.ts:682-726`): look the state up in `sessions`, validate the body against a closed set and 400 on anything else, act, `serverEmit`, respond. Every `serverEmit` this task adds gets its `case` in `src/log/format.ts` **in this same commit** — see the table in *Activity Log kinds*. Splitting them across two commits fails `tests/log-format.test.ts` in whichever order they land.

Write the `state.finishedSounding` block from the contract **once**, as a helper both the turn route and the gate route call. Two copies is how the cap path and the park path drift into writing the ladder differently, and the cap path is the one with no manual step to notice it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sounding-routes.test.ts tests/log-format.test.ts tests/e2e.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, including the emitted-kind sweep `tests/emitted-kinds.ts` derives from source, and no un-handled `'checkpoint'` variant left in the turn route.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/log/format.ts tests/sounding-routes.test.ts tests/log-format.test.ts
git commit -m "sounding: routes for the one offer, the always-present gate, and eight log lines that judge nobody"
```

---

### Task 9: The gate on screen — three words under every rung [CHANGE SITE]

**Orient:** Q-44's gate is a control the person presses, so until it is on the exchange screen the whole slice is inert — this task puts the offer and the three margin words where a hand can reach them.
**Flow position:** The rendering half of `consent-ask`, `gate-render` and `gate-block`; consumes exactly what T8's turn response carries.
**Skill:** `frontend-design`
**Codebooks:** `focus-management-across-boundaries` — the checkpoint takes over the screen mid-exchange and must return focus to the textarea afterwards.
**Files:**
- Modify: `web/main.ts` — `renderExchange` only (was 650-967)
- Modify: `web/style.css` — every sounding class, including the `.parked-*` classes T12 renders against
- Test: manual, via `npm run dev` — plus the shadow walk in T14

<contracts>
**Upstream (`POST /api/session/:id/turn` and the gate route → this-node):**
- `soundingOffer?: { construct: string; allowance: number; sentence: string }`
- `sounding?: GateReading` — `{ rung, of, checkpoint }`
- `{ kind: 'checkpoint', sounding }` — a response with NO question text
- `{ kind: 'descent-closed', endedBy, soundingId }`, and `descentClosed` + `soundingId` riding on an ordinary probe when the descent ends on an answer
- Behavioral invariant: `sounding` present means a descent is live. It is present on EVERY rung. The UI must not cache it, hide it after a while, or show it only on the checkpoint.

**Downstream (this-node → `POST …/sounding` and `POST …/sounding/gate`):**
- `{ accept: boolean }` and `{ choice: GateChoice }`
</contracts>

- [ ] **Step 1: Add the offer control**

Below the question block, in the margin: the sentence from `soundingOffer.sentence`, and two words — one to accept, one to decline. Both are one click. Declining costs one word, which is the whole design (Q-43); it must not open a confirmation, ask why, or dim.

- [ ] **Step 2: Add the gate row**

A `gate-row` appended to `answerArea` alongside `deferRow`, rendered whenever `state.sounding` is set. It carries all three words on every rung. Per the decision in *The gate is a control*: on an ordinary rung (`checkpoint === false`), `continue` renders as the reading `continuing · rung N of M` — text, not a control — while `park, depth kept` and `another day` are live buttons. Quiet weight, matching the existing `.defer-need` words in `style.css`, not buttons that compete with the textarea.

- [ ] **Step 3: Add the checkpoint state**

On `{ kind: 'checkpoint' }`: the gate row moves above the textarea, all three words become controls, and the textarea is disabled until one is pressed — no next question exists yet. One line of plain text offers the same three words. **No new words, no different words**, and nothing that says or implies anything about how the person is doing. It is a counter reaching a number. After `continue` returns a probe, focus goes back to the textarea.

- [ ] **Step 4: Join `setControlsBusy`**

Every gate control disables with the others while a call is in flight (`web/main.ts:798-804`), or a double-press parks a ladder twice.

- [ ] **Step 5: Handle the close, from both directions**

A `{ kind: 'descent-closed' }` response **and** an ordinary probe carrying `descentClosed` both remove the gate row, restore the ordinary controls, and put the door question in the question block. The second path is the one that matters most: `endedBy: 'cap'` and `'convergence'` arrive unprompted on an ordinary answer, with no gate press anywhere, and a UI that only handles the gate-press path leaves a dead gate row on screen for the rest of the sitting. The wording announces the descent closing and never the person stopping (Q-46).

- [ ] **Step 6: Verify by hand**

Run: `npm run dev` then drive a sitting to the offer with `ELICIT_LLM=fake`.
Expected: the offer appears once with a number in it; declining removes it for good; accepting shows the three words under every rung with `park` and `another day` pressable throughout; rung `ceil(allowance/2)` moves them above the textarea and withholds the next question; answering past the cap closes the descent with the door question and no gate press.

- [ ] **Step 7: Commit**

```bash
git add web/main.ts web/style.css
git commit -m "sounding: the offer and the always-present gate on the exchange screen"
```

---

## Task 10 — Wave 3

### Task 10: Compaction — the last two rungs, and one line for the rest [CHANGE SITE]

**Orient:** The local model degrades on long payloads, so resuming a nine-rung descent by handing back nine rungs is how a resume produces a worse question than a cold start — this task builds the short view the resume composes from.
**Flow position:** Step 5 of the park path (`ladder-read` → **`compaction`** → `rung-compose`).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/compaction.ts`
- Test: `tests/sounding-compaction.test.ts`

<contracts>
**Upstream (`readLadder` → this-node):**
- `ParkedLadder`, and an optional summary line for the earlier rungs

**Downstream (this-node → `composeFromCompacted`):**
- `compactLadder(l: ParkedLadder, summary: string | null): CompactedLadder`
- `type CompactedLadder = { verbatim: Rung[]; summarized: { count: number; line: string } | null; unsummarized: number }`
- Behavioral invariant: `verbatim` holds the LAST 1-2 rungs and never more, newest last. `verbatim.at(-1)!.answer` is what the resumed question's foothold must come from, so the order is load-bearing.
- Behavioral invariant: a one-rung ladder yields one verbatim rung and no summary.
- Behavioral invariant: when `summary` is `null` — the Docket has not run yet — the earlier rungs are reported as `unsummarized: N` and are NOT included verbatim. A missing summary must degrade to *less* context, never to more; sending the whole ladder because the summary is missing is precisely the failure Q-45 exists to prevent.

**Why this does not call `cover()`.** Q-45 says to reuse the Cover consolidation *mechanism* (ADR-0002 layer 3), and this module reuses its shape — newest verbatim, older behind one line, summaries stored as Marginalia — and its storage convention (`marginalia/`, model-stamped, one line of prose; see `src/memory/cover.ts:205-227`). It does not call `cover()` itself, for two reasons that are about correctness, not taste. First, `cover()`'s unit is a `SessionRef` with `session`, `started`, `turnCount` and `chars`; a rung is not a session, and passing one as one would be a type lie that the next reader has to unpick. Second, `cover()` tiles against a *binary-bracketed tree* of summaries (`cover.ts:149-201`) because a session history grows without bound; a ladder is at most twelve rungs and wants exactly one summary of its head. The tree would produce a correct answer to a question nobody asked. `compactLadder` is about forty lines and does the one thing.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
test('the last two rungs come back verbatim, newest last', () => {
  const c = compactLadder(ladderOf(7), 'the thread ran from being seen to the shed');
  expect(c.verbatim).toEqual(rungs.slice(-2));
  expect(c.verbatim.at(-1)).toEqual(rungs.at(-1));
  expect(c.summarized).toEqual({ count: 5, line: 'the thread ran from being seen to the shed' });
});

test('a one-rung ladder has nothing to summarize', () => {
  const c = compactLadder(ladderOf(1), null);
  expect(c.verbatim).toHaveLength(1);
  expect(c.summarized).toBe(null);
  expect(c.unsummarized).toBe(0);
});

test('a missing summary drops context — it never falls back to the whole ladder', () => {
  const c = compactLadder(ladderOf(9), null);
  expect(c.verbatim).toHaveLength(2);
  expect(c.summarized).toBe(null);
  expect(c.unsummarized).toBe(7);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-compaction.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/compaction.js`.

- [ ] **Step 3: Write the module. Step 4: Run to verify it passes.**

Run: `npx vitest run tests/sounding-compaction.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sounding/compaction.ts tests/sounding-compaction.test.ts
git commit -m "sounding: compaction — two rungs verbatim, one line for the rest, less on a missing summary"
```

---

### Task 11: The ladder summary — one line, clerk model, Marginalia [CHANGE SITE]

**Orient:** The compacted resume needs one line standing for the rungs it drops, and nobody is waiting for that line, so it is written in the background by the careful model and filed where agent prose is allowed to live.
**Flow position:** The background path (`docket-run` → **`ladder-summary-compose`** → `marginalia-write`).
**Skill:** `tdd`
**Files:**
- Create: `src/clerk/sounding-summary.ts`
- Modify: `src/clerk/docket.ts` (one guarded call, following the Cover consolidation job already there)
- Modify: `src/log/format.ts` (one case: `sounding-summarized`)
- Test: `tests/sounding-summary.test.ts`, `tests/log-format.test.ts` (extend)

<contracts>
**Upstream (`docket-run` → this-node):**
- Every `soundings/*.md` with `ended` set and no `marginalia/sounding-summaries/<id>.md`

**Downstream (this-node → `compaction`):**
- `summarizeLadder(l: ParkedLadder, complete: Complete, model: string): Promise<{ line: string; model: string; at: string } | null>`
- `saveLadderSummary(root, id, s): void` → `{root}/marginalia/sounding-summaries/{id}.md`, frontmatter `model` and `at`, body the line
- `loadLadderSummary(root, id): string | null` — what T12 passes to `compactLadder`
- Behavioral invariant: the summary is **Marginalia-class**. It is never a Snippet, never enters the corpus, never appears in a Piece, and is never shown at close (Q-8, Q-20, Q-45). Nothing in this task calls `vault.saveSnippet`.
- Behavioral invariant: model-stamped at creation (Q-34). The stamp is the CLERK model (Q-48), because this call has nobody waiting on it.
- Behavioral invariant: one summary per ladder. A ladder that already has one is skipped, so a Docket run is idempotent and does not re-summarize the vault every time it wakes.
- Behavioral invariant: a failed or empty completion returns `null` and writes nothing. `compactLadder` already degrades correctly on a missing summary (T10), so the failure mode is less context and never a stale or invented line.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
test('the summary is one line, stamped with the clerk model', async () => {
  const s = await summarizeLadder(ladderOf(9), scripted(['it ran from being seen to a shed nobody entered']), 'qwen3.6:35b');
  expect(s.line).not.toContain('\n');
  expect(s.model).toBe('qwen3.6:35b');
});

test('an empty completion writes nothing', async () => {
  expect(await summarizeLadder(ladderOf(9), scripted(['']), 'qwen3.6:35b')).toBe(null);
});

test('a ladder with a summary is not summarized twice', async () => {
  expect((await runSummaryJob(deps)).summarized).toBe(1);
  expect((await runSummaryJob(deps)).summarized).toBe(0);
});

test('a summary never becomes a snippet', async () => {
  await runSummaryJob({ ...deps, vault: vaultThatThrowsOnSaveSnippet });
  // passes only because saveSnippet is never called
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-summary.test.ts`
Expected: FAIL — cannot resolve `../src/clerk/sounding-summary.js`.

- [ ] **Step 3: Write the module, the Docket call, and the `sounding-summarized` format case**

The prompt asks for one line naming what the descent moved through. It gets the rungs it is summarizing and nothing else. In `src/clerk/docket.ts`, the call is guarded the way the wiki job is (`src/server.ts:328-365` shows the posture): a throw is caught, logged, and does not fail the run. The format case ships in this same commit — see *Activity Log kinds*.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/sounding-summary.test.ts tests/docket.test.ts tests/log-format.test.ts`
Expected: PASS, and every existing docket test unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/clerk/sounding-summary.ts src/clerk/docket.ts src/log/format.ts tests/sounding-summary.test.ts tests/log-format.test.ts
git commit -m "sounding: the ladder's one line — clerk model, marginalia, written once"
```

---

### Task 12: Pick it up — the waiting surface, the resume route, the fresh question [CHANGE SITE]

**Orient:** A parked descent that nobody can find is a file, not a feature — this task shows it on the waiting surface, fills in the resume route T8 left as a shell, and composes a genuinely new question from the compacted view.
**Flow position:** Steps 4-6 of the park path (`waiting-surface` → **`pick-up` / `ladder-read` / `rung-compose`**).
**Skill:** `tdd`
**Files:**
- Create: `src/sounding/resume.ts`
- Modify: `src/clerk/sounding-rung.ts` (append `composeFromCompacted`; T6 created the file with `composeRung`)
- Modify: `src/server.ts` — the `POST /api/session/:id/sounding/resume` handler ONLY, replacing T8's 501 shell and its `TODO(T12)` marker
- Modify: `web/main.ts` — `renderWaiting` only (was 1203-1290)
- Modify: `src/log/format.ts` (one case: `sounding-resumed`)
- Test: `tests/sounding-resume.test.ts`, `tests/sounding-rung.test.ts` (extend), `tests/log-format.test.ts` (extend)

<contracts>
**Upstream (`waiting-surface` → this-node):**
- `POST /api/session/:id/sounding/resume` `{ queueEntryId }`, in a sitting already under way

**Downstream (this-node → `rung-compose`):**
- `resumeSounding(root: string, entry: QueueEntry, mode: Mode, questionCount: number, summary: string | null): { state: SoundingState; compacted: CompactedLadder } | null`
- `composeFromCompacted(c: CompactedLadder, complete: Complete, guard: (q: string) => GuardVerdict): Promise<{ text: string; foothold: string } | null>` — in `src/clerk/sounding-rung.ts`, beside `composeRung`, because they are the same operation with different context. It composes against `c.verbatim.at(-1)!.answer`, so the foothold it returns is a substring of the last kept answer, which is exactly what `addRung` checks against on the next turn. The summary line and any earlier verbatim rung go into the prompt as context only and are never a foothold source.
- Behavioral invariant: the allowance is recomputed from the NEW sitting's remaining budget (T3), not restored from the parked ladder. The person consented to a length in a sitting that has ended; the new sitting's consent ask states the new number.
- Behavioral invariant: the resumed descent's first question is composed **fresh**, at resume time. Nothing pre-composed is ever read off disk. Q-45's reason is that a stored question was authored for a person who no longer exists by the time they come back.
- Behavioral invariant: `state.licensingAnswer` is carried forward unchanged from the parked ladder, so the file keeps saying what originally licensed the descent. Rung 0's check never re-runs on a resume — there are already rungs, so `addRung` compares against `rungs.at(-1)!.answer`.
- Behavioral invariant: resumed rungs are APPENDED to the parked ladder and the same `soundings/<id>.md` is rewritten. One descent, one file, however many sittings it spans.
- Behavioral invariant: the Queue pointer is marked answered when the descent is picked up, so it stops appearing as waiting.

**Sideways (`web/main.ts` `renderWaiting`):**
- A third section between "out in the world" and "open questions", listing entries where `source === 'parked-sounding'`, each showing the last rung's question and how many rungs are kept, with a control to pick it up.
- `GET /api/queue` builds `open` from `horizon === 'days' || horizon === 'session'` (`src/server.ts:815-828`), so parked pointers arrive inside the same array the "open questions" section renders. Filter by `source` on the client and exclude them from the questions list, or they appear twice.
- Rendering rule (Q-24): no age colouring, no "still waiting", no count of how long it has sat. `ageString` already exists in that function and reads neutrally — reuse it. Dormancy is signal, never debt, and a parked descent is the single most tempting thing in this app to render as a reproach.
</contracts>

- [ ] **Step 1: Write the failing test**

```ts
test('resuming composes a question that is not the parked one', async () => {
  const { compacted } = resumeSounding(root, entry, mode, 4, summaryLine);
  const q = await composeFromCompacted(compacted, complete, guard);
  expect(q.text).not.toBe(parkedLadder.rungs.at(-1).question);
});

test('the resumed foothold chains from the last kept answer', async () => {
  const { state, compacted } = resumeSounding(root, entry, mode, 4, summaryLine);
  const q = await composeFromCompacted(compacted, complete, guard);
  expect(compacted.verbatim.at(-1).answer).toContain(q.foothold);
  expect(() => addRung(state, q.text, q.foothold, 'a new answer here', NOW)).not.toThrow();
});

test('the allowance comes from the new sitting, not the old one', () => {
  const { state } = resumeSounding(root, entry, { minutes: 20, energy: 'high' }, 4, null);
  expect(state.allowance).toBe(12);          // the parked ladder had 8
});

test('the licensing answer is carried forward, not rewritten', () => {
  const { state } = resumeSounding(root, entry, mode, 4, null);
  expect(state.licensingAnswer).toBe(parkedLadder.licensingAnswer);
});

test('resumed rungs append to the same file', async () => {
  const { state } = resumeSounding(root, entry, mode, 4, null);
  const grown = addRung(state, 'q', footholdFromLastAnswer, 'answer', NOW);
  writeLadder(root, { ...grown, ended: NOW, endedBy: 'park' });
  expect(readLadder(root, entry.soundingId).rungs).toHaveLength(parkedRungs + 1);
});

test('a pointer to a missing ladder is a dead entry, not a crash', () => {
  expect(resumeSounding(root, pointerToNothing, mode, 4, null)).toBe(null);
});

test('picking it up clears it from the waiting surface', async () => {
  await post(`/api/session/${id}/sounding/resume`, { queueEntryId: entry.id });
  expect(queue.list({ source: 'parked-sounding' })[0].status).toBe('answered');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/sounding-resume.test.ts`
Expected: FAIL — cannot resolve `../src/sounding/resume.js`, and the resume route still returns 501.

- [ ] **Step 3: Write `src/sounding/resume.ts`**

Read the ladder by `entry.soundingId`, load the summary via `loadLadderSummary` (T11), call `compactLadder` (T10), recompute the allowance and checkpoint via `rungAllowance` (T3), carry `licensingAnswer` forward, and return the live state plus the compacted view. Return `null` when the ladder file is missing.

- [ ] **Step 4: Append `composeFromCompacted` to `src/clerk/sounding-rung.ts`**

Same shape as `composeRung`, and it delegates to it: build the context prose from `summarized.line` plus any earlier verbatim rung, then run `redLights` / `composeFollowUp` / `guard` against `c.verbatim.at(-1)!.answer`. Add two cases to `tests/sounding-rung.test.ts`: the foothold is a substring of the last kept answer, and a `null` summary still composes.

Run: `npx vitest run tests/sounding-rung.test.ts`
Expected: PASS, 4 tests (T6's two plus these two).

- [ ] **Step 5: Fill in the resume route**

Replace T8's 501 shell and its `TODO(T12)` marker. On success: call `resumeSounding`, then `composeFromCompacted`, mark the Queue entry answered, set `state.sounding` with the composed `pendingQuestion`, set `state.soundingOffer = 'entered'`, emit `sounding-resumed`, and return `{ kind: 'probe', text, sounding }`. On a `null` from `resumeSounding`: 404. On a `null` from the composer: 503 with a message the client can show, because a resume that cannot compose is a failed call, not a closed descent. Touch no other handler in the file.

- [ ] **Step 6: Add the `sounding-resumed` format case**

Same commit as the emit — see *Activity Log kinds*.

- [ ] **Step 7: Add the waiting-surface section**

Per the sideways contract above, including the client-side `source` filter that keeps parked pointers out of the "open questions" list.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/sounding-resume.test.ts tests/sounding-rung.test.ts tests/log-format.test.ts tests/queue.test.ts`
Expected: PASS.

- [ ] **Step 9: Verify the surface by hand**

Run: `npm run dev`, park a descent, open the waiting surface.
Expected: a "parked" section showing the last rung's question and the rung count, appearing exactly once, with no age emphasis and nothing that reads as owed work.

- [ ] **Step 10: Commit**

```bash
git add src/sounding/resume.ts src/clerk/sounding-rung.ts src/server.ts src/log/format.ts web/main.ts tests/sounding-resume.test.ts tests/sounding-rung.test.ts tests/log-format.test.ts
git commit -m "sounding: pick a parked descent back up — compacted view, fresh question, new allowance"
```

---

### Task 13: End to end — offer, descent, gate, cap, park, resume [CHANGE SITE]

**Orient:** Every piece of this slice has passed its own test; this task is the first time one person's sitting runs through all of them, which is the only place the seams show.
**Flow position:** Spans the whole map, from `user-turn` to `rung-compose` after a pick-up.
**Skill:** `tdd`
**Files:**
- Test: `tests/sounding-e2e.test.ts`

<contracts>
**Upstream:** a real `createApp` over a temp vault, with a scripted `Complete` and a real `createQueueStore` — the `tests/e2e.test.ts` pattern.
**Downstream:** none. This task produces no source.
</contracts>

- [ ] **Step 1: Write the walk**

Two tests, both driving a real sitting, asserted at every seam.

**Test A — the descent that runs itself out.** This one exists because `descentEnd` is otherwise reachable only through the gate, and a mechanism reachable only by a control nobody pressed is the failure this repo keeps shipping.

1. Turn until the license fires; assert the offer arrives with a number in it.
2. Accept; assert rung 0's foothold is a verbatim substring of `licensingAnswer`, read from `soundings/<id>.md`, not from the response.
3. Answer every rung, **never touching the gate**, past the allowance.
4. Assert the descent closed with `endedBy: 'cap'`, that the ladder on disk holds `allowance` rungs, and that **every** rung's `foothold` is a verbatim substring of the preceding rung's `answer` — rung 0 against `licensingAnswer`. Walk the whole array; this is the one place the backwards chain is checked against real composed questions rather than fixtures.
5. Assert the sitting continues to the door question and then the bookmark question.

**Test B — the descent that is parked and picked up.**

1. Enter as above; answer three rungs; assert every response carries `sounding` with `checkpoint: false` and a question alongside it.
2. Answer to the checkpoint rung; assert the response is `kind: 'checkpoint'` and carries no question.
3. Press `continue`; assert a probe comes back.
4. Press `park`; assert the ladder file holds every rung, the Queue holds one pointer, and `queue.draw` returns something that is not it.
5. Run the Docket; assert one summary file exists, model-stamped.
6. Start a second sitting, resume from the pointer; assert the composed question is not the parked one, that its foothold is a substring of the last kept answer, and that the compacted view carried two rungs verbatim.
7. Assert the second sitting still ends with the door question and then the bookmark question.

- [ ] **Step 2: Run the whole suite**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, everything green.

- [ ] **Step 3: Commit**

```bash
git add tests/sounding-e2e.test.ts
git commit -m "sounding: end-to-end — a descent that runs itself out, and one that is parked and picked up"
```

---

## Task 14 — Wave 4

### Task 14: The shadow walk — what the descent feels like from the chair

**Orient:** This slice's whole risk is that a mechanically correct descent reads as an interrogation with buttons, so one task drives it as a person and reports what the wording actually does.
**Flow position:** Post-implementation gate over the whole map.
**Skill:** `shadow-walk`
**Files:**
- Read only, plus a written report

- [ ] **Step 1: Walk five paths against a real model**

Run: `npm run start` with the local elicitor model, and drive a 20-minute sitting five times.

1. **Accept and run to the cap.** Does the close announce the descent ending, or does it read as the person running out?
2. **Decline.** Does declining cost one word? Does anything ask again, hint, or dim?
3. **Park at the checkpoint.** Does the checkpoint read as a counter, or as the system having noticed something about the person? This is the failure Q-44 exists to prevent and the one a test cannot catch.
4. **Watch the ordinary rungs.** With `continue` rendered as a reading rather than a control, does stopping still feel available at every rung — or does it feel like the only way out is to stop answering? The mechanism here is ruled and is not what this step tests (see *The gate is a control* for the deduction from Q-44). What is untested is the **wording and weight** of `park, depth kept` and `another day` in the margin: Q-44 buys availability, and availability the person does not notice is not availability. A finding here changes the two words or their styling, never the blocking behaviour.
5. **Resume next sitting.** Is the fresh question recognisably about the same thread without repeating a rung?

- [ ] **Step 2: Report**

Expected output: five written findings and, for each, the exact wording that produced it. Wording fixes are in scope for a follow-up task; mechanism changes are not — they are Q-level questions and go back to a grill.

- [ ] **Step 3: Record the run**

Append the findings to this plan's *Shape Changes* section as an `author` row.

---

## Execution Waves

| Wave | Tasks | Runs in parallel? | Gate to the next wave |
|---|---|---|---|
| **1 — foundations** | T1 types, T2 license, T3 budget, T4 convergence, T5 spike | T1 first (it writes the contract); T2/T3/T4 in parallel after it; T5 any time | `npx vitest run && npx tsc --noEmit` green, and T5's six answers written down |
| **2 — the descent and its gate** | T6 ladder + rung composer + elicitor wiring, T7 park, T8 routes + log kinds, T9 gate UI | T6 and T7 in parallel; T8 immediately after T6 (T6 widens `userTurn`'s return union and T8 handles it — land them back to back); T9 after T8 | A person can accept an offer, see three words on every rung, park, AND run a descent to its cap without touching the gate — verified by hand, not only by test |
| **3 — park, resume, and the background line** | T10 compaction, T11 summary, T12 pick-up, T13 e2e | T10 and T11 in parallel; T12 after both; T13 last | Full suite green; a parked descent is visible and resumable |
| **4 — the walk** | T14 shadow walk | — | Five findings written |

**Wave 2 is not splittable.** T9 (gate UI) may not slip to Wave 3. Ticket 012 held this slice back for exactly this reason, and a wave that ships T6-T8 without T9 has built the inert gate the ticket warned about.

**No task in this plan adds a log emit without its rendering.** There is no log task to schedule; see *Activity Log kinds*.

---

## Open Questions

### Flow Contracts

- Q: Does `POST /api/session/:id/turn` still return the object shape T8 extends? (assumed `{ kind, text, questionForm, phase, juxtaposition? }` from `src/server.ts:660-666` — T5 verifies)
- Q: Does `renderExchange` still expose `setControlsBusy` for T9's gate controls to join? (assumed yes from `web/main.ts:798-804` — T5 verifies)
- Q: Does anything downstream switch exhaustively on `QueueEntry['source']`? (assumed no — `types.ts:238-245` says nothing switches over it and names the hand-check; T1 re-runs the check)
- Q: Is the turn route the only caller that switches on `userTurn`'s return `kind`? T6 widens that union with `'checkpoint'`, and any other caller stops compiling. (assumed yes — T5 step 1 question 6 greps for it)

### Ruled 2026-08-02 — no longer open

Three of this plan's four blocking questions were put to Micah and ruled. Each became a decision record, and every one confirmed the plan's own reading, so no task changed shape — only its citation and its certainty. They are kept here rather than deleted, because a reader who wonders why the plan does something unusual should find the ruling next to the question that provoked it.

- **T2: does Q-35 govern the entry license? → Q-62. It does not; the license ships LIVE.** Q-62 amends Q-35 a second time and returns the exception count to zero: a mechanism whose only power is to OFFER ships live from day one and logs every evaluation, while a mechanism that ACTS on its own judgment stays shadow-first. The dividing line is the consequence on silence — if ignoring the mechanism means nothing happens, it is an offer. Q-62 also retroactively re-grounds Q-49, so Q-35 no longer carries a named exception, which is Q-56's own prescribed form: amend the principle, never accumulate footnotes. The Soundings entry license is Q-62's first application, on the reasoning that shadowing it would make the slice land as dead code — the inert-mechanism failure this project has now hit six times. **What this changed in the plan:** the escalation framing and the user-initiated-fallback branch are deleted, T2 gained an explicit "no shadow flag, no env gate, no would-have-offered branch" instruction, and the full per-evaluation logging is kept, because that record is still what answers the sub-question below.
  - Sub-Q, still open and deliberately so: is `0.15` mean adjacent Jaccard the right number for "one construct"? No basis yet but the shape of the metric. The `sounding-license` record is what will answer it, which is exactly why Q-62 makes the logging mandatory rather than optional. Exploratory, not blocking.
- **T3: does the allowance floor at 8 when the budget is thinner? → Q-63. Yes, and the sitting grows.** Q-63 takes "a Sounding becomes the rest of the sitting" literally: the close moves stay reserved beyond the allowance and the consent ask states the real expected length, which is what keeps the overrun consented rather than suffered. The rival reading — license requires ≥8 remaining — was declined for making late offers rare in exactly the short Modes where a held thread is most worth descending. **What this changed:** `MIN_RUNGS = 8` is now a ruled constant rather than a proposal, and T3 says not to make it configurable and not to add a compensating guard in the license.
- **T7: what distinguishes "another day" from "park"? → Q-64. No Queue pointer.** "Another day" writes the full ladder and mints nothing; "park, depth kept" is the only pointer-minting word. Q-64's reason is that three words must have three outcomes, or the gate is two words wearing three labels. **What this changed:** T7's invariant is now cited rather than proposed.
- **T6, T9: does the gate block every rung? → No, and it is a deduction from Q-44, not a new decision.** Ordinary rungs do not block: `continue` renders as a reading (`continuing · rung 3 of 10`) while `park` and `another day` stay pressable; the halfway checkpoint blocks. The full argument is in *The gate is a control* — Q-44's "**plus** a mechanical checkpoint" makes the checkpoint an addition that must differ from the margin words, its "**breaks answering-momentum**" needs momentum to exist at ordinary rungs, and its "**always-available** … stopping never requires being noticed" is a claim about availability rather than compulsion. Press-to-advance voids all three and lands the descent in the endurance test Q-47's rationale names. **What this changed:** the design is unchanged — it was already the plan's — but it is now recorded as ruled rather than as taste, so a later task cannot trade it away for a simpler UI. **No `Q-N` was minted:** applying Q-44 is not making a new decision. T14 step 4 keeps its evidence gathering, re-aimed at the wording rather than at the mechanism.

### Blocking — answer before execution

**None remain.** All four of this plan's blocking questions were answered on 2026-08-02: three as new decision records (Q-62, Q-63, Q-64) and the fourth as a deduction from Q-44. Nothing in the *Exploratory* list below should stop a wave; each is answerable while the task that raises it is being built.

### Exploratory — answerable during implementation

- **T4: convergence**
  - Q: Does `resonate` return hits at all over four-to-ten short rung answers? `tests/resonance-paraphrase.test.ts` records 0/8 recall on *paraphrase*; the echo case is closer to repetition, which is what the trigram index is good at. If it returns nothing on the test fixture, the echo check is inert and the measurement belongs in the test name, the way the three-token floor already does.
- **T6: no foothold in an answer**
  - Q: When `composeRung` returns `null` for a rung answer, the plan closes the descent as `'convergence'`. Is closing right, or should it fall through to the ordinary probe and stay in the descent? Closing is the conservative choice (the chain is what a descent is; without a foothold there is no rung), but it may end descents early on terse-but-real answers. Measure in T14.
- **T11: summary timing**
  - Q: The summary is written by the Docket after the park, so a person who parks and immediately resumes in the same session gets `summary: null` and a shorter view. T10 makes that degrade correctly, but is a shorter view the right outcome, or should resume compose the summary inline? (Inline would put a clerk-model call on a response path, which Q-22's posture argues against.)
- **T12: the waiting surface**
  - Q: The plan filters parked pointers out of "open questions" on the client. Would a third array on `GET /api/queue` be cleaner? (Client-side filter assumed — one fewer route change in a hot file.)

### Assumptions about existing behaviour — the tree was moving

Stated plainly, because they were true at read time on 2026-08-02 and build agents were editing the tree the same day:

1. `userTurn` runs the close branches, then `isContentFree`, then juxtaposition → red-light → generic probe (`src/elicitor/elicitor.ts:284-396`), and the close triggers at `questionCount >= budget - 2` (`elicitor.ts:308`).
2. `redLights` drops any light whose phrase is not a verbatim substring of the turn (`src/clerk/composed.ts:308-310`), and `composeFollowUp` returns `null` rather than ship an unquoted question (`composed.ts:331-376`). The whole backwards-chaining foothold mechanism rests on this.
3. `extractContentWords` takes `Token[]` and `tokenize` is private (`src/index/lexical.ts:32, 56`), so T2 adds a wrapper rather than exporting a function that takes a string. `resonate` returns `[]` for queries under three tokens (`lexical.ts:222`).
4. `sessions` is an in-memory `Map` in `createApp` (`src/server.ts:440`), so `soundingOffer` survives exactly as long as the session does — a server restart drops the sitting entirely, which is why "never re-asked in the same sitting" needs no disk.
5. `matter.stringify` throws on a present key holding `undefined` (`src/queue/queue.ts:227-229`), so every optional field is written under a guard.
6. `tests/log-format.test.ts` and `src/log/format.ts` were both modified in the working tree at plan time. T5 re-reads both, and every emitting task re-reads before editing.

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `src/types.ts` | patch | `export type GateChoice` |
| `src/sounding/license.ts` | create | `export function licenseSounding` |
| `src/sounding/budget.ts` | create | `export function rungAllowance` |
| `src/sounding/convergence.ts` | create | `export function descentEnd` |
| `src/sounding/ladder.ts` | create | `export function applyGate` |
| `src/sounding/park.ts` | create | `export function parkPointer` |
| `src/sounding/compaction.ts` | create | `export function compactLadder` |
| `src/sounding/resume.ts` | create | `export function resumeSounding` |
| `src/clerk/sounding-rung.ts` | create | `export async function composeFromCompacted` |
| `src/clerk/sounding-summary.ts` | create | `export function summarizeLadder` |
| `src/index/lexical.ts` | patch | `export function contentWordsOf` |
| `src/queue/queue.ts` | patch | `name: 'sounding'` |
| `src/elicitor/elicitor.ts` | patch | `if (s.sounding)` |
| `src/server.ts` | patch | `/api/session/:id/sounding/gate` |
| `src/log/format.ts` | patch | `case 'sounding-gate'` |
| `src/clerk/docket.ts` | patch | `summarizeLadder` |
| `web/main.ts` | patch | `park, depth kept` |
| `web/style.css` | patch | `.gate-row` |
| `tests/sounding-types.test.ts` | create | `a ladder keeps the answer that licensed it` |
| `tests/sounding-license.test.ts` | create | `a decline is never re-licensed in the same sitting` |
| `tests/sounding-budget.test.ts` | create | `a short remaining budget floors at eight rungs` |
| `tests/sounding-convergence.test.ts` | create | `resonate floors at 3` |
| `tests/sounding-ladder.test.ts` | create | `never its own` |
| `tests/sounding-rung.test.ts` | create | `the foothold is a substring of the answer it was composed from` |
| `tests/sounding-park.test.ts` | create | `the ordinary draw never returns a parked sounding` |
| `tests/sounding-routes.test.ts` | create | `closes without the gate being touched` |
| `tests/sounding-compaction.test.ts` | create | `a missing summary drops context` |
| `tests/sounding-summary.test.ts` | create | `a summary never becomes a snippet` |
| `tests/sounding-resume.test.ts` | create | `the resumed foothold chains from the last kept answer` |
| `tests/sounding-e2e.test.ts` | create | `a descent that runs itself out` |
| `tests/log-format.test.ts` | patch | `no sounding line says anything about how it went` |
<!-- PLAN_MANIFEST_END -->

**Not built by this plan, deliberately:** `src/protocols/defs/` gains no file, and no module named for the five-slot episode probe or the triadic rep-grid exists in the manifest. See *The instruments question*.

---

## Q-Reference Summary

| Decision ID | Title (short) | Applied in |
|-------------|---------------|------------|
| Q-43 | A Sounding is agent-proposed and user-consented; the proposal is licensed by late-in-sitting, energy, and 3+ turns on one construct; a decline costs one word, is recorded, and is never re-offered in the same sitting | T2 (Wave 1), T8, T9 (Wave 2) |
| Q-44 | The mid-descent gate is ALWAYS PRESENT, never triggered — three margin words on every rung plus a mechanical halfway checkpoint; discomfort is never model-inferred; recorded signal is behavioural only | T6, T8, T9 (Wave 2), T14 (Wave 4). Its "plus a mechanical checkpoint", "breaks answering-momentum" and "always-available" phrasings are also the warrant for the ruling that ordinary rungs do not block — a deduction, so no separate `Q-N` |
| Q-45 | A parked Sounding preserves the whole ladder; resuming is compacted (last 1-2 rungs verbatim plus a Cover-style one-line summary); no pre-composed next question; ladder summaries are Marginalia-class | T7 (Wave 2), T10, T11, T12 (Wave 3) |
| Q-46 | A Sounding ends structurally — rung cap, or convergence detected in code via the lexical echo machinery or the pivot heuristic — never by model self-report; ending announces the descent closing, never the user failing | T4 (Wave 1), T6, T8, T9 (Wave 2), T13 (Wave 3), Exploratory Open Question 1 |
| Q-47 | Entering converts the remaining budget into the rung allowance, capped 8-12, with the two close moves reserved beyond it; the consent ask states the expected length | T3 (Wave 1), T8, T9 (Wave 2), T12 (Wave 3) — and see Q-63, which rules its late-entry case |
| Q-3 | Markdown files are the source of truth; any index is derived and rebuildable | T7 (Wave 2) — the full ladder on disk, the compaction only a prompt-time view |
| Q-8 | Transcripts are append-only; agent summaries of them are Marginalia-class and barred from Pieces | T11 (Wave 3) — the ladder summary's class |
| Q-12 | A composed question must contain the user's quoted fragment as an exact substring | T6 (Wave 2) — the rung's foothold, enforced twice: at composition by `composeRung`, and backwards in `addRung` against the preceding answer |
| Q-16 | Session budget is 10-20 questions | T3 (Wave 1) — the budget formula the allowance is carved from |
| Q-20 | Sittings close with two moves inside the budget: the open door, then the bookmark | T3 (Wave 1), T6, T8 (Wave 2), T13 (Wave 3) — reserved beyond the allowance, and asserted after every ending |
| Q-22 | Zero outbound contact; background work waits visibly on the interface | T11 (Wave 3) — the summary runs on the Docket, off every response path; Exploratory Open Question 3 |
| Q-23 | Every act is logged to an append-only Activity Log rendered on the interface | T8, T11, T12 — ten kinds, each rendered in the commit that emits it |
| Q-24 | Advice and surfaces are guilt-free by construction; dormancy is signal, never debt | T12 (Wave 3) — the parked section carries no age emphasis and nothing that reads as owed work |
| Q-34 | Every agent-authored artifact carries a model stamp at creation | T11 (Wave 3) — the ladder summary is stamped |
| Q-35 | Shadow-first graduation, per mechanism — as twice amended, and now carrying no named exception | T2 (Wave 1), via Q-56 and Q-62, which are what narrow it |
| Q-48 | Two models by role: the elicitor is the fast model, the clerk the careful one | T6 (Wave 2) — rung composition is live; T11 (Wave 3) — the summary is background |
| Q-55 | The degradation ladder is two rungs and a composing floor; rung 2 admits user-declared entries past relaxable filters | T7 (Wave 2) — the parked-sounding filter is non-relaxable, so rung 2 cannot admit a pointer as a question |
| Q-56 | Q-35's first amendment: bounds ship live from day one and owe a clip record instead; changes are stated as amendments to Q-35, never as per-mechanism exceptions | T2 (Wave 1) — the form Q-62 then followed |
| Q-62 | Q-35's second amendment: an OFFER-shaped mechanism (one proposal, declined in a word, nothing done on decline) ships LIVE and logs every evaluation; an ACTING mechanism stays shadow-first. The dividing line is what silence costs. Q-49 retroactively re-grounded, so Q-35 carries no named exception | T2 (Wave 1) — the license ships live, with `sounding-license` emitted on every evaluation; T8 (Wave 2) — the emit itself |
| Q-63 | Q-47's late-entry case: with fewer than 8 questions remaining the allowance FLOORS at 8 and the sitting grows past its declared minutes; the close moves stay reserved and the consent ask states the real length | T3 (Wave 1) — `MIN_RUNGS = 8` as a ruled constant; T2 (Wave 1) — no compensating guard in the license |
| Q-64 | "Another day" writes the full ladder and mints NO Queue pointer; "park, depth kept" is the only pointer-minting word — three words, three outcomes | T7 (Wave 2) — the park invariant; T8 (Wave 2) — the gate route's two ending branches |

---

## Shape Changes

| Date | Role | Finding | Summary |
|---|---|---|---|
| 2026-08-02 | author | — | Plan written from ticket 012 (scope locked by the 011 grill, Q-43..Q-47). Ticket 012's `NOT DISPATCHED` note cleared: T19 landed in commit `8ef5e24`, so `web/main.ts` exists and the gate has a surface. Stateful instruments recorded as a named non-goal with the reasoning. |
| 2026-08-02 | author | Review round 1, seven issues | (1) Foothold semantics unified on the backwards chain — `foothold` ⊂ preceding answer — with T6's tests rewritten to encode it, a new *chain runs backwards* constraint section, and the wiring sketch corrected. (2) `descentEnd` now runs on the answer path after `addRung`; a new *Ending is checked on the answer path* section, and the flow map, T6 wiring, T8 routes, T9 close handling and T13 Test A all agree, so cap is reachable with the gate untouched. (3) The separate log task is gone; every emitting task ships its own `format.ts` cases in the same commit, under a new *Activity Log kinds* section. Task count 15 → 14, waves renumbered. (4) `composeRung` / `composeFromCompacted` defined once in `src/clerk/sounding-rung.ts` with signatures, owners, tests and manifest rows; T12's steps expanded from three to ten. (5) Ownership table corrected — `elicitor.ts` to T6, `server.ts` split T8-shell / T12-body with a `TODO(T12)` marker, `style.css` to T9 alone. (6) T2's lexical contract rewritten around `contentWordsOf`, the wrapper over the private `tokenize` + `extractContentWords` pair. (7) `licensingAnswer` added to `SoundingState`, `enterSounding` and the storage layout, making rung 0's invariant enforceable. Advisories applied: Q-56 cited and made the spine of Blocking Open Question 1, `resume.ts` added to the File Structure table, the `resonate` three-token floor recorded in a T4 test name. New Blocking Open Question 4 records the gate-blocking decision as a Q-level choice. |
| 2026-08-02 | author | Q-62, Q-63, Q-64 ruled | Micah ruled three of the four blocking questions, all three confirming the plan's reading, so no task changed shape — only its citation and its certainty. **Q-62** (Q-35's second amendment: offer-shaped mechanisms ship live and log every evaluation; acting mechanisms stay shadow-first; Q-49 retroactively re-grounded so Q-35 carries no named exception): the escalation framing and the user-initiated-fallback branch are deleted from the plan, T2 gained an explicit "no shadow flag, no env gate, no would-have-offered branch" instruction, and the per-evaluation `sounding-license` emit is kept and made mandatory rather than advisory — it is what will re-tune `0.15`. The *Activity Log kinds* note now cites Q-62 instead of Q-56. **Q-63** (allowance floors at 8; the sitting grows past declared minutes): `MIN_RUNGS = 8` is baked in as a ruled constant, with T3 instructed not to make it configurable and not to add a compensating ≥8-remaining guard in the license. **Q-64** ("another day" mints no pointer; "park, depth kept" is the only pointer-minting word): T7's invariant is now cited rather than proposed, with the three-words-three-outcomes reasoning inline. The Open Questions section gained a *Ruled* subsection recording all three beside the questions that provoked them; the Blocking subsection now holds exactly one question — whether the gate blocks every rung — and says so. Q-Reference rows added for Q-62, Q-63, Q-64; Q-35, Q-43, Q-44, Q-47 and Q-56 rows updated to match. |
| 2026-08-02 | author | Blocking Question 4 resolved by deduction | The gate-blocking question is ruled and the plan's design stands: ordinary rungs do not block, `continue` renders as a reading, the halfway checkpoint blocks. Recorded as a **deduction from Q-44** rather than as a preference, with the argument written out in *The gate is a control* — Q-44's "**plus** a mechanical checkpoint" makes the checkpoint an addition that must differ from the margin words; its "**breaks answering-momentum**" requires momentum to exist at ordinary rungs; its "**always-available** … stopping never requires being noticed" is a claim about availability, not compulsion. Press-to-advance voids all three and produces the endurance test Q-47's rationale names. **No `Q-N` minted** — applying Q-44 is not making a new decision. One correction to the reasoning as it was handed to me: the phrase "stops being three quiet words in the margin and becomes the thing on the screen" is this plan's own gloss, not Q-44's text, so the written deduction rests only on Q-44's actual wording; a plan quoted back at itself is not a warrant. Blocking Open Questions now reads "None remain"; T14 step 4 is re-aimed from deciding the mechanism to testing the margin words' wording and weight. |
| 2026-08-02 | author | Review round 2, two issues | (1) `soundingId?: string` added to the turn response's declared fields — it is the cap-and-convergence path, where no gate is pressed and the response is the only thing that can say which ladder closed; T13's Test A could not otherwise read what it caused to be written. (2) The finished ladder now has a named carrier: **`SessionState.finishedSounding?: ParkedLadder`**, chosen over "closeDescent returns the ladder beside the probe" because `elicitor.ts` already uses exactly this handoff shape for `openQueueEntryId` (set by the elicitor, consumed downstream, `delete`d — `elicitor.ts:276-279`), and because a whole `ParkedLadder` on `Probe` would fatten a lean type. T1 declares it, T6's `closeDescent` is now written out in full with its four steps ordered so the handoff happens *before* `s.sounding` is cleared, and T8 reads, persists, emits, and clears it in one shared helper both the turn route and the gate route call. **Deliberate deviation:** taking that option made `Probe.descentClosed` redundant — the route reads `endedBy` off the ladder it already holds — so it is dropped, T1 no longer touches `elicitor.ts`, and T6 is that file's sole owner. The client-facing `descentClosed` field is unchanged and is built by the route. Advisories: the stale `Probe` line reference is gone with the edit that needed it; T8's gate contract now says the checkpoint-continue probe composes from `state.sounding.rungs.at(-1)!.answer` (the gate carries a choice word, never prose, so the foothold must come off the ladder); and T6 now marks the T12-503-vs-T6-convergence difference as deliberate, with the reason each is right where it is. |
