/**
 * Ingest Micah's published writing as dated sittings (ticket 057).
 *
 * Nine years of posts, one sitting per post, `started` set to when the prose
 * was written. That dating is the whole point: Q-50 makes cite independence
 * CROSS-SITTING, so a blob ingest would make nine years one piece of evidence
 * and nothing drawn from it could ever reach `evidenced`.
 *
 * Runs the real harvest path — the 044 admissibility gate and the exact-
 * substring check both apply, unchanged. This material gets no exemption.
 *
 *   npx tsx scripts/ingest-posts.ts --dry     write the review file, touch nothing
 *   npx tsx scripts/ingest-posts.ts --apply   write the reviewed decisions to the vault
 *
 * --dry is not optional before --apply. The vault has no backup.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { propose } from '../src/harvester/harvester.js';
import { createVault } from '../src/vault/vault.js';
import { makeComplete } from '../src/llm.js';
import { clean, dropCitedParagraphs, toTurns } from '../src/import/body.js';
import { isQuotedFromSource, quotedSpans } from '../src/harvester/admissibility.js';
import { EXCLUDED, MANIFEST, type Select } from '../src/import/prior-ingest.js';

const POSTS = '/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts';
const REVIEW = 'docs/ingest-review-2026-08-02.md';
const VAULT_ROOT = process.env['ELICIT_VAULT'] ?? 'vault';

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

/** Body between the named heading boundaries. */
function selectBody(body: string, sel: Extract<Select, { kind: 'body' }>): string {
  const lines = body.split('\n');
  const isHeading = (l: string) => /^#{1,6}\s/.test(l);
  const headingText = (l: string) => l.replace(/^#+\s*/, '').trim();

  const out: string[] = [];
  let dropping = false;
  let dropDepth = 0;

  for (const line of lines) {
    if (isHeading(line)) {
      const depth = (line.match(/^#+/) ?? ['#'])[0].length;
      const text = headingText(line);
      if (sel.keepUntil && text === sel.keepUntil) break;
      if (dropping && depth <= dropDepth) dropping = false;
      if (sel.dropSections?.includes(text)) { dropping = true; dropDepth = depth; continue; }
    }
    if (!dropping) out.push(line);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Apply — writes the REVIEWED decisions, and calls no model
// ---------------------------------------------------------------------------

/**
 * Micah's marks on `docs/ingest-triage-2026-08-02.md`, confirmed 2026-08-02.
 * Cut numbers are 1-based against `docs/ingest-review-2026-08-02.md`, whose
 * numbering is frozen: apply reads that file rather than re-running the model,
 * so the numbers here and the text there are one artifact.
 *
 * 139 of 295. Everything absent was dropped as `world` / `log` / `scaffold` /
 * `frag` / `spec` / `theirs`, or excluded under Q-51 as another person's words
 * (163 a quoted message, 170 Shreyas, 173 Sara Ahmed, 197-200 Annemarie Mol).
 */
const TRIAGE_KEEP: Record<string, number[]> = {
  'blog/carefull-collectives-and-their-care-practices': [
    1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 14, 35, 36, 37, 42, 43, 45, 46, 47, 51, 54,
    55, 56, 57, 60, 61, 62, 63, 65, 67, 71, 72, 73, 74, 75, 76, 93, 100, 101,
    102, 103, 104, 105, 109, 119, 122, 135, 139, 140, 154, 157, 158, 159, 161,
    162, 164, 165, 167, 171, 172, 175, 176, 177, 178, 179, 181, 182, 183, 184,
    185, 188, 191, 192, 193, 195, 196,
  ],
  'blog/the-disenfranchisement-of-adivasis-in-kerala': [1, 2, 3, 4, 5],
  'blog/how-i-use-speculative-design-in-my-practice': [1, 2, 3],
  'blog/koramangala': [1, 2],
  'blog/establishing-a-community-based-generative-wifi-mesh-network': [1],
  'counter-design': [4, 5, 6, 8, 9, 10, 11, 12, 13, 14],
  archie: [1, 2, 3, 4, 5, 6, 7, 10, 13],
  'commonplace-a-notebook-for-the-internet': [1, 2, 3, 4, 9, 10],
  'blog/iiif-images': [1, 2, 3, 5, 6, 8, 9, 10, 11, 12],
  papad: [7, 8, 9, 10, 11],
  'blog/checklist-for-selecting-tools-for-indian-collectives': [1, 2],
  'glitch-art': [1],
  'kishori-film-festival': [2, 3, 4],
  milli: [1],
  'enableindia-le': [1],
  'habba-redesign': [1],
  'blog/mapping-history-of-cinema': [1],
  'speculative-storytelling-in-wayanad': [1],
  'external/wikipedia-editathon-dalit-history-month': [1],
};

/** `## <slug>` … `N. <text>` out of the frozen review file. */
function readReview(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let slug = '';
  for (const line of readFileSync(REVIEW, 'utf-8').split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { slug = (h[1] as string).trim(); continue; }
    const c = /^(\d+)\. (.+)$/.exec(line);
    if (c && out.has(slug)) out.get(slug)!.push((c[2] as string).trim());
    else if (c) out.set(slug, [(c[2] as string).trim()]);
  }
  return out;
}

function runApply(): void {
  const review = readReview();
  const vault = createVault(VAULT_ROOT);

  let snippets = 0, sittings = 0, skipped = 0;

  for (const post of MANIFEST) {
    const keep = TRIAGE_KEEP[post.slug];
    const cuts = review.get(post.slug);
    if (!keep || !cuts) { console.error(`NO TRIAGE for ${post.slug}`); process.exitCode = 1; continue; }

    const file = join(POSTS, post.slug, 'index.md');
    const raw = readFileSync(file, 'utf-8');
    const spans = quotedSpans(raw);

    const session = `post-${post.slug.replace(/\//g, '-')}`;
    if (existsSync(join(VAULT_ROOT, 'transcripts', `${session}.md`))) {
      console.error(`  skip ${post.slug} — already imported`);
      skipped++;
      continue;
    }

    // Q-51 and the 058 acceptance criterion, checked against the SOURCE FILE
    // and never against the review — the review is what the importer wrote,
    // and an importer that verifies its own output verifies nothing.
    const chosen: string[] = [];
    let bad = 0;
    for (const n of keep) {
      const text = cuts[n - 1];
      if (text === undefined) { console.error(`  ${post.slug} #${n}: no such cut`); bad++; continue; }
      if (!raw.includes(text)) { console.error(`  ${post.slug} #${n}: NOT A SUBSTRING of source`); bad++; continue; }
      if (isQuotedFromSource(text, spans)) { console.error(`  ${post.slug} #${n}: quoted — Q-51`); bad++; continue; }
      chosen.push(text);
    }
    // A post with any failed cut is written NOT AT ALL. Partial import would
    // leave a sitting whose transcript claims more than its snippets carry,
    // and the failure is a bug in this script rather than in the material.
    if (bad > 0) { console.error(`  ${post.slug}: ${bad} bad cut(s) — post NOT imported`); process.exitCode = 1; continue; }

    // The transcript is the lineage plane: the prose exactly as it was fed to
    // the harvester, so a cut's context is recoverable. Rebuilt, not invented.
    const body = matter(raw).content;
    const text = post.select.kind === 'passages'
      ? post.select.passages.join('\n\n')
      : dropCitedParagraphs(clean(selectBody(body, post.select), post.keepQuotes ?? false)).kept;

    // No Target (Q-60): a folder is heterogeneous and a wrong Target is
    // permanent under Q-55, while an absent one serves either sitting.
    vault.startTranscript(session, {
      mode: { minutes: 0, energy: 'medium' },
      protocol: 'import',
      started: `${post.sitting}T00:00:00.000Z`,
    });
    for (const turn of toTurns(text, `${post.sitting}T00:00:00.000Z`)) {
      vault.appendTurn(session, turn);
    }
    sittings++;

    for (const prose of chosen) {
      // 'unprompted' is exact: nothing was asked for these words. `channel:
      // 'pasted'` is ticket 048's field — Sole Authorship guarantees no agent
      // reworded this, not that Micah composed it here and now.
      vault.saveSnippet(prose, {
        kind: 'unprompted',
        session,
        question: '',
        questionForm: 'deliberative',
        channel: 'pasted',
      });
      snippets++;
    }
    console.error(`  ${post.slug} — ${chosen.length} snippets, sitting ${post.sitting}`);
  }

  console.error(`\n${snippets} snippets across ${sittings} dated sittings${skipped ? `, ${skipped} already present` : ''}.`);
  console.error('No Readings written: the dry run recorded cut TEXT only, so facet, stance');
  console.error('and reading are not recoverable without the model. Snippets are evidence and');
  console.error('feed resonance; Claims need a reading pass (Q-28).');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--dry')) {
  console.error('Pass --dry or --apply. --dry first; the vault has no backup.');
  process.exit(2);
}
if (apply) {
  runApply();
  process.exit(process.exitCode ?? 0);
}

const complete = makeComplete('clerk');
const lines: string[] = [
  '# Ingest review — published writing, 2017-2026',
  '',
  'Generated by `scripts/ingest-posts.ts --dry`. Nothing has been written to the vault.',
  '',
  'Every cut below was produced by the REAL harvest path against the clerk model,',
  'so the 044 admissibility gate and the exact-substring check have already run.',
  'Frontmatter is excluded everywhere — Micah ruled it is not his prose.',
  '',
];

let totalCuts = 0, totalBuds = 0, totalTurns = 0, totalQuotedOut = 0;
const t0 = Date.now();

for (const post of MANIFEST) {
  const file = join(POSTS, post.slug, 'index.md');
  if (!existsSync(file)) { console.error(`MISSING ${post.slug}`); continue; }

  const raw = readFileSync(file, 'utf-8');
  const body = matter(raw).content;

  let text: string;
  let citedDropped = 0;
  if (post.select.kind === 'passages') {
    // Verify each passage is really in the source before it becomes a turn.
    const missing = post.select.passages.filter((p) => !raw.includes(p));
    if (missing.length > 0) {
      console.error(`QUOTE MISMATCH in ${post.slug}:`);
      for (const m of missing) console.error(`   ${m.slice(0, 70)}`);
      process.exitCode = 1;
      continue;
    }
    text = post.select.passages.join('\n\n');
  } else {
    const selected = selectBody(body, post.select);
    const cleaned = clean(selected, post.keepQuotes ?? false);
    const r = dropCitedParagraphs(cleaned);
    text = r.kept; citedDropped = r.dropped;
  }

  const turns = toTurns(text, `${post.sitting}T00:00:00.000Z`);
  totalTurns += turns.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  process.stderr.write(`${post.slug} — ${words}w, ${turns.length} turns … `);

  // Session id is slug-derived, not a ulid: stable, so a re-run is idempotent
  // and never mints a second sitting for the same post.
  const session = `post-${post.slug.replace(/\//g, '-')}`;
  const result = await propose(session, turns, complete);

  // Q-51 at cut level. Read against the RAW file, not the selected text: a
  // quotation's opening mark can sit in a paragraph that selection dropped,
  // and a cut lifted from inside it would then look unquoted.
  const spans = quotedSpans(raw);
  const admissible = result.proposals.filter((p) => !isQuotedFromSource(p.text, spans));
  const quotedOut = result.proposals.length - admissible.length;
  if (quotedOut > 0) {
    for (const p of result.proposals) {
      if (isQuotedFromSource(p.text, spans)) {
        process.stderr.write(`\n  Q-51 cut-level: dropped quoted — "${p.text.slice(0, 70)}"`);
      }
    }
  }

  totalCuts += admissible.length;
  totalQuotedOut += quotedOut;
  totalBuds += result.buds.length;
  process.stderr.write(`${admissible.length} cuts${quotedOut ? ` (${quotedOut} quoted, dropped)` : ''}, ${result.buds.length} buds\n`);

  lines.push(`## ${post.slug}`, '');
  lines.push(`- **sitting:** ${post.sitting}${post.dateNote ? ` — ${post.dateNote}` : ''}`);
  lines.push(`- **selection:** ${post.select.kind}${citedDropped ? `, ${citedDropped} cited paragraphs dropped` : ''}`);
  lines.push(`- **why kept:** ${post.why}`, '');
  lines.push(`- **cut-level Q-51:** ${quotedOut} quoted cut${quotedOut === 1 ? '' : 's'} dropped`);
  lines.push(`### proposed cuts (${admissible.length})`, '');
  for (const [i, p] of admissible.entries()) {
    lines.push(`${i + 1}. ${p.text}`);
  }
  if (result.buds.length > 0) {
    lines.push('', `### buds (${result.buds.length})`, '');
    for (const b of result.buds) lines.push(`- ${b.fragment}`);
  }
  lines.push('');
}

lines.push('## Excluded, and why', '');
for (const e of EXCLUDED) lines.push(`- **${e.slug}** — ${e.why}`);
lines.push('');
lines.push(`## Totals`, '');
lines.push(`- ${MANIFEST.length} posts kept, ${EXCLUDED.length} exclusion groups`);
lines.push(`- ${totalTurns} turns, ${totalCuts} proposed cuts, ${totalBuds} buds`);
lines.push(`- ${totalQuotedOut} cuts dropped at cut level as quotations (Q-51)`);
lines.push(`- ${Math.round((Date.now() - t0) / 1000)}s of model time`);

if (!existsSync('docs')) mkdirSync('docs', { recursive: true });
writeFileSync(REVIEW, lines.join('\n'), 'utf-8');
console.error(`\nReview written to ${REVIEW}`);
console.error(`${totalCuts} cuts, ${totalBuds} buds, ${Math.round((Date.now() - t0) / 1000)}s. Vault untouched.`);
