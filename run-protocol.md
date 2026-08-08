# Run Protocol — Dossier Sitting Methodology
## Last revised: 2026-08-04 (post-Ilse, pre-Dara)

---

## Subsystem Trigger Map

| Subsystem | Trigger | How to exercise |
|-----------|---------|-----------------|
| sitting/session | POST /api/session | Default — every sitting |
| harvest | POST /api/session/:id/end | Default — end sitting |
| docket | Auto after harvest/boot | Default — runs in background |
| wiki/claims | Docket job | Default — accumulates |
| queue | Docket + composed | Default — auto-populated |
| bank questions | Mixed by randomizer | Default — auto-mixed |
| juxtaposition | Elicitor auto | Default — when archive has relevant material |
| **protocols** | POST /api/session `{protocol?}` (optional) | Default — server rotation on session count; explicit pick when `{protocol}` given (ticket 153) |
| **DRM** | POST /api/session/:id/drm/start | Explicit — during sitting |
| **coach** | GET /api/coach/waiting (needs 3+ claims/direction) | Needs vault maturity (5+ sittings) |
| **pieces** | POST /api/piece `{snippets:[...]}` | Explicit — needs snippets |
| **import** | POST /api/import/scan `{folder}` | Explicit — needs real text files |
| **expeditions** | Docket auto (eligible snippets) | Needs vault maturity |
| **anniversary** | Docket auto (dated snippets + calendar match) | Needs dated snippets from prior dates |
| **lineage mirror** | Docket auto | Needs usage patterns |
| **gap fill** | Docket auto | Needs KTG instrument data |
| **pattern dosing** | Auto-mixed into composed questions | Default when licensed |
| **reach** | Docket auto | Needs eligible calendar events |

---

## Sitting Plan Per Batch (target: exercise ALL triggerable subsystems)

### Early (1-3): Normal sittings, build archive
- Vary mode: (15/25/45 min) × (low/med/high) × (self/domain)
- Thread vocabulary for sounding attempts at t10+

### Mid (4-6): Trigger protocols + DRM
- Sitting 4: `target: 'domain'` — server rotates among the hard call (cdm), sort the kinds (concept-sorting), and how can you tell (laddered-grid) by session count
- Sitting 4 (alt): `POST /api/session` with `{protocol: 'cdm'}` — force the hard call (cdm) explicitly (ticket 153)
- Sitting 5-6: `POST /api/session/:id/drm/start` — test walk back through yesterday (drm) (or open the sitting with `{protocol: 'drm'}` to enter it directly)

### Late (7-10): Trigger coach + pieces
- Sit 5+: Check `GET /api/coach/waiting` — coach offer needs 3+ claims
- Sit 7+: `POST /api/piece` with 3+ snippet IDs — test piece composition

---

## Before Each Sitting
1. **Vary mode**: Rotate through configurations
2. **Know persona thresholds**: Ilse t8-12. Dara likely t10+.
3. **Know diachronic revision sitting**: Dara = s4 (ICU → hospice truth)
4. **Know canon contradictions and evasion triggers**
5. **Check what subsystems are still untriggered**

## During Sitting
1. Answer in persona voice
2. Push past sounding window (t10+ for 25-min)
3. Thread vocabulary for 3 consecutive turns when in sounding window
4. End when persona would end

## After Sitting
1. Harvest every 2 sittings
2. Eval diary entry
3. Check vault growth
4. Check subsystem coverage checklist

## Metric Axes (Q-87)
1. Constitution — invariant violations
2. Wiki truer — claims vs canon contradictions
3. Archive richer — snippet growth, canon coverage
4. Experience — trust progression, elaboration

## Five Dimensions
1. Questioning — thread-tracking, juxtapositions, dodges
2. Harvest — proposal quality, fragmentation
3. Wiki — claim-to-snippet ratio, accuracy
4. Descents — sounding offers, gate respect, Jaccard compatibility
5. Returns — cross-sitting callbacks, parked-thread resumes
