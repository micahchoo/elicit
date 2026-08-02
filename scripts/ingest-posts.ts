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
import { makeComplete } from '../src/llm.js';
import type { Turn } from '../src/types.js';

const POSTS = '/mnt/Ghar/2TA/DevStuff/staging-nw/content/posts';
const REVIEW = 'docs/ingest-review-2026-08-02.md';

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

/** Strip Hugo shortcodes, images, bare links and HTML. */
function clean(md: string, keepQuotes: boolean): string {
  return md
    // {{< card >}}…{{< /card >}} and self-closing shortcodes
    .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.length === 0) return true;
      if (!keepQuotes && t.startsWith('>')) return false;   // other people's words
      if (/^!\[/.test(t)) return false;                      // images
      if (/^\[.*\]\(.*\)$/.test(t)) return false;            // link-only lines
      if (/^https?:\/\//.test(t)) return false;              // bare URLs
      if (/^[-*]\s*$/.test(t)) return false;
      if (/^<.*>$/.test(t)) return false;                    // raw HTML
      return true;
    })
    .join('\n');
}

/**
 * Paragraphs carrying an inline academic citation are dropped whole.
 *
 * This is the capstone's specific hazard and it is why the rule is mechanical
 * rather than a judgement: at least three quotations there are set as ordinary
 * paragraphs with the citation trailing, and one — the Bellacasa line — has no
 * quote marks and no citation at all, because the citation sits on the NEXT
 * paragraph. A reader cannot tell those from his own sentences, so neither can
 * a harvester.
 */
const ORPHAN_QUOTES = [
  'to think of care beyond a moral disposition, or a good intention, extending its senses to a material doing',
];
function dropCitedParagraphs(text: string): { kept: string; dropped: number } {
  const paras = text.split(/\n\s*\n/);
  let dropped = 0;
  const kept = paras.filter((p) => {
    const cited = /\[\([A-Z][^)]*\d{4}\)\]\(#/.test(p) || /\(\s*[A-Z][a-z]+\s+(and|&)?\s*[A-Za-z]*\s*\d{4}\s*\)/.test(p);
    const orphan = ORPHAN_QUOTES.some((q) => p.includes(q));
    if (cited || orphan) { dropped++; return false; }
    return true;
  }).join('\n\n');
  return { kept, dropped };
}

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

/**
 * Split into turns on paragraph boundaries, never mid-sentence.
 *
 * `propose()` verifies each cut as an exact substring of ITS OWN turn, so a
 * split through a sentence destroys any cut that spanned it.
 */
function toTurns(text: string, at: string, maxWords = 320): Turn[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const turns: Turn[] = [];
  let buf: string[] = [];
  let count = 0;
  const flush = () => {
    if (buf.length === 0) return;
    turns.push({ role: 'user', text: buf.join('\n\n'), at });
    buf = []; count = 0;
  };
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (count > 0 && count + w > maxWords) flush();
    buf.push(p); count += w;
  }
  flush();
  return turns;
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
  console.error('--apply is not wired yet: read the review file first, then it lands.');
  process.exit(2);
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

let totalCuts = 0, totalBuds = 0, totalTurns = 0;
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
  totalCuts += result.proposals.length;
  totalBuds += result.buds.length;
  process.stderr.write(`${result.proposals.length} cuts, ${result.buds.length} buds\n`);

  lines.push(`## ${post.slug}`, '');
  lines.push(`- **sitting:** ${post.sitting}${post.dateNote ? ` — ${post.dateNote}` : ''}`);
  lines.push(`- **selection:** ${post.select.kind}${citedDropped ? `, ${citedDropped} cited paragraphs dropped` : ''}`);
  lines.push(`- **why kept:** ${post.why}`, '');
  lines.push(`### proposed cuts (${result.proposals.length})`, '');
  for (const [i, p] of result.proposals.entries()) {
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
lines.push(`- ${Math.round((Date.now() - t0) / 1000)}s of model time`);

if (!existsSync('docs')) mkdirSync('docs', { recursive: true });
writeFileSync(REVIEW, lines.join('\n'), 'utf-8');
console.error(`\nReview written to ${REVIEW}`);
console.error(`${totalCuts} cuts, ${totalBuds} buds, ${Math.round((Date.now() - t0) / 1000)}s. Vault untouched.`);
