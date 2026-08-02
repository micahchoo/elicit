# HANDOFF — Elicit

Updated: 2026-08-02.

## What this is

A local-only agentic elicitation tool: it interviews a person and builds a
human-shaped wiki — beliefs, contradictions, knowledge, skills — out of
nothing but their own verbatim prose. Writing a Piece is one emergent
output, not the goal.

Read `CONTEXT.md` first (the domain language; every term was decided, not
drafted), then `docs/decisions/elicit.md` (Q-1..Q-47, the constraint
register every plan cites).

## Hard facts

- **Model**: `qwen3.6:35b` on Ollama, `http://192.168.0.229:11434/v1`
  (switched from bonsai-27b 2026-08-02; ADR-0001 records it). Same host
  serves embeddings (`qwen3-embedding`, `nomic-embed-text`). Never a hosted
  API, ever.
- **Run**: `npm start` (local model, builds UI first) · `npm run dev` (fake
  LLM, watch) · `npm test`. Port 4517; zombie: `fuser -k 4517/tcp`.
  Host-bound for phone: set the password from the host machine first, then
  `ELICIT_HOST=0.0.0.0 npm start`.
- **Password** is set IN-APP on first run from loopback (scrypt at
  `vault/.auth.json`). No env var.
- **Vault is gitignored and NOT backed up** — Micah declined a backup
  regime 2026-08-02 (ticket 017). The risk stands.
- LLM seam is `@mariozechner/pi-ai`. Every model call must carry a
  user-role message. Every model-touching job is try/catch-isolated.
- Invariants live in CODE, never in prompts (Q-1, Q-12, Q-36).

## State

Slices 1 and 2 are built and closed (interview loop; "it remembers you" —
composed openers, resonance/juxtaposition, durable queue, docket, Cover
memory, activity log). Voice input, in-app auth, unprompted entry, defer,
expeditions, protocol registry with domain instruments, waiting states: all
shipped. ~400 tests, tsc clean, `vite build` clean.

The Wiki-claim layer — Claims, Contradictions, Propagation, the Clerk's
write contract — is DESIGNED (Q-28..Q-35) and NOT BUILT. That is the next
slice and the app's differentiating half.

## Where the truth lives

- `docs/wayfinder/map.md` + `tickets/` — the build map. Closed tickets carry
  a `resolution:` in frontmatter; the map indexes them.
- `docs/superpowers/plans/2026-08-02-the-clerk.md` — the next slice's plan.
  Review round 1 returned REVISE with 7 blockers; a revision is in flight.
- Evals (read these before trusting anything):
  - `docs/eval-2026-08-02-claude-adversarial.md` — a peer session red-teamed
    the whole app. Found the canon-string drift, the silent harvest failure,
    the validator gaps, the resonance overclaim. Its "learnings" section is
    the most useful page in the repo.
  - `docs/eval-2026-08-01-real-model.md`, `docs/eval-2026-08-02-selfrun.md`.
- `docs/question-composition.md` — how questions are made today vs the
  target state.
- `docs/interface-references.md` — the document rule: every surface is a
  page of text; controls only at the point of attention. Wireframes on
  tldraw board `elicit-interface`.

## Standing practice

- Build work goes to subagents with DISJOINT file ownership stated in the
  brief (this repo has had collisions). Commit only your own files, never
  `git add -A`.
- Every fix ticket's acceptance includes a REAL-MODEL run, not just tests.
  Green tests have twice hidden real bugs here.
- A test whose oracle is the implementation proves nothing —
  `tests/canon.test.ts` reads the spec files instead. Copy that pattern for
  anything the register specifies verbatim.
- Never trust a model self-reported boolean as a gate (standalone, opposed,
  converged, distressed). Structural checks or nothing.
- Plans get an adversarial review round before dispatch.

## Open frontier

Blocked on the Clerk build: seeding (013/014), coach (016), gap-fill (027),
graph-bounded context (033).
Buildable now: composition (010, scoped both passes), Soundings (012,
scoped), randomizer (026), queue maturation (015), facet balance (042, in
flight), harvest facet bias (037), markAnswered (041).
Micah's: real sittings — the corpus is small and skewed (measured 25
construct, 0 episodes), which is what ticket 042 exists to correct.
