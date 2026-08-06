# Elicit Usability Report

Date: 2026-08-05.
Sources: all five archive vaults under `archives/`, the product surface (`README.md`, `CONTEXT.md`, `web/`, `src/`), `run-protocol.md`, `eval-diary.md`, `docs/queue-review-2026-08-03.md`.
Method: four parallel readers covered every transcript (49 across both real vaults), all 86 wiki claims, all 67 queue entries, all snippet headers, ~1,700 activity-log lines, and the code paths behind each finding.

This report describes what a user experiences, not what the code intends. Findings are ordered by harm.

---

## 0. Corrections to the eval diary — read before citing it

The diary's archive table is wrong. Do not cite its rows.

| Diary says | On disk |
|---|---|
| Ilse = `archives/2026-08-04T04-59-21/` (178 snippets, 10 transcripts) | That vault holds 4 transcripts of Micah's own real notebook content. Zero Ilse. Ilse actually lives in `archives/2026-08-05T04-37-51/` (10 transcripts, 193 snippets, 52 claims). |
| Dara = `archives/2026-08-05T03-17-13/` ("3 sessions lost to TTL") | That vault is empty — 4 files, zero transcripts, and its log is a Hugo blog import. Every `expired` event in every real log reads `expired 0 entries`. **Nothing was ever lost to TTL.** |
| Wendell = `archives/2026-08-05T03-44-15/` (112 snippets) | That vault holds 2 import transcripts and 6 snippets. The 112 figure matches nothing on disk. |
| "Current vault" = Tomas + Priya | `archives/2026-08-05T05-28-13/` is one **shared** vault holding Dara (12), Wendell (10), Tomas (10), and Priya (7), back to back, no reset. |
| Import ❌ "permission error (runtime)" | Unreproduced and undocumented anywhere. The Wendell-window log shows import **succeeding three times** (`import-committed snippets=6` etc. against `staging-nw/content/posts/`). |
| Sittings were 15–45 minutes | Wall clock: Wendell's ten "25-minute" sittings ran in 5m10s total. Most sittings are one exchange. |

Also: `run-protocol.md:16` documents `POST /api/session {format:'protocol'}` as a trigger. The route reads only `{mode, shuffle}` (`src/server.ts:1272`); that field does not exist. The protocol document tests a control that was never wired.

---

## 1. What held

The core guarantee — the model never writes your words for you — held everywhere it was checked.

- **Verbatim harvest: 0 of 431 snippets non-verbatim.** `fabricationDrops=0` on every harvest. The substring gate is real.
- **Per-vault isolation held.** Ilse's vault (single persona) has zero contamination hits for any other persona's canon terms.
- **Intra-sitting recall works.** The agent quotes the current sitting's material accurately.
- **Cross-sitting recall, when it fires, is the best thing in the product.** "How does this emphasis on *earning* routes contrast with your past belief that 'I set routes that are fair'?" pulled Ilse's best answer: "Fair is for everyone. Earn is for the ones who come back."
- **DRM produced the richest material in the corpus** ("When I cross the reservoir I am not a nurse anymore. I am just Dara with a dog"). Structured elicitation out-performed free conversation.
- **The import flow's refusal manifest is good UX**: every rejected file named, with its reason in plain language.

Everything below sits on top of this sound floor. The invention problems live entirely in the reading→claim layer, not in the snippet layer.

---## 2. Severity 1 — The queue is speaker- and context-blind, and the app will not repair

The queue is FIFO. It mints a follow-up from a stored fragment and fires it as the next sitting's opener with no check that the fragment belongs to the current thread — or, in the eval, the current person.

- All 10 of Wendell's sittings and all 10 of Tomas's opened with questions built from Dara's life (her daughter, her dog, her dead brother's guitar — by name).
- Dara's most guarded secret — "I was the one who said it was time to turn off the machines," marked "I do not talk about this" — was juxtaposed into **two other users' sittings**. The match key was the bare function phrase **"the one who"** (snippet `01KZ84K4RF...`, offered at 05:06:39 and 05:19:24).

**What the app did when corrected is worse than the error.** Wendell: "My son is not dead. He is in Winnipeg. That is not my story." The agent replied by quoting the correction back and asking how his "uncertainty" connects to his past. Priya: "That is not something I said." The agent asked: *"What specific memories or events are you trying to separate from your own experience?"* — the app invented a death, was told so, and asked the user what they were repressing.

Then it harvested the bug report as biography: the correction is stored as a snippet, and the wiki read it as "The user draws a boundary around what constitutes their personal narrative."

The diary files this under "methodology flaw, not an Elicit bug." The *cause* (multi-persona, one vault) is methodology. The *behavior* is a product defect that will reproduce for a single real user: fragment-level matching on phrases like "the one who" or "the quiet after" will cross-wire any vault containing two relatives, two deaths, two jobs with shared phrasing. And the app has no repair move at all — no acknowledge, no un-file, no "I got that wrong." Its only verb when contradicted is to probe the contradiction.

Permanent damage: Wendell's real confessions (the piano, the dory) are stored under provenance headers naming Dara's questions. The archive records his grief as answers about another man's brother.

## 3. Severity 2 — Sittings have no ending

21 of 22 Ilse/Dara sittings, and all of Wendell's, terminate on an **unanswered agent question**. No closing, no summary, no acknowledgment of what was kept. The transcript just stops. The one exception is the DRM protocol, because it has a finite script.

For a memoir product this is the most conspicuous absence: the user's deepest disclosure is routinely the last line before silence. Dara's voicemail secret ("I have told no one this") was answered with "Why do you believe it is important that you have not shared this with anyone?" — and then the sitting ended.

Related: openings are also broken. Because every opener is a `You wrote:` callback, no sitting begins; the user is dropped mid-conversation into a follow-up. Two agent turns fire before the user speaks and the first is discarded (one shipped with an unbalanced parenthesis).

## 4. Severity 3 — The wiki records the cover story and loses the confession

The whole eval was designed around planted revisions (Mendoza, ICU→hospice). The wiki missed every one — not by distortion but by **starvation**:

- Sweep throughput is clipped (`mint.callsPerRun=12`) and never catches up: Ilse ended with 130 of 193 readings unswept; the shared vault's docket was cut mid-run at 05:03 and never resumed, freezing the wiki 21 minutes before the last sitting.
- Result: 6 of Ilse's 10 sittings produced zero claims — including both sittings containing the Mendoza revision. "The shoulder was real. Two surgeries. It healed." never became a claim; "the scar aches when it rains" did. Dara's 34 claims all come from 2 of her 12 sittings; Wendell, Tomas, and Priya have **zero claims** after 27 sittings.

What did get through is frequently wrong in ways a user would experience as violation:

- **Negation dropped:** "I *would* put a social worker on Saturday... So we do without" → claim: "The user **plans to** implement a social worker service on Saturday" (`facet: intention`).
- **Invented biography:** "The user used to work as a toolmaker" (her *father* was); `range: at age seventy` (Dara is 47; the remark was about patients); a generic line about dying patients converted into a claim about Dara's own death and her own daughter.
- **Disclaimer recorded as affirmation:** "That is as close to theology as I get" → "The user views certain personal rules as a form of theology," twice.
- **Merges manufacture confidence:** all three of Ilse's `evidenced` claims are bad merges; one welds "the wall as sanctuary" with "the wall as blank" and promotes the inversion to evidenced status.
- **Redundancy:** five claims restate Dara's Friday rule; dedupe is starved (`clash.judgmentsPerRun=3`, up to 350 pairs left unjudged per run) and embeddings cover only 28 of 34 claims.
- Every claim in both vaults is `status: unconfirmed`, `attested: false`. Nothing was ever ratified by anyone.

The only correct summary of the Mendoza arc anywhere is in a marginalia file linked to no claim.

## 5. Severity 4 — Two question templates, no ear

- 67 of 67 queue entries across both vaults open with `You wrote: "..."` or `"..." — what is the opposite of this for you?`. All 67 are tagged `sharpness: weak` — the field has never taken another value and carries no signal.
- **Register collapse:** stakeholder-alignment language to a climbing coach ("How do you ensure that the solutions provided by others are aligned with your original vision and requirements?"); asset-management language to a bereaved sister holding her brother's guitar ("how might you preserve its value without having to play it?"); therapy register documented in the queue review ("hold space", "honor").
- **Picks trivia over freight:** offered Marguerite's death and forty years on the Sound, the agent asked about the phrase "the rest of." Offered "I am negotiating for the storefront and I have not told her," it asked how he plans to "honor smallness as virtue" when he secures it — stepping past the concealment, which was the sentence.
- **Ignores the user's own flag:** Priya said "the birds are probably the thing that is most mine"; the agent asked about staying grounded in the present.
- **Re-asks the just-answered** (five queue entries), **asks for what the user said they don't have** ("What technical term describes this tonal characteristic?" — "I just said I do not know the word"), **inverts meaning at sitting close** twice, and **dodged the one direct challenge** ("Would you have done better?").
- For a verbose user it quotes 60–80-word blocks back whole; for a terse user it asks consulting questions. Neither register adapts.

Notable irony: Priya's four real disclosures (the spreadsheet of exit plans, the one-night rule, the Latin names, "the people-person line is her voice, not mine") all came from **imported Are.na question lists** — including a first-date question — served only because the queue had drained empty. The fallback outperformed the pipeline.

## 6. Severity 5 — Harvest chops meaning into confetti

Snippets are cut at sentence boundaries. For a terse user that destroys the unit of meaning: Ilse's median snippet is **5 words**; 33% are ≤4 words. "It healed." — the fact the persona turns on — is a two-word fragment with no subject. Wendell's "Until now." (his explicit first-time-telling marker) is a standalone snippet.

Harvest also systematically keeps mechanics and drops freight: "Place my foot." became a claim; "The wanting did not." and Danny's actual voice ("Dara, pick up, I need you to hear this chord") were never harvested at all. One sitting lost everything to a silent parse failure (`harvest-failed parsed=false`), with no user-facing signal. The DRM sitting — the richest in the corpus — ended with `fragments: []` and zero snippets.

## 7. Discoverability of the non-self-reflective subsystems

Hypothesis confirmed, and sharpenable: for most of these subsystems the problem is not low discoverability — **it is unreachability**. A user cannot find them because there is no path to them at all.

| Subsystem | Affordance | Actual reachability |
|---|---|---|
| DRM | None | UI fully built (`web/main.ts:1831–2145`) but nothing calls `navTo('drm')`. Reachable only by hand-typing `#/drm` during a live sitting. Used once in 49 sittings — by the eval operator, who knew the route. |
| Protocols | None | No control on the mode screen; server picks by deterministic rotation on session count. `run-protocol.md`'s documented trigger field is not read by the route. Not selectable by any client. |
| Soundings | Two-word margin line, if offered | Never offered: 0 offers in 216 license evaluations across both vaults. `late` and `sustained` were **never simultaneously true**. `sustained` (Jaccard ≥ 0.15 over 3 turns) passed 3/147 times; `late` requires reaching mid-budget, and sittings that end at turn 1 never get there. Fixing the Jaccard gate alone would still yield zero. |
| Coach | Offer line on waiting page | Circular bootstrap: offers require un-coached DirectionRecords, which exist only after a prior offer. The one queue-based arm is dead by the file's own docstring. 63 evaluations, all `directions=0 qualified=0 offered=none`. Structurally cannot fire for a new user. |
| Expeditions | "Out in the world" heading | Eligibility requires ≥2 `asked` citations AND no episode-facet sibling in the whole session — one episode snippet vetoes the entire sitting's candidates. Never minted in 49 sittings. |
| Buds | None | `EndResponse.buds` reaches the client; nothing renders it. |
| Pieces | Library → compose | Reachable, but the only piece ever made was created mid-eval with five snippets from another persona's first sitting. |
| Facet balancing | N/A (internal) | Ran 24 times in shadow, correctly diagnosed the episode-starvation that makes the wiki read as inventory, printed the fix plan every time, `applied=false` every time. |
| Import | Nav item | Reachable and it works (three successful cycles in logs). Fragility: one unreadable subdirectory aborts the whole scan (`readdirSync` recursion, no try/catch) with a generic failure message naming no folder. |
| Anniversary / lineage / gap-fill / reach / still-true | Waiting page | Docket-auto; all evaluated repeatedly, all produced zero output in these runs (reach: `candidates=0` ×7; still-true: `minted 0` ×7; gap-fill skipped the same two snippets five runs straight). |

The pattern: every subsystem in the automatic loop (sitting → harvest → docket → queue → juxtaposition) ran. Every subsystem requiring an explicit door, a maturity threshold, or a licensing gate either has no door in the UI, a gate that cannot mathematically open, or a bootstrap cycle. A real user would experience Elicit as exactly five things: a question, a harvest screen, a wiki, a library, an import — and would never learn the other half of the product exists.

## 8. Mechanical artifacts a user saw

- Literal placeholder text in shipped questions: `"quiet at the" something`; a fragment printed twice, once orphaned; a quote cut mid-phrase ("If you cannot feel the"); an unbalanced parenthesis in an opener.
- `CLAIM_ID_PLACEHOLDER` / `CLAIM_ID_TO_BE_DETERMINED` emitted by the model into the claim pipeline (rejected, but retried and silently dropped — one retry lost "father" and "Sunday" from a correct first parse).
- Raw UI glyphs (`←`, `·`) rendered as agent turns in the DRM transcript.
- Duplicate sitting creation 92 ms apart (double-submit); empty sittings persisted as transcripts and then narrated in marginalia as events.
- Marginalia inferred a gender never stated ("her brother's death") and inverted possession ("Nnenna also has voicemails" from "Nnenna's too").
- 17–19 duplicate snippet bodies from the same pasted answer harvested five times — no duplicate detection at intake.
- One static wait label for the whole end-of-sitting harvest (ticket 039's turn-by-turn progress never built).

## 9. Eval-validity caveats

These findings are strong on mechanism (log-backed, code-confirmed) but the *conversational* findings come from a compromised run: sittings lasted seconds, most were single exchanges, modes had no observable effect, and four personas shared one vault. Three consequences:

1. The sounding/coach/expedition zeros are **structural** (gate math, bootstrap cycle, eligibility veto) and will survive a clean re-run.
2. The question-quality and no-ending findings will likely survive too, but deserve confirmation in real-length sittings.
3. The wiki-starvation numbers are partly an artifact of firing 10 sittings in 5 minutes — the docket never had wall-clock time. The *distortion* findings (negation drop, invented biography, bad merges) are independent of pacing and stand.

## 10. What to fix first (by user harm per unit work)

1. **Give sittings an ending.** One closing turn acknowledging what was kept. Smallest change, largest felt difference.
2. **Add a repair verb.** When a user says "that is not my story / I did not say that," the app must acknowledge, quarantine the source snippet from juxtaposition, and never harvest the correction as biography.
3. **Guard the juxtaposition matcher against function-phrase keys** ("the one who", "the quiet after") — require content-word overlap or entity agreement before a stored fragment can open a sitting.
4. **Unclip the sweep or make the backlog visible.** A wiki silently three sittings behind is indistinguishable from a wiki that ignored you.
5. **Wire the doors that already exist:** `navTo('drm')` from somewhere; a protocol control (the server-side rotation contradicts `run-protocol.md`); break the coach bootstrap cycle (seed a Direction from wiki claims directly); relax the expedition episode-veto to per-candidate.
6. **Re-derive the sounding gate from data.** `late` is the binding constraint, not Jaccard; both must be rethought against real sitting lengths.
7. **Harvest at thought boundaries, not sentence boundaries,** or merge adjacent fragments from the same turn — a 5-word median snippet cannot carry a memoir.
