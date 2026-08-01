# Elicit — Decision Register

Stable IDs for locked design decisions. Source documents: `CONTEXT.md`
(glossary + invariants), `docs/adr/0001-local-models-only.md`,
`docs/interface-references.md`, `research-shape-of-the-problem.md`.

| ID | Decision | Source |
|----|----------|--------|
| Q-1 | Sole Authorship: the agent never writes Snippet or Piece prose. Harvest cuts are exact substrings of the user's text, enforced in code, not by prompt. | CONTEXT.md — Sole Authorship, Harvesting |
| Q-2 | Local models only. All inference targets a local OpenAI-compatible endpoint. No hosted API calls, ever. | ADR-0001 |
| Q-3 | Markdown files are the source of truth. Any index is derived and rebuildable from the files alone. | Session decision (Q11), OptMem review |
| Q-4 | Facet and Stance are agent-authored Wiki readings that cite `snippet@version` — never fields inside the Snippet file. Snippet files hold only user prose plus Provenance. | CONTEXT.md — Wiki, Snippet |
| Q-5 | Snippet versions are immutable. An edit creates `v(N+1)`; old versions remain. | CONTEXT.md — Snippet |
| Q-6 | Fragments failing admissibility become Buds with their failures recorded — never edited into shape, never discarded silently. | CONTEXT.md — Bud |
| Q-7 | Mode constrains what is askable; it is never the optimization objective. Facet distribution is tracked per Mode. | CONTEXT.md — Mode; research §2-3 of contradictions |
| Q-8 | Transcripts are append-only and never edited. Agent summaries of Transcripts are Marginalia-class, barred from Pieces. | CONTEXT.md — Transcript |
| Q-9 | Interface draws from focus-friendly markdown editors: one column, no chrome, focus dimming, typographic hierarchy, no chat bubbles. | docs/interface-references.md |
| Q-10 | LLM access goes through `@mariozechner/pi-ai` (unified provider layer); pi-coding-agent machinery adopted only if needed. | Session decision (pi verified on npm, v0.73.1) |
| Q-11 | Fluency, vividness, specificity, and confidence are forbidden as Snippet quality signals. Only structural signals count. | research-shape-of-the-problem.md §(a) |
