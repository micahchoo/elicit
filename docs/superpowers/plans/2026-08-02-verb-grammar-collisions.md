# Fix the verb-grammar collisions in the web UI

## 1. Goal

Codify the verb-grammar principle in the design doc, and fix the four places
where a surface renders a verb in the wrong verb's display grammar.

## 2. Architecture context

Elicit is a local interviewer app. The whole browser UI is three files:

- `web/main.ts` — every screen, vanilla TS, no framework. Screens render via
  `render*()` functions; DOM built with the local `el()` helper.
- `web/style.css` — design tokens in `:root` (`--fg`, `--dim`, `--border`,
  `--accent`, `--warn` does NOT exist yet). Aesthetic: quiet, monochrome,
  small dimmed underlined words as controls.
- `docs/interface-references.md` — the design contract the code cites.

**The principle being implemented** (agreed 2026-08-02): the app's "document
rule" (every surface is a page of text) is the correct display grammar for
two verbs only — writing and reading. Three other verbs need their own
grammars:

- reviewing → the queue: verdict state, progress count, weighted verbs
- correcting → the diff: constraint visible, live validation, explicit
  commit/cancel, never a silent revert
- composing → the board: drag handles/cursors, draft vs committed visible

A surface renders its dominant verb's grammar; secondary verbs appear as
explicit mode shifts.

## 3. Hard constraints

- **Never weaken the verbatim-words invariant.** A trim must remain a
  contiguous substring of the original proposal text. The existing predicate
  `p.text.includes(v) || v === p.text` is load-bearing — reuse it, do not
  loosen it.
- **Match file style exactly.** `web/main.ts` uses 1-space indentation,
  single quotes, and comments written as prose sentences explaining
  constraints (not narrating code). Match all three.
- **Do not commit.** Leave changes in the working tree.
- **Touch only** `web/main.ts`, `web/style.css`,
  `docs/interface-references.md`. No other files.
- Keep the quiet aesthetic: new controls are words in the existing classes
  (`nav-link`, `proposal-action`), not new button chrome.

## 4. Tasks

### Task 1 — design doc: the verb-grammar rule

**File:** `docs/interface-references.md` (append a new section at the end).

Add a section titled `## The verb-grammar rule (added 2026-08-02)` stating:

1. The document rule above is the display grammar of two verbs — writing and
   reading — and had been over-applied to all five.
2. The five verbs and their grammars (one line each):
   writing/dictating = the void (full-bleed input, context dimmed, no
   feedback until done); reading = the essay (hierarchy, ink as evidence,
   navigation only); reviewing = the queue (verdict state per item, progress
   count, consequence-weighted verbs); correcting = the diff (before/after
   co-visible, constraint stated, live validation, explicit commit and
   cancel); composing = the board (overview plus detail, drag affordances,
   draft vs committed visible).
3. The rule: a surface renders its dominant verb's grammar; secondary verbs
   enter as explicit mode shifts — chrome arrives on entry and leaves on
   exit, never interleaved at rest. The exchange's focus dimming and the
   defer-row reveal are the existing precedents.

Write it in the doc's existing voice (see "The document rule" section for
tone). Keep it under 40 lines.

### Task 2 — trim editor: correcting gets its grammar

**File:** `web/main.ts`, function `renderProposal`, the `trimBtn` click
handler (search for `'confirm trim'`). Currently the confirm handler does:

```ts
const v = editorEl!.value;
if (!p.text.includes(v) && v !== p.text) {
 editorEl!.value = p.text;   // silent revert — destroys the person's edit
 return;
}
```

Replace the silent revert with live validation:

1. When the trim editor opens, also append a constraint line under it:
   a `p` with class `trim-constraint`, text:
   `a trim keeps one continuous span of your words — cut, don't rewrite`.
   Remove it in `clearEditor()` along with the editor and confirm button.
2. On every `input` event of the editor, evaluate validity with the existing
   predicate (`p.text.includes(v) || v === p.text`, where `v` is the raw
   editor value) plus non-empty after `.trim()`. Invalid → add class
   `invalid` to the editor and set `confirmEl.disabled = true`. Valid →
   remove the class, enable confirm.
3. The confirm handler keeps the predicate as a final guard but must NEVER
   overwrite `editorEl.value`. On valid input it calls
   `setDecision('trim', v)` and `clearEditor()` exactly as now.

**File:** `web/style.css`. Add a `--warn: #9a4b38;` token to `:root`
(muted brick — the palette's first non-monochrome ink, reserved for
destructive/invalid). Style `.trim-constraint` like other dimmed UI lines
(font-family `var(--font-ui)`, font-size 0.7rem, color `var(--dim)`), and
`.trim-editor.invalid { border-color: var(--warn); }` (the editor already
has a border; check its existing rule and override only the color).

### Task 3 — the blur pair: blur never commits, never discards

**File:** `web/main.ts`, piece surface.

Current bug: the trailing composer (class `piece-composer`, inside `paint()`
in `renderPiece`) commits its text on `blur`, while the gap question input
(class `piece-gap-input`, in `openGapEditor`) discards its text on `blur`.
Opposite semantics, identical look. New rule: **blur is inert on both.**

1. Composer: delete the `blur` listener that POSTs `/prose`. Instead create
   an `add paragraph` control — a `button` with class
   `nav-link piece-composer-add`, appended after the composer, `hidden`
   while `composer.value.trim()` is empty (toggle in the existing `input`
   listener, the way `compose` toggles on the material screen). Its click
   handler runs exactly what the old blur handler ran (disable composer,
   POST `{ arrangement: arrangement.id, text }` to
   `/api/piece/:id/prose`, then `refresh()`; on failure re-enable and
   `console.error`). Update the comment above the composer: it commits on an
   explicit act, never on leaving.
2. Gap input: in `openGapEditor`, change the `blur` listener so the input is
   removed only when `!committing && input.value.trim() === ''`. With text
   present the input stays where it is. `Escape` still discards
   (existing behavior, keep it).

**File:** `web/style.css`: `.piece-composer-add` needs no new rules if
`nav-link` covers it; add a rule only if alignment demands one.

### Task 4 — harvest: reviewing gets progress and a weighted verb

**File:** `web/main.ts`.

1. In `renderHarvest` (non-empty branch), add a progress line: a `p` with
   class `harvest-progress`, initial text `0 of N decided` (N =
   `state.proposals.length`), placed above the save button row.
2. Make `setDecision` (inside `renderProposal`) refresh it: after pushing
   the decision, query `document.querySelector('.harvest-progress')` and, if
   present, set its text to `${state.decisions.length} of
   ${state.proposals.length} decided`. (Decisions replace per proposal —
   the existing filter guarantees at most one per index — so
   `state.decisions.length` is the decided count.)
3. Change the save button label from `save` to `save decisions`.

**File:** `web/style.css`:
- `.harvest-progress`: font-family `var(--font-ui)`, font-size 0.75rem,
  color `var(--dim)`.
- `.proposal-action.discard { color: var(--warn); }` at rest — currently
  discard differs from approve only on `:hover`, which hides the one
  destructive verb. Keep the existing hover rule.

### Task 5 — composing: the drag affordance at rest

**File:** `web/style.css`. `.piece-para` is draggable but shows no cursor
until `:active`. Add `cursor: grab;` to the base `.piece-para` rule.

## 5. Execution order

Tasks are independent; do them in order 1→5. All of 2–4 touch
`web/main.ts`, so do not parallelize.

## 6. Verification (run from repo root)

1. `npx tsc --noEmit` — must exit 0 (repo-wide typecheck, includes web/).
2. `npm test` — vitest; the suite must stay green (it covers the server,
   which these changes must not touch).
3. `npm run build` — vite build of web/ must succeed.
4. `grep -n 'blur' web/main.ts` — confirm no listener commits text on blur.

## 7. Manifest

- Modify: `web/main.ts` (tasks 2, 3, 4)
- Modify: `web/style.css` (tasks 2, 3, 4, 5 — plus the `--warn` token)
- Modify: `docs/interface-references.md` (task 1)

## 8. Out of scope

The larger verb-modal redesign (wiki claim verbs, inbox queue, arrangement
side-by-side) is deliberately not in this plan. Do not start it.
