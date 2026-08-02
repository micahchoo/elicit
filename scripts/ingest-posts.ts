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

const POSTS = '/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts';
const REVIEW = 'docs/ingest-review-2026-08-02.md';
const VAULT_ROOT = process.env['ELICIT_VAULT'] ?? 'vault';

// ---------------------------------------------------------------------------
// The manifest — every keep/discard call, with the reason kept next to it
// ---------------------------------------------------------------------------

type Select =
  /** Whole body, minus the named headings' sections. */
  | { kind: 'body'; dropSections?: string[]; keepUntil?: string }
  /** Only these exact passages. Each is verified as a substring before use. */
  | { kind: 'passages'; passages: string[] };

type Post = {
  slug: string;
  /** The sitting date. Not always frontmatter `date` — see `dateNote`. */
  sitting: string;
  dateNote?: string;
  select: Select;
  /** Why this is in, in my words, so a later reader can disagree with me. */
  why: string;
  /** Keep blockquotes? Default false — they are other people's words. */
  keepQuotes?: boolean;
};

const MANIFEST: Post[] = [
  {
    slug: 'blog/carefull-collectives-and-their-care-practices',
    sitting: '2020-03-01',
    select: {
      kind: 'body',
      // The framing chapters are a literature review wearing his voice, and
      // three of the quotations in them carry no quote marks at all.
      dropSections: [
        'Caring in Networks: Reflections on Archetypes and Axioms of Collaborative Practice',
        'Acknowledgements',
        'Preface',
        'Understanding how networks come together',
        'Archetypes',
        'Bibliography',
      ],
    },
    why: 'The episodic middle — Methodology, Do-ings and Be-ings, the Axioms — is unambiguously his and unambiguously about how he works. It also holds both halves of a contradiction on one page: he argues for the fragile voluntary mode, records his own disbelief in it, and then burns out of it.',
  },
  {
    slug: 'blog/the-disenfranchisement-of-adivasis-in-kerala',
    sitting: '2018-09-01',
    select: {
      kind: 'passages',
      passages: [
        'It was then that I decided (very naively) that I would design better systems for them to inhabit.',
        'By this point in my research, I was starting to see the kind of bubbles that I was living in. I also gained perspective on how the invisibility of caste is its biggest barrier to annihilation.',
        'After reading the histories of the Paniyas, I understood that my assumptions about designing solutions for them were presumptuous and naive.',
        'I understand now that the trap lies in the hero-worship that design engages.',
      ],
    },
    why: 'Four passages record a dated, documented belief change about design\'s competence. The other 90% is other people\'s research restated, and three of its blockquotes are in other people\'s first person — a manual scavenger, Siddharth Kara, Mahasweta Devi — which would pass any "is this first person?" test.',
  },
  {
    slug: 'blog/how-i-use-speculative-design-in-my-practice',
    sitting: '2022-01-01',
    select: {
      kind: 'passages',
      passages: [
        'In my work as a design researcher, I use speculative design to envision alternatives for the Global South.',
        'The point was to listen to what people there already wanted, not to speak for them.',
        'Reconfiguring a cheap, hackable device like a Raspberry Pi is itself the lesson: the tool is yours to open and change.',
      ],
    },
    why: 'Three crisp statements of method and refusal. The rest is a portfolio index pointing at other posts, and its opening restates the same hauntology argument as the capstone — ingesting both would look like corroboration when it is repetition.',
  },
  {
    slug: 'blog/koramangala',
    sitting: '2021-01-01',
    keepQuotes: true, // the blockquote is him quoting his own poem
    select: {
      kind: 'passages',
      passages: [
        'Chalapathi, I know his name, because I pay him every two months on Google Pay',
        "I can't seem to remember the names of anyone else because I pay them cash",
      ],
    },
    why: 'Two lines do more belief-work about labour, visibility and money than several pages of the capstone\'s theory — and arrive at the capstone\'s invisible-maintenance idea with no theory at all. The blockquote rule is overridden here because he is quoting himself.',
  },
  {
    slug: 'blog/establishing-a-community-based-generative-wifi-mesh-network',
    sitting: '2022-01-01',
    select: {
      kind: 'passages',
      passages: [
        'I wanted to see the kind of network effects that a community mesh needs to thrive as an infrastructure of the place.',
        'Should this be quantified? Why or why not?',
      ],
    },
    why: 'Kept ONLY to preserve the other pole of a real contradiction. The 2020 capstone attacks quantified incentive; this 2022 document builds an incentive apparatus, while holding the question open. Ingest one without the other and the model is confidently wrong about where he stands.',
  },
  {
    slug: 'counter-design',
    sitting: '2024-12-10',
    select: { kind: 'body', dropSections: ['Boundary Objects'] },
    why: 'The strongest belief material in the corpus, and the far end of a seven-year reversal: in 2017 he built a design-thinking on-ramp, here he names design thinking as insufficient. Boundary Objects is Star/Griesemer explained at length and would file their idea as his.',
  },
  {
    slug: 'archie',
    sitting: '2026-07-14',
    select: { kind: 'body' },
    why: 'The only place in 47 files where he marks his own confidence — "fairly sure the shape of the answer is something like this, and much less sure that this is it." Calibrated uncertainty is rare and worth having whole.',
  },
  {
    slug: 'commonplace-a-notebook-for-the-internet',
    sitting: '2026-07-13',
    select: { kind: 'body' },
    why: 'Highest first-person density in the corpus. Note its best line lives in the YAML caption and is therefore excluded — Micah ruled frontmatter is not his prose.',
  },
  {
    slug: 'blog/iiif-images',
    sitting: '2024-05-01',
    select: { kind: 'body', keepUntil: 'How do I actually organize, metadatize, annotate and then serve these images?' },
    why: 'The front half is four years of narrative about one problem, first person throughout. Everything after that heading is config files and install steps that decay into meaningless snippets. Holds "For a non-technical person like me" — a self-image the rest of the corpus contradicts.',
  },
  {
    slug: 'papad',
    sitting: '2022-01-01',
    select: { kind: 'body' },
    why: 'The cleanest single-author case study here — it has an explicit "My role" section and stays inside it. The method sequence (understand the legacy first, then features, then IA) is a real practice claim.',
  },
  {
    slug: 'blog/checklist-for-selecting-tools-for-indian-collectives',
    sitting: '2021-01-01',
    select: {
      kind: 'passages',
      passages: [
        'If there are multiple tools available, one being faster but more opaque, and another being slower but more accessible, which trade-off is more important based on the specific needs and limitations of the collective?',
        'Is there some sort of way that the project itself fails in the long-term either by acquisition, abandonment or commercialisation',
      ],
    },
    why: 'Two self-contained items. The other nine are interrogative checkbox fragments that need the framing sentence to mean anything, which breaks standalone-interpretability. These two are also one half of the tool-choice tension against Pune Covid Relief.',
  },
  {
    slug: 'glitch-art',
    sitting: '2017-01-01',
    select: {
      kind: 'passages',
      passages: ['A form of visual protest and stimming, I find color bending to be quite fun'],
    },
    why: 'Eleven words, and the only self-description in 47 files that is about Micah rather than about his work. Names the practice as protest, as stimming, and as fun. Any minimum-length filter would drop this silently.',
  },
  {
    slug: 'kishori-film-festival',
    sitting: '2026-02-22',
    dateNote: 'frontmatter says 2021-02-01, but the body was last written 2026-02-22; the project is 2021, the prose is not',
    select: { kind: 'body' },
    why: 'The "tools they could take apart, understand, and reshape" belief recurs across nine years. Dated to when the prose was written, not when the work happened.',
  },
  {
    slug: 'milli',
    sitting: '2021-01-01',
    select: {
      kind: 'passages',
      passages: [
        'Of these, I worked on making a mechanism for annotating an archival object as well as how the archival object looked.',
        'In the video, the team demos the tool, and I discuss the platform design with the participants.',
      ],
    },
    why: 'Q-51 permits this because the file separates authorship explicitly — every "I" marks his own slice and is contrastive. The team-voiced insight tables are Design Beku\'s reasoning and stay out. Skill claims only; there is no passage here where he says what he believes.',
  },
  {
    slug: 'enableindia-le',
    sitting: '2022-01-01',
    select: {
      kind: 'passages',
      passages: [
        'As part of this Pilot, my role was to create participatory ways of recognizing, experimenting and encouraging the use of the archive',
      ],
    },
    why: 'Twenty-one "we" to one "my". Only the separable sentence survives Q-51. The archiving-must-be-native insight is the best idea in the file and is not attributable to him alone.',
  },
  {
    slug: 'habba-redesign',
    sitting: '2018-01-01',
    select: {
      kind: 'passages',
      passages: [
        'Additionally, I incorporated a breakdown of the cost-price for each product, allowing customers to see how their money directly supported the artisans and the production process.',
      ],
    },
    why: 'The one value-bearing line in 253 words, and it is the same instinct as counter-design six years later: make the supply chain legible to the person on the other side of the interface.',
  },
  {
    slug: 'blog/mapping-history-of-cinema',
    sitting: '2026-05-17',
    dateNote: 'frontmatter says 2024-01-01; body last written 2026-05-17',
    select: {
      kind: 'passages',
      passages: ['The research, as far as I saw it, was about tracing the history of cinema halls in Hyderabad'],
    },
    why: 'Kept for one epistemic tell — "as far as I saw it" marks the limit of his own view of someone else\'s research. The rest is a QGIS tutorial executing another scholar\'s brief.',
  },
  {
    slug: 'speculative-storytelling-in-wayanad',
    sitting: '2022-01-01',
    select: {
      kind: 'passages',
      passages: ['While studying the Paniya community in Kerala, I was first introduced to the severity of caste issues in India.'],
    },
    why: 'A genuine formation episode, singular, and separable from four-person work. The better sentence in the file — the refusal to import metaphors — is a "we" claim and stays out under Q-51.',
  },
  {
    slug: 'external/wikipedia-editathon-dalit-history-month',
    sitting: '2021-02-01',
    select: {
      kind: 'passages',
      passages: [
        "Wikipedia's knowledge gaps are not accidental- they reflect whose histories are considered encyclopaedic.",
      ],
    },
    why: 'A value claim that matches his politics everywhere else. Flagged: it is third-person assertion with no "I", so it is his position stated as a general truth rather than owned.',
  },
];

/** Excluded, with the reason. Kept in the file so the decision is auditable. */
const EXCLUDED: { slug: string; why: string }[] = [
  { slug: 'the-imposter-among-us', why: 'Q-51 — Micah\'s ruling. Billed in its own text as notes from a talk hosted by Micah and Paul. Also ~600 words of danah boyd and an Economic Times piece as PLAIN BULLET LISTS with no blockquote markup, so an extractor reads them as his sentences.' },
  { slug: 'facilitating-a-design-studio', why: 'Q-51 — "I co-taught a four-month course", zero separation, plus seven students\' first-person blurbs in lcard shortcodes making up ~45% of the body.' },
  { slug: 'caste-and-education', why: 'Q-51, and this one hurts. Eight "we", zero "I", and — alone among his student-era projects — no "My contribution:" line. It holds the clearest research-ethics statement in the corpus ("we worked with them as facilitators rather than subjects") and I am excluding it anyway, because applying the rule only when it is cheap is worse than not having it. Reversible: one sentence from Micah about what he wrote makes it admissible.' },
  { slug: 'carpooling-unalone-karwaan', why: 'Q-51 — the narrator is not stable. Ten third-person references to "the team" for the group he was in, switching to "we" mid-passage. Its blockquote is a marketing manager\'s "we".' },
  { slug: 'designers-ace', why: 'Q-51 — the one interesting belief is stated as "Our primary goal" by a five-person team. The 2017 end of the design-thinking reversal is therefore recorded in this file only as a reason, not as a snippet.' },
  { slug: 'blog/antarsam-exploring-alternate-histories-and-futures', why: 'Fiction, zero first-person-singular, and it stars a fictional 1952 myrmecologist named Micah. Any name-anchored attribution files an invented ant paper as his.' },
  { slug: 'external/tweaking-the-education-system', why: 'Its only first-person sentence is retrospective, written from now looking back, but stamped 2018-06-01. Ingested, it asserts he understood pedagogy as central to his practice in 2018 — which the sentence denies by calling it "one of my first".' },
  { slug: 'pune-covid-relief', why: '132 words, no "I", no stated role. Its one claim — that every tool choice followed the checklist, while running on Google Sheets and Glide — is evidence for the tool-choice tension but is not a sentence about him.' },
  { slug: 'external/*', why: 'The externals are catalogue cards, not writing: 58–163 words each, most with zero first-person, ending in "[Read the full piece on X]". The prose lives on someone else\'s site. Exception: wikipedia-editathon, kept above.' },
  { slug: 'blog/Leaflet/*', why: 'Truncated excerpts of posts that live at khattamicah.leaflet.pub. Micah is fetching the originals later — this is a deferral, not a rejection.' },
  { slug: 'poems', why: 'A 29-word wrapper around a Pixelfed feed. The poems are not in the file. Deferred with the Leaflet originals — likely the densest person-knowledge he has published.' },
  { slug: 'my-art / graphics-work / website-development-iihs / climate-resource-center / jingle-tales / south-asian-digital-history / portfolio-workshops', why: 'Index and deliverable pages. No pronoun, no claim, no method. portfolio-workshops is retained OUT of the vault but used as a provenance source — it is the only file naming his co-authors on five other items, which is what set the Q-51 flags.' },
];

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
