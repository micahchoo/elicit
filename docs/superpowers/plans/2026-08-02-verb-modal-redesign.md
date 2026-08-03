# The verb-modal redesign

## 1. Goal

Apply the verb-grammar rule (the last section of
`docs/interface-references.md`) across the interface: each surface renders
its dominant verb's grammar; secondary verbs enter as explicit mode shifts.
Three waves. **Implement only the wave named in your dispatch message.**

## 2. Architecture context

- `web/main.ts` — every screen, vanilla TS, no framework. `el()` builds DOM;
  `navTo(screen)` switches screens; `api(path, body?)` fetches (GET for
  paths in `GET_PREFIXES` / exact-matched reads, POST otherwise).
- `web/style.css` — tokens in `:root`, including `--warn: #9a4b38`.
- `src/server.ts` — all routes, Hono app. `src/wiki/` — claim store and
  contract. `src/queue/` — question queue. `tests/` — vitest suites.
- The verb-grammar rule and the document rule both live in
  `docs/interface-references.md`; read both before starting.

## 3. Hard constraints

- **The sounding no-touch zone.** Everything matching `sounding`, `offer`,
  `gate`, `ladder`, or `descent` in `web/main.ts` (the offer row in the
  exchange header, the gate handling, related state fields) belongs to
  another workstream. Never modify, move, or reflow those regions. New
  exchange elements go in `answerArea`, after existing children.
- **Match file style**: `web/main.ts` uses 1-space indent, single quotes,
  comments as prose sentences stating constraints. Server and tests follow
  the style of their neighbors.
- **No status words in the wiki DOM** (Q-15): `unconfirmed`, `evidenced`,
  `user-attested`, `contested` must never render or appear as attribute
  values. This constrains Wave 3's confirmation lines.
- **The agent may ask, never decide** (project README): a challenge enqueues
  a question; it must not change claim status or content.
- **Do not commit.** Leave all changes in the working tree.
- Controls are quiet words (`nav-link` class family), not new chrome.

---

## Wave 1 — IA + the reading/writing surfaces (client only)

Files: `web/main.ts`, `web/style.css` (minor).

### Task 1.1 — content-named hub labels

In `renderMode` (anchor: `const waitingLink = el('button', { class:
'nav-link' }, 'waiting surface')`):

- `'waiting surface'` → `'open questions'`
- `'what the clerk has written'` → `'the wiki'`
- Add a new nav word `'your words'` between the wiki link and the import
  link: `navTo('material')`.
- `'just write'` and `'import'` stay.

### Task 1.2 — material is a hub destination now

- In `renderMaterial`, the back button currently does `navTo('waiting')`;
  change to `navTo('mode')`.
- In `renderWaiting`, remove the `pieceWord` nav word (anchor: `const
  pieceWord = el('button', { class: 'nav-link' }, 'piece')`) and its
  append; the back row keeps only `← back`.

### Task 1.3 — the waiting surface answers "what wants me"

In `renderWaiting`, after the cadence line is appended, fetch
`/api/harvest-queue` (same call `renderMode` makes) and when
`pending.length > 0` insert a sentence-with-a-control in the idiom of
`.mode-aside` (see the shuffle row in `renderMode`): the text
`N harvests wait for your review — ` followed by a `nav-link` button
`read them` that does `navTo('reviews')`, then `.`. Class the paragraph
`waiting-reviews-line`; style it like `.cadence-line` (copy that rule's
look in `style.css`). A failed fetch shows nothing.

### Task 1.4 — the exchange's quiet hint and true exit

In `renderExchange`, both inside `answerArea`, appended after `deferRow`:

1. A dimmed line, class `answer-hint`, text `Enter sends · Shift+Enter for
   a new line`. Style: `var(--font-ui)`, 0.7rem, `var(--dim)`. It is
   plain text, always present; the writing grammar allows one hint line.
2. A `nav-link` button `leave — your words keep`, class also
   `exchange-leave`, that does `navTo('mode')` directly. It must NOT call
   `/api/session/:id/end` — leaving is not harvesting; the transcript
   already lives server-side. Add a comment saying exactly that.

Do not touch the header, the offer row, or any sounding/gate code.

### Task 1.5 — reviews auto-open the only item

In `renderReviews`, in the async block after `data` arrives: when
`data.pending.length === 1` AND `pending === null` (no launched harvest
being polled), load that single entry directly — run the same body as the
row click handler (fetch the record, set `state.sessionId`,
`state.proposals`, clear `state.pendingReviewSession`, `renderHarvest()`)
instead of painting a one-row list. Extract the click-handler body into a
local `openEntry(sessionId: string)` used by both paths. On fetch failure
fall back to painting the list as now.

### Wave 1 verification

1. `npx tsc --noEmit` → exit 0
2. `npm test` → green
3. `npm run build` → ok
4. `grep -c "waiting surface" web/main.ts` → 0
5. `grep -n "session/\${state.sessionId}/end" web/main.ts` → hits only in
   the harvest button and saturated-turn paths, not in the leave handler.

---

## Wave 2 — the reviewing and composing grammars (client only)

Files: `web/main.ts`, `web/style.css`.

### Task 2.1 — harvest: finish later, decisions kept

- Module-level `const harvestDrafts = new Map<string, HarvestDecision[]>();`
  near the other module state, with a comment: the queue grammar promises
  leaving costs nothing; this map is that promise, per session, for this
  page load.
- In `renderHarvest` (non-empty branch): seed `state.decisions` from
  `harvestDrafts.get(state.sessionId!) ?? []`, and re-apply the visual
  selected-state for any seeded decision (factor the button-opacity logic
  in `renderProposal.setDecision` so a seeded decision renders the same as
  a clicked one — simplest: after building each proposal block, if a
  seeded decision exists for that index, call the same styling path).
- Add a back row (idiom: `renderReviews`'s back row) with a `nav-link`
  `← finish later` that stores `harvestDrafts.set(state.sessionId!,
  state.decisions)` and `navTo('reviews')`.
- On successful save (`renderDone` transition), `harvestDrafts.delete`.
- In `setDecision`, also write through to the map.

### Task 2.2 — piece gaps: the live seam and the inert markers

In `renderPiece.paint()`:

- Minted gap entries (the `entry.kind === 'gap'` branch): the rule
  currently renders `ask me?` and takes clicks that do nothing. Instead:
  class the wrapper `piece-gap piece-gap-inert`; the rule shows the gap's
  own question when present (`entry.question`, dimmed — class
  `piece-gap-question`), else the words `waiting for its question`. No
  pointer cursor, no hover accent on inert gaps.
- The trailing seam keeps `ask me?`, the pointer, and the hover accent —
  scope the existing `.piece-gap-rule { cursor: pointer }` and
  `.piece-gap-rule:hover .piece-gap-ask` rules in `style.css` so they
  apply only outside `.piece-gap-inert` (e.g. qualify with
  `:not(.piece-gap-inert .piece-gap-rule)` or restructure the classes —
  your call, but an inert gap must show `cursor: default` and no hover
  color).
- Drag-and-drop behavior on gaps is unchanged: inert gaps stay drop
  targets.

### Task 2.3 — piece: the candidate state is said, not implied

In `renderPiece.paint()`, when the viewed arrangement is not
`piece.current`, append (before the entries) a dimmed line, class
`piece-candidate-line`: `viewing a candidate order — "keep this order"
makes it the one that stands`. Nothing renders when viewing the current
arrangement. Style like `.cadence-line`.

### Task 2.4 — material: the touch invites before it is made

- `style.css`: on `.material-snippet:hover` (only when not `.lit`), raise
  `.material-prose` from `var(--dim)` toward `var(--fg)` — use color
  `var(--accent)` as the between-ink. (Check: material prose's resting
  color; if it is already `--fg`, instead dim non-selected snippets
  slightly at rest so hover and `.lit` read as two steps of the same
  scale. Read the existing `.material-snippet` rules first and keep the
  scale one-directional.)
- In `paintMaterial`, the `compose` word's label becomes `compose N`
  (count of selected), updated wherever `compose.hidden` is toggled.

### Wave 2 verification

1. `npx tsc --noEmit`, 2. `npm test`, 3. `npm run build` — all green.
4. Manual grep: `grep -n "piece-gap-inert" web/main.ts web/style.css` —
   present in both.

---

## Wave 3 — the wiki's correcting mode (server + client + tests)

Files: `src/wiki/store.ts`, `src/server.ts`, `src/types.ts`,
`src/queue/source-label.ts`, `tests/claim-verbs.test.ts` (new),
`web/main.ts`, `web/style.css`.

Read first: `src/wiki/contract.ts` (the `Claim` shape and its Q-33
comment on `attested`), `src/wiki/store.ts` (the `ClaimStore` surface and
its persistence idiom), `src/queue/queue.ts` (`createQueueStore` and the
enqueue path), `src/types.ts` `QueueEntry` (the closed `source` union),
`tests/annotate-routes.test.ts` (the route-test idiom to copy).

### Task 3.1 — the attest verb, server side

- `src/wiki/store.ts`: add an `attest(id: string)` method to the claim
  store, following the store's existing read-modify-persist idiom: load
  the claim, set `attested: true` and `updated` to now, persist, return
  the claim. Unknown id → the same not-found behavior the store's other
  by-id reads use. Do NOT touch `status` — it is recomputed mechanically
  (Q-29); the recompute maps the flag on its next pass.
- `src/server.ts`: `POST /api/wiki/claim/:id/attest` → 404 `{ error:
  'unknown claim' }` when absent, else 200 `{ ok: true }`. Place it beside
  `POST /api/wiki/claim/:id/read` and follow that route's shape.

### Task 3.2 — the challenge verb: a question, never a verdict

- `src/types.ts`: add `'claim-challenged'` to the `QueueEntry['source']`
  union (anchor: the union under the comment explaining that
  `source-label.ts` keys a Record by it).
- `src/queue/source-label.ts`: the Record gains `'claim-challenged': 'you
  pushed back on the wiki'`. The compiler enforces this; let it guide you.
- `src/server.ts`: `POST /api/wiki/claim/:id/challenge` → 404 on unknown
  claim; else enqueue via the queue store a pending entry, horizon
  `'session'`, source `'claim-challenged'`, question composed mechanically
  (no model call): `You read "<claim body>" and it did not sit right —
  what would you say instead?`. Follow `createQueueStore`'s existing
  enqueue signature exactly (read it; do not guess fields). Returns
  `{ ok: true }`. The claim itself is not modified in any way.

### Task 3.3 — tests

New `tests/claim-verbs.test.ts`, idiom copied from
`tests/annotate-routes.test.ts` (app construction, temp vault, request
helpers). Cover at minimum:

1. attest on an existing claim → 200; the stored claim has
   `attested: true`; a reload of the store still sees it.
2. attest on an unknown id → 404.
3. challenge on an existing claim → 200; the queue now holds a pending
   entry with source `'claim-challenged'` whose question contains the
   claim body; the claim's `status`, `body`, and `cites` are byte-for-byte
   unchanged.
4. challenge on an unknown id → 404, queue unchanged.

### Task 3.4 — the client mode shift

In `web/main.ts`, wiki surface:

- Clicking a `.wiki-claim` block enters correcting mode for that claim:
  the page dims around it (add class `correcting` to the wiki page
  element; CSS dims `.wiki-claim:not(.focused)` and `.wiki-facet >
  h2` to 0.3 opacity, the way `body.answering .turn` dims), the block
  gains `.focused`, and a margin row (class `claim-verbs`) appears inside
  it with two `nav-link` words:
  - `that's me exactly` → POST `/api/wiki/claim/:id/attest`; on success
    replace the verbs row with a dimmed line `noted — your ink joins this
    sentence when the Clerk next reads`. (No status word.)
  - `not quite — ask me` → POST `.../challenge`; on success the dimmed
    line reads `a question is on its way to your queue`.
- Clicking the focused claim again, clicking another claim, or pressing
  `Escape` leaves the mode (class removed, verbs row removed). One claim
  focused at a time.
- The dwell read-log (`watchReads`) must keep working unchanged.
- Update the three-rules comment above `WIKI_OPENING`: rule 2 ("no verbs,
  no buttons on a claim") becomes: verbs exist, but only in correcting
  mode — reading's page carries none at rest; cite the verb-grammar rule
  section of `docs/interface-references.md`.
- CSS: `.claim-verbs` is a row of margin words (ui font, 0.75rem);
  `.wiki-page.correcting` handles the dimming; transitions ≤150ms.

### Wave 3 verification

1. `npx tsc --noEmit` → 0.
2. `npm test` → green including the new file; state the new test count.
3. `npm run build` → ok.
4. `grep -n "user-attested\|contested" web/main.ts` → hits only inside
   `claimInk`'s switch (the one sanctioned read), never in rendered
   strings.

---

## Out of scope, all waves

Side-by-side arrangement comparison, an inbox screen, URL routing,
import-wizard changes, anything in the sounding no-touch zone. Do not
start them.
