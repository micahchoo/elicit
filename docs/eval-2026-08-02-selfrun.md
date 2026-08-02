# Self-run eval — 2026-08-02, post-fix-wave tree

Agent-run against bonsai-27b at the current tree (LICENSE commit), fresh
vault, exercising every fix landed since docs/eval-2026-08-01-real-model.md.

## Everything that was broken yesterday works today

- **Full memory loop, live**: session 1 (4 substantive turns) → harvest
  kept 2 → post-harvest docket COMPLETED (`opener-minted: 2` with refs —
  yesterday it died in composeOpener) → session 2 turn echoing
  "vocabulary phase" → **juxtaposition fired**, quoting the prior
  snippet verbatim. The crown-jewel path: proven end to end.
- **Probe quality (Q-36 repertoire)**: 3 probes, 3 frames — ladder-down
  with quote, find-the-edge WITHOUT quote ("What is the difference
  between learning a new vocabulary and actually mastering the
  practice?" — the freedom rule visibly working), anchored what-did-you-
  mean. No echoes, no clarify monoculture, no internal-label leaks.
- **Defer (029)**: `question-deferred` logged distinct from skip; entry
  in queue with modeNeeds=energy; next question served; budget intact.
- **Unprompted (029)**: pasted prose → proposals with verbatim cuts
  under a fresh session id.
- **Harvest robustness (156d686)**: /end after a trailing probe returned
  proposals (user-last fix holding in production).

## Observations for the ledger

1. **Cross-session question repeat**: session 2's opener was verbatim
   session 1's probe-2 (the minted opener re-asks the snippet's eliciting
   question too literally). In-session no-repeat is guarded; CROSS-session
   exposure control is not — already ticket 015's scope; this is its
   first production sighting.
2. **Bank draw quality floor**: defer's replacement question was "Where &
   how will the message be broadcast (distribution)?" — passes the weak-
   form filter but is context-junk. The transformative deck
   (data/decks/transformative.jsonl, curated today) should become the
   fallback pool — ticket 026 wiring.
3. Latency unchanged: turns 4-9s, /end ~20s, post-harvest docket ~90s of
   background minting (invisible to the user — correct per Q-22).
