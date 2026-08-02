# Question Bank Curation Report

**Generated:** 2026-08-01  
**Source:** `data/question-bank.jsonl`  
**Status:** READ-ONLY analysis — no edits to source files

---

## Headline Counts

| Metric | Count |
|---|---|
| Total entries | 4,308 |
| Unique channels | 79 |
| Duplicate blockId groups | 160 groups, 2,057 extra entries |
| Exact duplicate question groups | 2 groups, 13 extra entries |
| Near-duplicate pairs (Jaccard > 0.8) | 104 |
| Multi-question strings | 428 (9.9%) |
| Yes/no forms | 365 (8.5%) |
| Open, second-person (good stock) | 2,137 (49.6%) |
| Entries with leading junk (`#`, `>`, `*`, `####N.`) | 81 |

No empty provenance fields — every entry has `channel`, `channelTitle`, and `blockId`. No parse errors. No empty questions.

---

## 1. Shape Audit

**Schema:** `{ question, channel, channelTitle, blockId }`. Four fields, all present on every entry.

**Provenance completeness:** 100%. Every question traces to an are.na channel and block. No gap on paper — but provenance is only as useful as the channels it names. See §3 for the channel quality problem.

**Duplicate blockIds:** 160 blockIds appear 2+ times (2,057 total duplicate entries). This is the bank's single largest data-quality problem. It means 47.8% of entries share a blockId with another entry — mostly from channels where one block contained multiple questions (the harvester sometimes produces one block per question, sometimes one block for a batch, creating shared blockIds). Not all are true duplicates — many are genuinely different questions from the same source block — but the shared provenance means you cannot trace a Snippet back to a unique block.

**Channel concentration:** The top 5 channels account for 65.7% of all entries:

| Channel | Count | % |
|---|---|---|
| `questions-jjvu2vblo5k` | 1,335 | 31.0% |
| `asking-the-right-questions-sbkcnb9eank` | 906 | 21.0% |
| `questions-to-date-yourself-to` | 207 | 4.8% |
| `questions-for-meaningful-introductions` | 198 | 4.6% |
| `questions-1e3m_zldn-e` | 187 | 4.3% |

---

## 2. Near-Duplicates

**Exact duplicates (normalized):** Only 2 groups, remarkably clean.

- `"кто эти люди, проходящие стены, и что мы должны им?"` — 13 copies (Russian), spread across lines 2194, 3733–3744
- `"where are you going?"` — 2 copies (lines 903, 1267)

**Near-duplicates (token Jaccard > 0.8):** 104 pairs. Most are same-source variants — one entry has `####N.` prefix, another doesn't; one has an extra clause. These come from the same are.na block being harvested slightly differently (with/without markdown heading prefixes).

Top examples:
```
[1.00] "where are you going?" ↔ "where are you going ?"
[0.94] "Is there something that you've dreamed of doing for a long time? Why haven't you done it?" ↔ same, with extra space
[0.93] "What old stories or false identities have you outgrown on the path toward greater wholeness?" ↔ "...toward wholeness?"
[0.92] "What would you like to have next year that you lacked this year?" ↔ "####6. What would you like..."
```

**Curation implication:** The `####N.` prefixed entries (from a year-end reflection prompt set) are the largest near-dupe cluster. ~15–20 pairs are genuine variant duplicates that should collapse to one; the rest are prefix-noise from the harvester.

---

## 3. Length + Form Distribution

### Word count

| Range | Count | % |
|---|---|---|
| 1–3 | 89 | 2.1% |
| 4–7 | 1,170 | 27.2% |
| 8–12 | 1,816 | 42.2% |
| 13–20 | 991 | 23.0% |
| 21–40 | 217 | 5.0% |
| 41+ | 25 | 0.6% |

The sweet spot for transformative openers (5–12 words) holds 68% of the bank. Good. The long tail (40+ words) is mostly thesis-level research questions that aren't usable as elicitation openers.

### Multi-question strings (428 entries, 9.9%)

These are the weakest elicitors. A question with 2+ asks dilutes the response — the answerer picks one, the agent can't tell which was answered, and the Snippet's Provenance is ambiguous. Examples:

- `"what's a hobby that you quit? why?"` (two asks, the "why" is unframed)
- `"what is the most thoughtful gift you have given? received?"` (two distinct domains)
- `"who have you copied? who copies you?"` (contrast question — valid form but should be split)
- `"What are you putting out into the world, and who is receiving it? What is getting communicated?"` (three asks)
- `"Why are we always so busy? Why do we feel the constant need to be productive? What does being productive mean to us? How does this particular feeling of responsibility affect our bodies and our minds?"` (four asks — a Sounding, not an opener)

**Verdict:** Split these during curation. Each clause becomes its own entry with distinct blockId. The "why?" and "how?" trailers are the most common pattern.

### Yes/no forms (365 entries, 8.5%)

Questions starting with auxiliary verbs (`have you ever`, `is there`, `are you`, `do you`, `can you`) without a wh-word. These produce binary answers that the elicitor then has to chase — the initial response is low-signal. Examples:

- `"have you ever lied to protect someone else's feelings?"` — binary entry point
- `"Is there anything you couldn't forgive someone for doing?"` — invites "yes/no" before substance
- `"Are we tricked by our tools?"` — abstract, invites opinion, not episode
- `"Would it be easier if you had help?"` — leading

**Verdict:** Most should be rewritten as open forms (`"Tell me about a time you lied to protect someone's feelings"`), or demoted to Sounding probes. The "have you ever" pattern (most common subtype) can be saved by adding "tell me about" before it.

### Non-question entries

~10–15 entries are statements, not questions. Examples:
- `"Allow space for emotions to be expressed, and notice when you get emotional. Ask yourself, what are your emotions teaching you?"` — instructional prose
- `"MBA PI Questions: Why MBA?"` — heading, not a question
- `"But maybe, it's not?"` — conversational fragment
- `"the field?"` — fragment

These need deletion or rewriting during curation.

### Leading junk (81 entries)

Entries with markdown prefixes (`#`, `>`, `*`, `####N.`) from source formatting. These are harvest artifacts — the `####18.` style entries are from a year-end reflection prompt set (the "52 Questions" deck). The prefix interferes with token matching and display.

**Verdict:** Strip during curation.

---

## 4. Theme Sketch

Keyword-clustered into 15 rough buckets. These are a starting cut for deck organization, not a taxonomy. Many questions belong to multiple buckets.

| Theme | Count | Sample |
|---|---|---|
| Relationships & Connection | 697 | "how did you meet your best friend?" |
| Time & Change | 585 | "what's something you've put on hold?" |
| Creativity & Expression | 468 | "what is the saddest song you know?" |
| Identity & Self-Knowledge | 426 | "where do you go to be yourself?" |
| Values & Beliefs | 325 | "what do you wish were true?" |
| Success & Failure | 265 | "what never fails to make your day better?" |
| Truth & Lies | 257 | "what was the last thing you lied about?" |
| Happiness & Wellbeing | 247 | "what emotions have you been holding back?" |
| Body & Physicality | 139 | "what's a guilty pleasure of yours?" |
| Childhood & Origin | 115 | "what do you remember about your childhood home?" |
| Death & Loss | 104 | "what's the closest you've been to death?" |
| Choice & Agency | 88 | "if you could undo one choice you've made what would it be?" |
| Regret & Mistakes | 79 | "who is someone you regret forgiving?" |
| Fear & Vulnerability | 79 | "what are you worried you'll fuck up?" |
| Memory & Nostalgia | 64 | "if you could live in any memory, which would it be?" |

**Curation implication:** "Relationships & Connection" is the largest cluster — too large for one deck. Split into sub-decks (Family, Friendship, Romantic, Community). "Death & Loss" and "Fear & Vulnerability" are small but high-signal — keep as tight, focused decks.

---

## 5. Top 30 Transformative Openers

Scored on: open (not yes/no), second-person, concrete anchor (superlative or temporal), singular ask, good word count (5–12). Score is a heuristic rank, not quality.

| # | Line | Question | Score |
|---|---|---|---|
| 1 | 3616 | What was your last pinch me moment? | 9 |
| 2 | 21 | when was the last time someone disappointed you and what happened? | 8 |
| 3 | 29 | when was the last time you disappointed someone? | 8 |
| 4 | 70 | when you have good news who is the first person you tell? | 8 |
| 5 | 217 | When was the last time you did something you regret? | 8 |
| 6 | 399 | when was the last time you cried? | 8 |
| 7 | 566 | When was the last time you let someone else take control? | 8 |
| 8 | 604 | When was the last time you were obsessed with something? | 8 |
| 9 | 606 | When was the last time you said something you wish you didn't? | 8 |
| 10 | 1301 | When was the last time you felt out of place? | 8 |
| 11 | 1326 | when was the last time you were wrong? | 8 |
| 12 | 1465 | whats the first lie you remember telling? | 8 |
| 13 | 1619 | When was the last time you experienced something for the first time? | 8 |
| 14 | 2389 | When was the last time you did something for the first time? | 8 |
| 15 | 2415 | When was the last time you were really proud of yourself? | 8 |
| 16 | 3535 | When was the last time you totally lost it? | 8 |
| 17 | 3614 | When was the last time someone caught you off guard? | 8 |
| 18 | 3 | what album are you resonating with most right now? | 7 |
| 19 | 4 | what do you get complimented on the most? | 7 |
| 20 | 5 | what is the most sincere compliment you've received? | 7 |
| 21 | 6 | what is the most hurtful insult you've been given? | 7 |
| 22 | 7 | how did you meet your best friend? | 7 |
| 23 | 20 | what were you thinking about last night before bed? | 7 |
| 24 | 22 | what's the most sentimental object in your possession? | 7 |
| 25 | 23 | who's opinion matters most to you? | 7 |
| 26 | 30 | what do you fear most about aging, if anything? | 7 |
| 27 | 38 | what is the worst way you've coped with a heartbreak? | 7 |
| 28 | 44 | who have you been talking to the most? | 7 |
| 29 | 46 | what's the worst habit you've quit? | 7 |
| 30 | 47 | what was the last thing you lied about? | 7 |

---

## 3 Biggest Curation Problems

1. **Duplicate blockIds (2,057 entries).** Nearly half the bank shares a blockId with another entry — not because the questions are identical, but because the harvester assigned one blockId to multiple distinct questions from the same source. This breaks the Provenance contract: a Snippet's eliciting question should trace to a unique are.na block. Fix: assign synthetic sub-IDs during curation (e.g., `blockId:17850311.1`, `.2`, …) so each question has a unique provenance key.

2. **Multi-question strings (428 entries).** One entry carrying 2–4 asks dilutes elicitation. The answerer picks one, the agent can't tell which, and the Snippet's Question-Form is ambiguous. Fix: split each clause into its own entry during curation. The "why?" trailer pattern alone covers ~40% of these.

3. **Yes/no bulk (365 entries) plus leading junk (81 entries).** Together these are 446 entries (~10%) that need transformation before they can serve as Randomizer openers. Yes/no forms gate the response behind a binary; leading junk (`####N.`, `#`, `>`) is harvest noise. Fix: rewrite yes/no as open forms; strip prefixes. The "have you ever…" subtype (the majority) converts cleanly to "Tell me about a time you…".
