# How Elicit Works — Resources

## Knowledge

- [README.md](README.md)
  The pitch and the operator's view: what a session looks like, how to run
  it against real models, the vault layout. Use for: onboarding, the
  10,000-foot loop.
- [CONTEXT.md](CONTEXT.md)
  The project's own glossary — every domain term (Snippet, Claim, Docket,
  Sounding, Question Source, ...) defined once, precisely, with its
  invariants. Use for: what a term means before trusting any lesson's
  gloss on it. This is the single highest-trust source in the repo — but
  check its git log date against `docs/decisions/elicit.md`'s latest
  entry before trusting it on anything recent (see Gaps below; as of
  2026-08-03 it's a day behind the campaign's Q-79..Q-85 rulings).
- [docs/decisions/elicit.md](docs/decisions/elicit.md)
  The decision register — Q-1 through Q-86 (and counting), each a locked
  design ruling with its reasoning and the session that made it. Use for:
  *why* a subsystem works the way it does, not just what it does.
- [docs/adr/](docs/adr/)
  Architecture Decision Records: `0001-local-models-only.md`,
  `0002-three-layer-memory.md`, `0003-vault-custody.md`. Use for: the
  handful of decisions that shape everything else (no hosted inference,
  memory layering, who owns the vault).
- [docs/interface-references.md](docs/interface-references.md)
  The UI's design lineage (iA Writer, Typora, Zettlr...) and what Elicit
  takes from each. Use for: why the interface looks the way it does — out
  of deep scope for this mission, but worth one lesson's context.
- `src/llm.ts`
  Not a doc — the actual agent configuration: two model roles (elicitor,
  clerk), how each is built into a pi-ai `Model`, timeout/token budgets,
  and why a dead endpoint never silently falls back to the other role.
  Use for: grounding any lesson on "how is the agent configured."
- `src/server.ts`
  The wiring point — every subsystem gets imported and connected here.
  Long (3800+ lines) and not meant to be read start to end, but grep-able:
  the import block at the top is a map of every subsystem the server uses.
- Research files at repo root: `research-shape-of-the-problem.md`,
  `research-question-policy.md`, `research-llm-wiki-gist.md`,
  `research-codex-lessons.md`. Use for: the pre-code research that the
  domain model and question policy were designed against — deep material,
  reach for these once CONTEXT.md's terms feel solid.
- [pi (badlogic/pi-mono)](https://github.com/badlogic/pi-mono)
  The upstream agent framework (`@mariozechner/pi-ai`) Elicit is built on.
  Use for: what's Elicit-specific vs. what's the framework's job (message
  format, `complete()`, `Model` typing).

- [reference/glossary.html](reference/glossary.html)
  Plain-English on-ramp for every project term the lessons use, grouped
  by subsystem. Use for: first contact with any coined term; then
  `CONTEXT.md` for the precise, canonical version. Every lesson must keep
  this in sync — a term used in a lesson but missing here is a lesson bug.

## Wisdom (Communities)

- None sought yet — this mission is presently scoped to reading Elicit's
  own code and docs, not community discussion. Revisit if a lesson runs
  into an open design question the register doesn't settle (e.g. general
  knowledge-elicitation methodology, agent architecture patterns beyond
  this repo).

## Gaps

- No resource yet explains the *test suite* as a source of truth (README
  calls the tests "the contract"). A future lesson should read a few
  invariant tests directly rather than relying on prose about them.
- `CONTEXT.md` (last touched 2026-08-02) doesn't yet have glossary entries
  for DRM, territory instruments (`ktg`), the gazetteer/role-taking
  second-perspective doors, pattern dosing, or the lineage mirror — all
  ruled on in `docs/decisions/elicit.md` Q-79 through Q-85 (2026-08-03)
  and already implemented in code. Until someone folds those into
  `CONTEXT.md`, treat the decision register + the actual source as the
  higher-trust pair for those five topics specifically.
- The Docket (`src/clerk/docket.ts`, `runDocket`) has grown substantially
  across the five campaign waves — its `deps` type signature is the only
  fully current description of what one run does; any prose summary
  (including in Lesson 1) should be treated as a snapshot, re-checked
  against the signature before being trusted.
