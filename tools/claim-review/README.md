# Claim review — ticket 085

An error-discovery pass over the Clerk's first real claim graph. You read
claims one at a time. You write what is wrong with them, in your own words.

The server runs now. Open this:

**http://127.0.0.1:8787**

## What to do

Each screen shows one claim.

- The framed grey sentence at the top is the Clerk's. A machine wrote it.
- The **Range** is beside it, in the same frame. The Range is the scope the
  Clerk gave the sentence.
- Below it, in dark serif, are the person's own words — the snippet the claim
  cites, in full. Above the words is the question the person was asked, if
  anybody asked one. Below is their surrounding prose, if the vault kept it.

Read the grey sentence against the dark words. Write anything that is wrong,
off, or thin in the note box. Use your own words. Do not pick a category —
there is no category list, and that is deliberate.

Some things worth saying out loud, if you see them: the Range is too broad or
too narrow. The reading overreaches the quote. The claim splits one thought,
or fuses two. The sentence is true but says nothing. The person never said
this. Say it however it comes to you.

Skip freely. A claim you have no opinion about is not a failure. Skips are
recorded, so a skipped claim does not come back at you on the next pass.

## Keys

| Key | Effect |
| --- | --- |
| `Enter` | Save the note and go to the next claim |
| `Shift+Enter` | New line inside the note |
| `Esc` | Skip and go to the next claim |

`Enter` on an empty box is a skip. The **back** button returns to the last
claim if you change your mind.

## The order

The first 40 claims are a diverse sample. They come from 10 clusters, built
from facet and Range wording, with no model calls. Two thirds are cluster
representatives, taken one per cluster in turn. One third is random, because
the clustering only knows facet and Range, and the failure may not vary along
either.

Review those 40 first. The other 104 follow in the same window if you keep
going. The progress line in the top bar says which stretch you are in.

The app resumes. If you close the tab, the next visit opens at the first claim
you have not seen.

## Where the notes land

`tools/claim-review/notes.jsonl` — one JSON object per line, appended, never
rewritten:

```json
{"claim":"01KZ...","note":"the range covers her whole career, the quote is one afternoon","skipped":false,"position":3,"at":"2026-08-02T22:40:11.004Z"}
```

Your text is the only ground truth in this loop. The open-coding pass happens
later, from this file: an agent reads the notes, groups them into failure
modes, and counts them. The taxonomy comes out of what you wrote. Nothing
pre-supposes what the modes are.

## Files

| File | What it is |
| --- | --- |
| `export-dataset.ts` | Reads the vault, writes `dataset.json`. Read-only on the vault. |
| `dataset.json` | 144 composite records, in review order. Regenerable. |
| `server.py` | Python stdlib server. No dependencies. Loopback only. |
| `app.html` | The review app. One file, no dependencies. |
| `notes.jsonl` | Your notes. The output of the session. |
| `server.log` | Server output. |

## Running it again

Restart the server:

```
python3 tools/claim-review/server.py
```

Rebuild the dataset after the vault changes:

```
npx tsx tools/claim-review/export-dataset.ts
```

The export prints the claim count, the cluster sizes, and any citation that
does not resolve. The last run resolved all 144 claims and reported no
dangling citations.
