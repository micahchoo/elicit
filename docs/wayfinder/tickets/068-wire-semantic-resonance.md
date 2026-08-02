---
title: "Build: wire semantic resonance into the surfaces that use resonate()"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 3)
blocked_by: []
resolved: 2026-08-02
---

## Question

Ticket 053 built `src/index/semantic.ts` and measured it: **7/8 recall by rank
against the incumbent's 0/8** on the standing paraphrase fixture, 139 snippets
primed in 12.6s, 173ms warm query latency. It is committed at `a6c4610`.

**Nothing calls it.**

053 named this itself rather than letting it be discovered, and named the call
sites exactly. That is the only reason this ticket can be short — five things
have shipped inert on this project and this would have been the sixth.

### The call sites

| file:line | what it does | change |
|---|---|---|
| `src/server.ts:569` | turn endpoint builds the `juxtaposition` payload | `resonate(currentIndex, body.text)` → `await resonateHybrid(currentIndex, semanticIndex, body.text)`; build the index beside `buildIndex` at `src/server.ts:1203` with `fileSnippetVectorStore(vaultRoot)`, and `prime()` in the background |
| `src/elicitor/elicitor.ts:322` | priority-1 juxtaposition — **the surface the person meets each sitting** | add `semantic?: SemanticIndex` to the deps at `elicitor.ts:62` and `src/types.ts:317,342`; `await resonateHybrid(...)` |

`resonateHybrid` puts lexical hits first, so this is a fill-the-silence
addition rather than a replacement: today's behaviour is unchanged wherever
lexical already finds something.

`src/clerk/wiki-jobs.ts:604` and `src/wiki/clash.ts:220` are claim-level and
belong to ticket 064, not here.

### The decision that blocks the elicitor path, deliberately

`composeJuxtaposition` **cannot accept a `SemanticHit`**, and that is by
construction rather than by oversight: a `SemanticHit` carries no
`sharedPhrase`, and `composeJuxtaposition` requires a verbatim shared substring
because Q-12 is enforced in code (`src/clerk/composed.ts:387-403`). 053 held
that shut with a `@ts-expect-error` test rather than widening the type.

So someone has to decide, in the open: **what may a semantic juxtaposition
quote?**

053's recommendation, and mine: **the snippet's own words** — the person's own
past prose, framed as then-versus-now. Q-1 and Q-12's "no words in their mouth"
still holds, because every quoted word is theirs. What it gives up is the
lexical channel's ability to point at the *shared phrase* as the reason the two
are connected; a semantic juxtaposition has to justify itself by the
juxtaposition rather than by an echo.

That lands in `src/clerk/composed.ts` and is ticket 040/046 territory. It
should be settled before the elicitor path is wired, and the server path can
land without it.

### One consequence to land with the wiring

`tests/resonance-paraphrase.test.ts` holds `SEMANTIC_CHANNEL_LIVE`, currently
false. When the wiring lands it goes **true**, and `RECALL_FLOOR` should be
**0.75** (6/8) — one pair below the measured 7/8, so a real regression fails
and third-decimal noise does not.

## Acceptance

- A sitting whose answer paraphrases an old snippet with no shared phrase
  surfaces that snippet. Today it surfaces nothing.
- Lexical hits still come first and today's behaviour is unchanged where
  lexical finds something.
- `SEMANTIC_CHANNEL_LIVE` is true and the fixture holds at ≥ 6/8.
- The semantic path is exercised by a test that boots the real app — not by a
  test asserting the function was called.

## Resolution (2026-08-02)

**RULED — what a semantic juxtaposition may quote: the snippet's own words.**
053's recommendation, adopted: every quoted word is the person's, framed
then-versus-now. `composeJuxtaposition` still refuses a `SemanticHit` — the
`@ts-expect-error` in `tests/semantic-resonance.test.ts` holds and the
signature was NOT widened. The elicitor supplies the quotable text through
the new `quotablePhrase(snippetText)` in `src/index/semantic.ts`: the first
four whitespace-separated words of the matched snippet, edge punctuation
trimmed, always a verbatim substring — never an invented phrase. Q-12's
verbatim enforcement is satisfied because the quoted words are verbatim in
the snippet; what justifies the connection is the juxtaposition, not an echo.
The ruling is enforced by a test that composes a juxtaposition from a
semantic hit and asserts the question quotes the snippet's own words.

### What landed

- `src/server.ts` — the turn endpoint awaits
  `resonateHybrid(currentIndex, semanticIndex, body.text)`; the boot path
  builds the semantic index beside `buildIndex` from the WHOLE corpus with
  `fileSnippetVectorStore(vaultRoot)` and `prime()`s it in the background
  (local mode only — under the fake responder there is no embedder);
  `semanticIndex` flows through `ServerDeps` into the turn endpoint and into
  `startSession`.
- `src/elicitor/elicitor.ts` — priority-1 juxtaposition awaits
  `resonateHybrid(s.deps.index, s.deps.semantic, text)`; lexical hits pass
  through unchanged, semantic hits are converted to a quotable view via
  `quotablePhrase` (the ruling above).
- `src/types.ts` — `semantic?: SemanticIndex` on `SessionState.deps`
  (type-only import; no runtime dependency).
- `src/index/semantic.ts` — new export `quotablePhrase`.
- `src/registry.ts` — `fileSnippetVectorStore`, `buildSemanticIndex`,
  `resonateHybrid` and `quotablePhrase` declared **live** (the 077
  cross-check ratchet); the bound entries' reasons refreshed to the wired
  state.
- `tests/resonance-paraphrase.test.ts` — `SEMANTIC_CHANNEL_LIVE = true`,
  `RECALL_FLOOR = 0.75`, retrieval routed through `resonateHybrid` on the
  recorded geometry. Measured 7/8 by rank — the floor holds with margin.
- `tests/wire-semantic-resonance.test.ts` (new) — boots the real app: a
  paraphrase with no shared phrase surfaces the stored snippet (today it
  surfaced nothing); without the channel the same turn surfaces nothing; a
  verbatim echo still surfaces through the lexical arm; the elicitor
  composes a juxtaposition quoting the snippet's own words.
- `tests/mechanism-registry.test.ts` — the forged "live with no caller"
  example moved from `resonateHybrid` (now wired, so the forged entry would
  pass) to `PROTOCOLS` (still callerless).

### Verification

- `npx tsc --noEmit` — clean.
- `npm test` — **1307/1309 pass**. The two failures are
  `not declared: src/import/body:{clean,dropCitedParagraphs,toTurns}` — the
  concurrent import slice's untracked in-flight file whose registry
  declarations belong to that ticket, not this one. Every failure
  attributable to 068 is green, including the mechanism-registry cross-check
  for the flipped entries.

### Notes

- The semantic index is built once at boot from the whole corpus and primed
  in the background; a docket run replaces only the lexical index. New
  snippets arriving mid-process are embedded on the next boot's prime — fine
  for the standing corpus, worth its own ticket if a long-running process
  adds snippets.
- The claim-level semantic channel (`wiki-jobs.ts:604`, `clash.ts:220`)
  remains ticket 083's.
