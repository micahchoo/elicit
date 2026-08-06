# Depth Eval Protocol — Three Runs
## Last revised: 2026-08-04
## Supersedes: `run-protocol.md` for depth-gated subsystems only

The prior eval was breadth-first (5 personas × 10 sittings, one vault) and found every gap
is depth-dependent: coach (needs 3+ claims/direction), expeditions (needs vault maturity +
docket cycling), wiki maturation (needs 20+ sittings), soundings (structural, needs its own
probe). This protocol is depth-first: one persona, one vault, 25 sittings, per-sitting
harvests — plus two focused diagnostics.

---

## Gap-to-Run Map

| Gap | Status | Why It Failed | What Reaches It |
|-----|--------|---------------|-----------------|
| Soundings | ❌ | `SUSTAINED_THRESHOLD=0.15` never crossed | Run B: diagnostic probe with crafted lexical looping |
| Coach | ❌ | 3 claims/direction never reached in 10 sittings | Run A: 25 sittings, per-sitting harvests |
| Expeditions | ❌ | Docket never found eligible snippet + model draft | Run A: vault maturity + docket cycling |
| Lineage mirror | ❓ | Unobserved docket-auto | Run A: docket cycling over mature vault |
| Gap fill | ❓ | Unobserved docket-auto | Run A: docket cycling over mature vault |
| Anniversary | ❓ | Unobserved docket-auto | Run A: docket cycling over mature vault |
| Wiki maturity | ⚠️ | 5-8 claims per 10-sitting batch | Run A: 20+ sittings, claims accumulate |
| Protocol format | ⚠️ | System prompt only, no visible markers | Run A: explicit protocol format testing |
| Cross-contamination | ❗ | Single vault, multiple personas | Run A: fresh vault, single persona |
| Session TTL expiry | ❗ | Batched harvests at dossier boundaries | Run A: per-sitting harvests |
| Import | ❌ | Permission error (runtime) | Run C: diagnose and fix, then test |

---

## Observation Paths

Every subsystem the eval needs to observe has a wired API endpoint:

| Subsystem | Endpoint | Returns |
|-----------|----------|---------|
| Coach offer | `GET /api/coach/waiting` | `{offer: {slug, name, sentence} \| null, lines: [...]}` |
| Queue state | `GET /api/queue` | `{pending: QueueEntry[], open: QueueEntry[]}` |
| Activity log | `GET /api/activity?since=<ISO>` | SSE stream or JSON snapshot of all events |
| Harvest queue | `GET /api/harvest-queue` | `{pending: [...]}` |
| Vault stats | `GET /v2/view` | Full vault snapshot (snippets, claims, queue, advice) |

Activity event kinds to watch:
- `sounding-license` — every turn's Jaccard evaluation (late, energy, sustained, unoffered, licensed)
- `expedition-minted` — docket created an expedition question
- `gap-fill-minted` — docket created a KTG gap-fill question
- `lineage-mirror-minted` — docket created a lineage mirror question
- `coach-offer` — coach license evaluation
- `coach-offer-declined` — declined direction (never re-asked)

Queue source types to watch in `GET /api/queue`:
- `source: 'expedition'` — expedition question
- `source: 'gap-fill'` — KTG territory gap fill
- `source: 'lineage-mirror'` — lineage mirror question
- `source: 'anniversary'` — anniversary framing
- `source: 'coach-reflection'` — coach reflection prompt

---

## Run A: Marathon Solo (Primary)

**Goal**: Exercise every depth-gated subsystem.

**Persona**: Tomas (reviser) — `eval/dossiers/004-tomas-reviser.md`
- Richest canon contradictions: Vidal exit story, storefront, refereeing
- Essayistic style → dense snippets (~14/sitting in prior eval)
- Prior eval combined him with Priya — clean run isolates his signal

**Vault**: Fresh — `./eval-vault-tomas/`. Stop server, swap `VAULT_ROOT`, restart between runs.

**Sittings**: 25. Mode rotation:

| Block | Sittings | Config | Focus |
|-------|----------|--------|-------|
| Build | 1–3 | 15-min, low → med | Natural growth, let Tomas's voice emerge |
| Build | 4–5 | 25-min, med | Diachronic revision at s4 (Vidal exit story). Thread vocabulary late (t10+). |
| Mid | 6–8 | 25-min, med | S6: DRM start. S7–8: Protocol format (`format:'protocol'`, `target:'domain'`). |
| Deepen | 9–15 | 25/45-min, med/high | Check coach after each sitting. Wiki should reach 6-9 claims. |
| Mature | 16–25 | 25-min, med | Docket cycles — watch for expeditions, gap fill, lineage mirror, anniversary |

### Per-Sitting Checklist

**Before:**
- [ ] Note sitting number and mode config
- [ ] Note subsystems still untriggered
- [ ] Know Tomas's diachronic revision at s4
- [ ] Know canon contradictions and evasion triggers from the dossier

**During:**
- [ ] Answer as Tomas — essayistic, self-revising, the dossier's voice
- [ ] Live the contradictions, do not perform them
- [ ] In 25-min sittings t10+, deliberately thread vocabulary for sounding attempts
- [ ] End when Tomas would end

**After:**
- [ ] End sitting → harvest runs automatically
- [ ] **Wait for docket** (it auto-runs after harvest — check activity log for docket completion)
- [ ] `GET /api/coach/waiting` → record `offer` status and `lines`
- [ ] `GET /api/queue` → scan for new source types: expedition, gap-fill, lineage-mirror, anniversary
- [ ] `GET /api/activity?since=<last-check-ISO>` → record new event kinds
- [ ] Record vault metrics: snippet count, claim count (`/v2/view`)
- [ ] Eval diary entry: sitting summary, subsystem delta, surprises

### Metric Axes (Q-87)

1. **Constitution** — invariant violations (expect 0)
2. **Wiki truer** — claims vs Tomas's canon contradictions:
   - Vidal exit story (c1)
   - Storefront (c2)
   - Refereeing (c3)
   All three should surface (prior eval got 3/3)
3. **Archive richer** — snippet growth curve, claim accumulation rate per sitting
4. **Experience** — trust progression through Tomas's revision pattern; self-correction frequency

### Five Dimensions

1. **Questioning** — thread-tracking, cross-sitting juxtapositions (clean vault = no cross-persona noise)
2. **Harvest** — per-sitting proposal quality; no session TTL expiry
3. **Wiki** — claim-to-sitting ratio, accuracy, contradiction surfacing rate
4. **Descents** — still expect 0 (structural); log every `sounding-license` for threshold evidence
5. **Returns** — cross-sitting callbacks, parked-thread resumes

### Success Criteria

- [ ] Coach offer fires (at least one direction with 3+ claims)
- [ ] At least one expedition minted
- [ ] Lineage mirror observed at least once
- [ ] Gap fill observed at least once
- [ ] Anniversary observed (if calendar-relevant snippets exist)
- [ ] Wiki claims ≥ 12 across ≥ 3 directions
- [ ] Protocol format visible in sitting UI (explicit markers beyond system prompt)
- [ ] 0 invariant violations

---

## Run B: Sounding Diagnostic (Separate)

> **MOOT (2026-08-06).** Run A's sitting-10 continuation answered this
> run's question: under ticket 142's license (threshold 0.10, `late =
> questionCount >= 9`) the offer FIRED at question 9 with threaded
> vocabulary, and `sustained` crossed on natural turns twice before any
> deliberate threading. The barrier was sitting length, not the
> threshold. `sounding-license` lines now log the numeric
> `sustainedValue`, so future tuning reads real Jaccard values instead
> of running a dedicated probe persona. Spend this run's budget on
> long sittings (9+ questions) instead.

**Goal**: Determine whether `SUSTAINED_THRESHOLD = 0.15` is reachable by any interaction pattern.

Run AFTER Run A, because Run A's `sounding-license` data from 25 sittings provides empirical
Jaccard values from real conversation — the baseline against which the diagnostic is measured.

**Persona**: Nadia (looper) — new dossier (create at `eval/dossiers/006-nadia-looper.md`)
- Woodworker describing shop tools and techniques in obsessive, lexically-overlapping detail
- Designed to maximize adjacent-turn content-word overlap: same concrete nouns recur
- Speech register: technical, precise, returns to physical objects constantly

**Vault**: Fresh — `./eval-vault-nadia/`

**Structure**: 3 sittings × 10 turns, 25-min, med energy

**Protocol**:
- **Sitting 1**: Answer naturally. Let the model lead. No deliberate threading.
- **Sitting 2**: After each answer, deliberately reuse 2-3 concrete nouns from the prior
  answer. "The walnut I mentioned — the walnut has a grain that..."
- **Sitting 3**: Same as s2, plus decline any non-sustained-thread questions with redirects
  back to the workshop: "That's not what I was talking about. The lathe, right — the lathe..."

**After each turn**: `GET /api/activity?since=<last-ISO>` → extract `sounding-license` events.
Record: `late`, `energy`, `sustained` (boolean), `licensed`. Compute actual mean adjacent
Jaccard from the `sustained` field.

**Success criterion**:
- If `sustained: true` is NEVER observed even with deliberate lexical looping:
  threshold confirmed structural → lower it or replace the mechanism.
- If `sustained: true` IS observed: document the pattern that crosses it
  (mean content words per turn, lexical overlap pattern, sitting depth when it fired).

---

## Run C: Import Diagnostic (Quick)

**Goal**: Fix the runtime permission error and exercise the import subsystem.

**Steps**:
1. Reproduce the permission error from the prior eval
2. Diagnose and fix (likely filesystem path or Node permissions)
3. Create `./eval-import-test/` with 3-5 real text files (varied: plain text, markdown, dated entries)
4. `POST /api/import/scan { folder: './eval-import-test/' }` — verify region scanning works
5. Verify import review UI: scan results, rule assignment, commit
6. Verify repair UI: edit committed import snippets
7. Single sitting with imported material — verify question composition from imports

**Success criteria**:
- [ ] Import scan completes without permission error
- [ ] Import review UI renders correctly
- [ ] Snippets are minted from import
- [ ] Repair works on imported snippets

---

## Execution Order

1. **Run C** first — fastest, unblocks the import gap
2. **Run A** primary — 25 sittings, expect multiple sessions over days
3. **Run B** diagnostic — after Run A's `sounding-license` baseline is in hand

### Between Runs

- Stop server, swap `VAULT_ROOT` to the next eval vault directory
- Each run gets a clean vault — no cross-contamination
- Keep the prior eval's archives for reference but don't reuse the vault

---

## Diary Format

Use the same `eval-diary.md` but append a new section for this depth eval:

```
## Depth Eval — 2026-08-04
### Run C: Import
### Run A: Tomas Marathon
#### Sitting N
...
### Run B: Sounding Diagnostic
```
