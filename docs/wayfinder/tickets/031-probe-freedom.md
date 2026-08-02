---
title: "Fix: probe freedom — loosen generation, tighten validation"
labels: [wayfinder:task]
status: open
assignee: claude
blocked_by: []
---

## Question

User diagnosis from a live sitting (2026-08-01): "maybe the agent needs more
freedom." The evidence transcript shows quote-frame monoculture ("Could you
elaborate on what you mean by X", "Does the phrase X accurately describe
what you are trying to achieve in this conversation?"), a verbatim repeat of
the same question two turns apart, and probes that read as mechanical
anchor-exercises even when the user offers a line like "The body moves and
creates spaces for sadness to rest."

Principle: **freedom in generation, rigidity in validation.** The code
guards (parrot, degenerate, Q-12 for composed questions) catch bad outputs;
the prompt should stop trying to prevent them by straitjacket.

1. **Drop the mandatory-quote rule for live probes.** Q-12's verbatim-quote
   requirement binds COMPOSED questions (clerk path) only — it was never a
   register rule for every probe. Rewrite the protocol prompt: first
   understand what was said, then ask the question a good interviewer would
   ask next. The move library stays as repertoire ("ways in"), not
   prescription; quoting stays available, not required.
2. **Ban conversation-referential probes.** Questions about the
   conversation itself ("what are you trying to achieve in this
   conversation?") are furniture — prompt-level instruction plus a cheap
   code check (reject probes containing "this conversation").
3. **In-session no-repeat guard, in code.** Normalize and compare each
   generated probe against every question already asked this session;
   near-duplicate → retry once → fall back to a queue/bank draw. (Evidence:
   the same connect-question asked twice in one sitting.)
4. **Exactly one opener per session — verify.** A live transcript
   (01KZ0AKPP1…) recorded two agent openers before the first user turn on
   the old server. Confirm current startSession cannot do this (test), and
   that the web client renders the opener the server returned.
