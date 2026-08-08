# The docket's job sequence stays explicit, not a table

The Docket's run is a fixed sequence of guarded jobs, written as inline
blocks in `src/clerk/docket.ts`. Each block checks the stop switch
(`if (!stopped() && deps.X)`) before running, then logs its outcome with a
`kind:` literal. A proposed "ordered job table" would collapse these blocks
into one data-driven runner.

Rejected after experiment: the collapse was implemented as a `runGuarded`
helper and reverted.

## Why the table was proposed

The ~30 job blocks share a shape: stop-guard, run, catch, log. A table of
`{ name, run, guards }` entries would remove the repeated guard scaffolding
and make the run order readable as data.

## Why it was rejected

`tests/emitted-kinds.ts` is a source scanner: it reads `kind: 'X'` literals
at their emitter sites and asserts every emitted kind has a sentence in the
Activity Log renderer. The repeated docket guard blocks ARE the visible
emission surface of the audit trail — each `deps.log({ kind: 'opener-minted'
… })` is a literal the scanner can enumerate. A `runGuarded` helper that
centralized logging orphaned 9 kinds: the scanner could no longer see where
they were emitted, and the audit-trail contract (every kind the codebase
emits must have a sentence) silently lost coverage.

The scanner is load-bearing by design: the union in `src/log/kinds.ts`
cannot notice a kind nobody declared a sentence for, so the sweep is the
other half of the check. Collapsing the emission sites hides them from the
sweep.

## Considered Options

- Ordered job table with a shared log helper (experimented, reverted —
  orphaned 9 kinds from the emitted-kinds scanner)
- Inline guarded blocks with literal kinds (chosen — current state)
- Table that keeps per-block literal emission (a table whose entries each
  carry their own `kind:` literal call site — equivalent complexity to the
  blocks, no win)

## Consequences

- The docket's run order is prose, not data — readable but not data-driven.
- Every job's emission stays at a scanner-visible literal site.
- Any future job-table design must keep the kind literals enumerable; the
  emitted-kinds scanner is the contract that gates it.
