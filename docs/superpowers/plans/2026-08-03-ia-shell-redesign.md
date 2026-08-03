# The IA shell redesign

## 1. Goal

Rebuild the interface's visible information architecture to match the agreed
wireframes (tldraw board `elicit-redesign`): a persistent top navigation on
every screen, a Home dashboard, an Inbox, a Library, real toolbars — with
each surface's CONTENT still rendered in its verb's display grammar (the
verb-grammar rule at the end of `docs/interface-references.md`). The prior
merge already landed the behaviors (validation, drafts, correcting mode,
attest/challenge); this plan builds the shell around them.

## 2. Architecture context

- `web/main.ts` — all screens, vanilla TS. `navTo(screen)` state machine,
  `Screen` union, `el()` DOM helper, `api()` fetch wrapper.
- `web/style.css` — tokens in `:root` (`--warn` exists). Serif document
  aesthetic; the shell may add chrome, but content columns keep it.
- Landed behaviors to preserve (do not regress): trim live validation,
  `harvestDrafts` finish-later, inert minted gaps, `add paragraph` composer,
  wiki correcting mode (claim focus → `that's me exactly` / `not quite —
  ask me`), reviews auto-open of a single item, exchange `leave` word.

## 3. Hard constraints

- **Canon overrides wireframes, wiki page only**: no status words and no
  numbers ANYWHERE inside the wiki's claim area (Q-15, Q-21, Q-24). The
  sidebar (Wave C) lists facet headings WITHOUT counts. Counts and badges
  are fine on every non-wiki surface (the mode screen already shows "N
  harvests").
- **The sounding no-touch zone**: any `web/main.ts` code matching
  `sounding`, `offer`, `gate`, `ladder`, `descent`, `parked` — never
  modify, move, or reflow. New exchange elements append beside, not within.
- **Byte-surgery editing only**: your edit tool auto-formats whole files.
  Every edited file must pass `git diff <file> | wc -l` ==
  `git diff -w <file> | wc -l` at the end of each wave.
- **File style**: 1-space indent, single quotes, prose-sentence comments.
- **Do not commit.**
- Verification after every wave: `npx tsc --noEmit`, `npm test`,
  `npm run build` — all green before reporting.

---

## Wave A — routing and the persistent shell

### Task A1 — hash routing

`navTo(screen)` also writes `location.hash = '#/' + screen` (guard against
redundant writes). On boot and on `hashchange`, read the hash and `navTo`
the named screen when it is a member of the `Screen` union; unknown or
empty hash → the default boot flow. Screens that need session state they
do not have (`exchange`, `harvest` without `state.sessionId`/proposals)
must fall back to `home` rather than render broken — add that guard inside
`navTo`. The login/setup flow keeps precedence: an unauthenticated 401
still lands on `login` regardless of hash.

### Task A2 — the top nav, on every screen

A `renderShell()` helper builds a persistent header bar (class `topnav`):

- Wordmark `elicit` (left, links `#/home`).
- Links: `home · wiki · library · import · inbox`, each a `nav-link`;
  the active screen's word carries class `here` (full ink, no underline).
- `inbox` carries a count badge (class `topnav-count`) filled from
  `/api/harvest-queue` — a small number in `--warn` ink when > 0, absent
  when 0. Refresh the badge on every `navTo`.
- `clear()` keeps the shell: restructure so `main` holds `topnav` +
  `#surface`, and `clear()` empties only `#surface`. All render functions
  append into the surface element. The login and setup screens render
  WITHOUT the shell (no nav before auth).

Screen mapping: `home` = the current `mode` screen for now (Wave B rebuilds
it); `library` = the current `material` screen; `inbox` = the current
`reviews` screen. Add `'home'` and `'library'` and `'inbox'` as aliases in
the `Screen` union routing (map them onto the existing render functions;
delete no existing screen names yet). Remove the now-redundant per-screen
back rows ONLY where the back target equals a topnav destination (waiting,
wiki, material, reviews, import); keep contextual backs (piece → material,
setup → mode).

### Task A3 — styles

`.topnav`: full-measure row, ui font 0.8rem, dimmed words, hairline
bottom border (`--border`), background `--bg`, sticky top. `.topnav .here`
= `--fg`, no underline. `.topnav-count` = `--warn`, 0.7rem, superscript
feel. The content column below keeps `--max-w` centered.

### Wave A verification

Beyond the standard three: `grep -c "renderShell" web/main.ts` ≥ 8 (wired
into every authed screen); manually state which screens kept a back link.

---

## Wave B — Home as a dashboard, session as a room

### Task B1 — Home absorbs the waiting surface

Rebuild `renderMode` as `home`: one surface, three regions top to bottom —

1. **Begin**: the existing mode controls (minutes/energy/target selects,
   topic input, begin + shuffle + just-write) grouped under a heading
   `start a sitting`. Keep all existing behavior including the deck
   shuffle sentence.
2. **Waits for you**: the harvest-queue sentence + the deferred/open
   questions list + expeditions — moved from `renderWaiting` (reuse its
   fetch/render code; the cadence sentence moves here too, above the
   lists). The parked-sounding section moves verbatim (no-touch zone: move
   the CALL, not the internals — if the section is inside the no-touch
   region, leave a stub `renderWaiting` reachable at `#/waiting` instead
   and put a link `parked descents` in the waits region).
3. **Activity**: the SSE activity feed from `renderWaiting`, collapsed to
   the last 8 lines with a `more` word that expands.

`waiting` as a separate screen disappears from the union routing (hash
`#/waiting` → `home`) unless the parked-section stub above was needed.

### Task B2 — the session room

`renderExchange` gains, WITHOUT touching the sounding zone:

1. A visible send affordance: a `send ↵` button (class `send-btn`,
   `submit-btn` styling at small size) right of the mic in `answerRow`,
   clicking = the existing Enter path. Keep the Enter hint line.
2. A quiet countdown: the declared `mode.minutes` counts down in the
   topnav area of this screen (`12:40 left`, class `session-clock`, ui
   font, dimmed; at 0 it just reads `time's up — harvest when ready`,
   nothing auto-fires). Store the deadline when the session starts.
   The Mode value is available at `begin()` in renderMode — pass minutes
   through state (`state.sessionMinutes`).
3. The `harvest now / skip / later / leave` row groups right-aligned under
   a hairline, visually separated from the writing area — the writing
   region above stays the void (no other chrome inside it).

### Wave B verification

Standard three; plus `#/home` shows begin+waits+activity in one page, and
state which element carries the countdown.

---

## Wave C — Library, wiki sidebar, piece toolbar, import steps

### Task C1 — Library with tabs

`renderMaterial` becomes the `library` surface: a tab row (`snippets ·
pieces`, classes `library-tabs`, active tab full ink) above the column.
Snippets tab = current material stack with its selection behavior; add a
client-side filter input (class `library-filter`, placeholder `filter your
words…`) that hides non-matching snippets as you type (plain substring,
case-insensitive). Pieces tab = the existing pieces list, one line per
piece with its date and (when present) its first pin's opening words as a
preview. The compose word stays as-is (it already counts).

### Task C2 — wiki sidebar

`renderWiki` gains a left sidebar (class `wiki-sidebar`, ui font, dimmed)
listing the facet headings present on the page + `Two things held at
once` when contradictions exist — each a link that scrolls its section
into view (`scrollIntoView({ behavior: 'smooth' })`). NO counts, NO
status words (canon). On narrow viewports (`max-width: 60rem` media
query) the sidebar collapses above the page as a wrapped word row. The
essay column and all claim rendering stay byte-identical in behavior —
reading grammar untouched, correcting mode untouched.

### Task C3 — piece toolbar

The piece nav row becomes a toolbar (class `piece-toolbar`): existing
words regrouped — left: `← library`; center: order words (`other
orders?`, principle names, `keep this order`); right: `add question ·
export · set down/pick up`. `add question` scrolls to and opens the
trailing seam's gap editor (reuse `openGapEditor`). Every pinned
paragraph gains a drag glyph `⠿` (class `piece-handle`, dimmed, left
margin, visible on hover of the paragraph; the paragraph keeps
`cursor: grab`).

### Task C4 — import steps

`renderImportEntry`'s entry surface gains step headings (ui font, dimmed):
`1 · the folder`, `2 · what the scan found` (above the manifest when it
renders), `3 · reading` (above the waiting/progress sentence when
present). Purely additive labels — the prose sentences underneath stay.
This is `web/import-entry.ts`; same byte-surgery and diff-gate rules.

### Wave C verification

Standard three; plus: the wiki sidebar contains zero digits
(`grep -oE '[0-9]' <rendered strings added in C2>` reasoning stated), and
`piece-handle` present in `web/main.ts` and `web/style.css`.

---

## Out of scope

Claim verbs beyond the landed two, arrangement side-by-side, server route
changes of any kind, `web/import-review.ts`, anything sounding.
