/**
 * The reading pass — one Reading per imported Snippet (ticket 062).
 *
 * Ticket 057 landed 139 snippets across 19 dated sittings and no Readings: the
 * dry run recorded cut TEXT only, so facet, stance and the reading sentence
 * were not recoverable without the model. Nine years of corpus is therefore
 * evidence but not wiki — the Clerk mints Claims from Readings (Q-28), and
 * there are none to sweep.
 *
 * This is a script rather than a server route because it runs once, over a
 * known set, and its cost (~139 model calls at ~40s) belongs in a terminal.
 *
 *   npx tsx scripts/read-snippets.ts --plan            what would run; no model calls
 *   npx tsx scripts/read-snippets.ts --apply           read every unread snippet
 *   npx tsx scripts/read-snippets.ts --apply --limit 5 the same, first 5 only
 *   npx tsx scripts/read-snippets.ts --verify          assert + distributions, from disk
 *
 * The vault is real personal data with no backup (ticket 017, declined
 * knowingly). This script ADDS Readings and modifies nothing that exists: it
 * calls `saveReading` and `rebuildIndex`, and touches no snippet, no
 * transcript and no bud.
 */

import { propose, SYSTEM_PROMPT } from '../src/harvester/harvester.js';
import { createVault } from '../src/vault/vault.js';
import { makeComplete, roleConfig, describeRole } from '../src/llm.js';
import type { Complete, CutProposal, Facet, Snippet, Stance, Vault } from '../src/types.js';

const VAULT_ROOT = process.env['ELICIT_VAULT'] ?? 'vault';

/**
 * The imported corpus, by session prefix.
 *
 * `scripts/ingest-posts.ts` mints a slug-derived session id `post-<slug>` for
 * every dated sitting, so the prefix names the 057 import exactly and cannot
 * catch a snippet from a live sitting (whose session is a ulid).
 */
const IMPORT_SESSION_PREFIX = 'post-';

// ---------------------------------------------------------------------------
// The vocabularies, again, and why they are here rather than imported
// ---------------------------------------------------------------------------
//
// `harvester.ts` keeps its own runtime sets and does not export them, and this
// file must not modify `src/`. These are `Record<Facet, true>` rather than a
// `Set<string>` on purpose: a member added to the `Facet` or `Stance` union
// fails `npx tsc --noEmit` HERE, so the copy cannot drift silently the way a
// list of strings would.

const FACETS: Record<Facet, true> = {
  episode: true,
  'general-event': true,
  'lifetime-period': true,
  fact: true,
  construct: true,
  intention: true,
  value: true,
  'causal-theory': true,
  'momentary-state': true,
  'know-what': true,
  'know-how': true,
  habit: true,
  'know-why': true,
};
const STANCES: Record<Stance, true> = {
  avowal: true,
  'self-observation': true,
  'report-of-fact': true,
  'pole-preference': true,
  commitment: true,
  'uncertainty-marked': true,
  superseded: true,
  'role-taking': true,
};

const isFacet = (s: string): s is Facet => Object.hasOwn(FACETS, s);
const isStance = (s: string): s is Stance => Object.hasOwn(STANCES, s);

// ---------------------------------------------------------------------------
// Reading the vault
// ---------------------------------------------------------------------------

/** `snippetId@version` → snippetId. Anything unparsable is ignored, not guessed. */
function citedSnippetId(cite: string): string | undefined {
  const at = cite.lastIndexOf('@');
  return at > 0 ? cite.slice(0, at) : undefined;
}

type VaultView = {
  /** The 139 — snippets from the 057 import, in the order this pass reads them. */
  imported: Snippet[];
  /** snippetId → how many Readings cite it right now. */
  readingsBySnippet: Map<string, number>;
};

/**
 * Read the vault from disk.
 *
 * Called at the start of every mode and again at the end of `--apply`, because
 * the acceptance criterion is about the vault and a script that checks its own
 * log checks nothing.
 *
 * ORDER: smallest sitting first, then session, then snippet id. One long-form
 * sitting can dominate a corpus (measured: 76 of 139 snippets in one), so
 * reading it last means an interrupted run leaves the many small sittings —
 * the corpus's only cross-sitting evidence under Q-50 — already read, and
 * gives the facet distribution its widest sample earliest. The order is total and deterministic, so a resumed
 * run continues exactly where the last one stopped.
 */
function readVault(vault: Vault): VaultView {
  const index = vault.rebuildIndex();

  const readingsBySnippet = new Map<string, number>();
  for (const reading of Object.values(index.readings)) {
    for (const cite of reading.cites) {
      const id = citedSnippetId(cite);
      if (id === undefined) continue;
      readingsBySnippet.set(id, (readingsBySnippet.get(id) ?? 0) + 1);
    }
  }

  const imported = Object.values(index.snippets).filter((s) =>
    s.provenance.session.startsWith(IMPORT_SESSION_PREFIX),
  );

  const perSession = new Map<string, number>();
  for (const s of imported) {
    perSession.set(s.provenance.session, (perSession.get(s.provenance.session) ?? 0) + 1);
  }
  imported.sort((a, b) => {
    const sizeA = perSession.get(a.provenance.session) ?? 0;
    const sizeB = perSession.get(b.provenance.session) ?? 0;
    if (sizeA !== sizeB) return sizeA - sizeB;
    if (a.provenance.session !== b.provenance.session) {
      return a.provenance.session < b.provenance.session ? -1 : 1;
    }
    return a.id < b.id ? -1 : 1;
  });

  return { imported, readingsBySnippet };
}

// ---------------------------------------------------------------------------
// One snippet, one reading
// ---------------------------------------------------------------------------

/** How a snippet's labels were obtained, so the report can separate the paths. */
type Path = 'propose' | 'direct';

type Annotation = {
  facet: Facet;
  stance: Stance;
  reading: string;
  path: Path;
  /** The span the model actually labelled. Equal to the snippet unless noted. */
  span: string;
};

/** Wall-clock guard. A hung socket must not stall an hour-long run for good. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms}ms`)), ms);
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/**
 * The proposal that covers the snippet.
 *
 * Every proposal `propose()` returns is already an exact substring of the turn,
 * and the turn IS the snippet, so the whole-snippet cut is the one to want and
 * the longest sub-span is the honest second best. Which one was used is
 * reported, because a reading written off half a sentence is a weaker reading
 * and the number should be visible rather than assumed to be zero.
 */
function coveringProposal(proposals: CutProposal[], prose: string): CutProposal | undefined {
  const whole = proposals.find((p) => p.text.trim() === prose.trim());
  if (whole) return whole;
  return proposals
    .filter((p) => prose.includes(p.text))
    .sort((a, b) => b.text.length - a.text.length)[0];
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

/**
 * The fallback: the harvest system prompt, called directly.
 *
 * Needed because `propose()` is an EXTRACTION path and this is an ANNOTATION
 * job. Four of the 139 snippets open on a lowercase letter, and ticket 037's
 * `startsMidSentence` router sends any such cut to the Bud path — correctly,
 * when the question is whether a span should become a Snippet. Here that
 * question was answered by the reader's own hand during import triage, and
 * re-asking it now would leave lowercase-opening keeps with no reading at
 * all rather than route them anywhere.
 *
 * So this path skips the Bud router and NOTHING else: same clerk model, same
 * `SYSTEM_PROMPT`, same temperature, same Q-1 substring check, same
 * vocabulary. It runs only when `propose()` returns nothing usable, and the
 * count is reported.
 */
async function readDirect(complete: Complete, snippet: Snippet, at: string): Promise<Annotation | undefined> {
  const raw = await withTimeout(
    complete(SYSTEM_PROMPT, [{ role: 'user', text: snippet.prose, at }], { temperature: 0.1 }),
    CALL_TIMEOUT_MS,
    `direct read of ${snippet.id}`,
  );

  let cuts: unknown;
  try {
    const parsed: unknown = JSON.parse(stripFences(raw));
    cuts = parsed !== null && typeof parsed === 'object' ? (parsed as { cuts?: unknown }).cuts : undefined;
  } catch {
    return undefined;
  }
  if (!Array.isArray(cuts)) return undefined;

  type Raw = { text?: unknown; facet?: unknown; stance?: unknown; reading?: unknown };
  const usable = (cuts as Raw[])
    .filter((c): c is { text: string; facet: string; stance: string; reading: string } =>
      typeof c.text === 'string' && c.text.length > 0 &&
      typeof c.facet === 'string' && typeof c.stance === 'string' &&
      typeof c.reading === 'string' &&
      // Q-1, unchanged: a cut is only real if it is verbatim in the snippet.
      snippet.prose.includes(c.text) &&
      isFacet(c.facet) && isStance(c.stance))
    .sort((a, b) => b.text.length - a.text.length);

  const best = usable.find((c) => c.text.trim() === snippet.prose.trim()) ?? usable[0];
  if (!best) return undefined;
  return {
    facet: best.facet as Facet,
    stance: best.stance as Stance,
    reading: best.reading,
    path: 'direct',
    span: best.text,
  };
}

/** Diagnostics summed across the run, in counts only — never user content. */
type RunTotals = {
  cutsSeen: number;
  fabricationDrops: number;
  inadmissibleDrops: number;
  fragmentBuds: number;
  outOfVocabularyLabels: number;
  supersessionCorrections: number;
  unmarkedIntentions: number;
  episodeAnchoredTurns: number;
  episodeBlindTurns: number;
  chunkErrors: number;
  parseFailures: number;
  /** Attempts that parsed cleanly and proposed nothing at all. */
  emptyResults: number;
  retries: number;
  directReads: number;
  partialSpans: number;
};

const CALL_TIMEOUT_MS = 420_000;   // ticket 007: a cold model took 370s and then failed
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 20_000];

/**
 * Read one snippet, retrying transport failures.
 *
 * `propose()` swallows a failed `complete()` into `diagnostics.chunkErrors` and
 * returns an empty proposal list, so a dead endpoint and a silent snippet look
 * identical from the outside. The diagnostics are what separates them, and the
 * separation is load-bearing: a retry is right for the first and a fallback is
 * right for the second.
 */
async function readSnippet(
  complete: Complete,
  snippet: Snippet,
  totals: RunTotals,
): Promise<Annotation | undefined> {
  const at = snippet.captured;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<typeof propose>>;
    try {
      result = await withTimeout(
        propose(snippet.provenance.session, [{ role: 'user', text: snippet.prose, at }], complete),
        CALL_TIMEOUT_MS,
        `read of ${snippet.id}`,
      );
    } catch (err) {
      totals.chunkErrors++;
      console.warn(`  transport failure on attempt ${attempt}: ${String(err)}`);
      await sleep(BACKOFF_MS[attempt - 1] ?? 0);
      totals.retries++;
      continue;
    }

    const d = result.diagnostics;
    totals.cutsSeen += d.cutsSeen;
    totals.fabricationDrops += d.fabricationDrops;
    totals.inadmissibleDrops += d.inadmissibleDrops;
    totals.fragmentBuds += d.fragmentBuds;
    totals.outOfVocabularyLabels += d.outOfVocabularyLabels;
    totals.supersessionCorrections += d.supersessionCorrections;
    totals.unmarkedIntentions += d.unmarkedIntentions;
    totals.episodeAnchoredTurns += d.episodeAnchoredTurns;
    totals.episodeBlindTurns += d.episodeBlindTurns;
    totals.chunkErrors += d.chunkErrors;

    // The endpoint answered nothing. Retryable, and never a reason to fall back.
    if (d.chunkErrors > 0) {
      console.warn(`  clerk call failed on attempt ${attempt}; retrying`);
      await sleep(BACKOFF_MS[attempt - 1] ?? 0);
      totals.retries++;
      continue;
    }

    if (d.parseMode === 'failed') {
      totals.parseFailures++;
      console.warn(`  output did not parse on attempt ${attempt} (${d.rawChars} chars)`);
      if (attempt < MAX_ATTEMPTS) { totals.retries++; continue; }
      break;
    }

    const picked = coveringProposal(result.proposals, snippet.prose);
    if (picked) {
      if (picked.text.trim() !== snippet.prose.trim()) totals.partialSpans++;
      return {
        facet: picked.facet,
        stance: picked.stance,
        reading: picked.reading,
        path: 'propose',
        span: picked.text,
      };
    }

    // Parsed, and nothing came back — either the Bud router took the only cut,
    // or the model proposed none. Sampling at temperature 0.1 is not
    // deterministic, so ask again before concluding the path cannot read this
    // snippet. Same prompt, same model, same temperature: a retry is not an
    // exemption, and nothing here changes what is asked.
    totals.emptyResults++;
    if (attempt < MAX_ATTEMPTS) { totals.retries++; continue; }
    break;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const direct = await readDirect(complete, snippet, at);
      if (direct) {
        totals.directReads++;
        if (direct.span.trim() !== snippet.prose.trim()) totals.partialSpans++;
        return direct;
      }
    } catch (err) {
      console.warn(`  direct read failed on attempt ${attempt}: ${String(err)}`);
    }
    if (attempt < MAX_ATTEMPTS) totals.retries++;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

function tally<T extends string>(values: T[]): [T, number][] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printDistribution(title: string, values: string[]): void {
  const total = values.length;
  console.log(`\n${title} (n=${total})`);
  if (total === 0) { console.log('  —'); return; }
  for (const [value, n] of tally(values)) {
    console.log(`  ${value.padEnd(16)} ${String(n).padStart(4)}  ${((n / total) * 100).toFixed(1)}%`);
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * Assert the acceptance criteria against the vault on disk.
 *
 * Nothing here reads the run's own log: the run may have been three interrupted
 * runs, and what has to be true is true of the files.
 */
function verify(vault: Vault): boolean {
  const index = vault.rebuildIndex();
  const { imported, readingsBySnippet } = readVault(vault);

  const missing = imported.filter((s) => (readingsBySnippet.get(s.id) ?? 0) === 0);
  const duplicated = imported.filter((s) => (readingsBySnippet.get(s.id) ?? 0) > 1);

  const importedIds = new Set(imported.map((s) => s.id));
  const mine = Object.values(index.readings).filter((r) =>
    r.cites.some((c) => { const id = citedSnippetId(c); return id !== undefined && importedIds.has(id); }),
  );
  const unstamped = mine.filter((r) => !r.model || !r.at);
  const wrongVersion = mine.filter((r) =>
    r.cites.some((c) => {
      const id = citedSnippetId(c);
      if (id === undefined || !importedIds.has(id)) return false;
      const snippet = index.snippets[id];
      return snippet === undefined || c !== `${id}@${snippet.version}`;
    }),
  );

  console.log(`\n── verification, against ${VAULT_ROOT} on disk ──`);
  console.log(`  imported snippets              ${imported.length}`);
  console.log(`  readings citing them           ${mine.length}`);
  console.log(`  snippets with NO reading       ${missing.length}`);
  console.log(`  snippets with MORE THAN ONE    ${duplicated.length}`);
  console.log(`  readings missing model or at   ${unstamped.length}`);
  console.log(`  cites not snippetId@version    ${wrongVersion.length}`);
  for (const s of missing.slice(0, 20)) console.log(`    unread: ${s.id}  ${s.prose.slice(0, 60)}`);
  for (const s of duplicated.slice(0, 20)) console.log(`    duplicate: ${s.id}  ${s.prose.slice(0, 60)}`);

  const ok = missing.length === 0 && duplicated.length === 0
    && unstamped.length === 0 && wrongVersion.length === 0;

  printDistribution('facet', mine.map((r) => r.facet));
  printDistribution('stance', mine.map((r) => r.stance));

  const models = tally(mine.map((r) => r.model ?? '(none)'));
  console.log(`\nmodel stamp`);
  for (const [m, n] of models) console.log(`  ${m.padEnd(16)} ${String(n).padStart(4)}`);

  // Q-50: cite independence is CROSS-SITTING, so the shape of the corpus
  // decides what the Clerk can promote and it is worth stating before anyone
  // reads a wall of `unconfirmed` as a fault.
  const perSession = new Map<string, number>();
  for (const s of imported) {
    perSession.set(s.provenance.session, (perSession.get(s.provenance.session) ?? 0) + 1);
  }
  const biggest = [...perSession.entries()].sort((a, b) => b[1] - a[1])[0];
  if (biggest) {
    console.log(`\nQ-50: ${imported.length} snippets over ${perSession.size} sittings; the largest`);
    console.log(`  (${biggest[0]}) holds ${biggest[1]}. Nothing drawn from one sitting alone`);
    console.log(`  reaches \`evidenced\`, so a wall of \`unconfirmed\` is the rule working.`);
  }

  console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

function plan(vault: Vault): void {
  const { imported, readingsBySnippet } = readVault(vault);
  const unread = imported.filter((s) => (readingsBySnippet.get(s.id) ?? 0) === 0);
  console.log(`${imported.length} imported snippets, ${imported.length - unread.length} already read, ${unread.length} to read.`);
  console.log(`At ~40s per call that is about ${Math.round((unread.length * 40) / 60)} minutes.`);
  console.log(describeRole(roleConfig('clerk')));
  for (const s of unread.slice(0, 5)) console.log(`  next: ${s.id}  ${s.prose.slice(0, 70)}`);
}

async function apply(vault: Vault, limit: number): Promise<void> {
  const cfg = roleConfig('clerk');
  console.log(`Reading pass — ${describeRole(cfg)}`);

  const { imported, readingsBySnippet } = readVault(vault);
  const queue = imported
    .filter((s) => (readingsBySnippet.get(s.id) ?? 0) === 0)
    .slice(0, limit);
  console.log(`${imported.length} imported snippets, ${queue.length} to read.\n`);
  if (queue.length === 0) return;

  const complete = makeComplete('clerk');

  // Ticket 007: the first call against a cold model has been measured at 370s
  // followed by an HTTP 500. Pay that here, once, where it reads as a warm-up
  // rather than as the first snippet mysteriously failing.
  const warm = Date.now();
  try {
    await withTimeout(
      complete('Reply with the single word: ready.', [{ role: 'user', text: 'ready?', at: new Date().toISOString() }], { temperature: 0 }),
      CALL_TIMEOUT_MS,
      'warm-up',
    );
    console.log(`warm-up ok in ${Math.round((Date.now() - warm) / 1000)}s\n`);
  } catch (err) {
    console.warn(`warm-up failed after ${Math.round((Date.now() - warm) / 1000)}s: ${String(err)}`);
    console.warn('continuing — the per-snippet retry handles a cold start.\n');
  }

  const totals: RunTotals = {
    cutsSeen: 0, fabricationDrops: 0, inadmissibleDrops: 0, fragmentBuds: 0,
    outOfVocabularyLabels: 0, supersessionCorrections: 0, unmarkedIntentions: 0,
    episodeAnchoredTurns: 0, episodeBlindTurns: 0, chunkErrors: 0,
    parseFailures: 0, emptyResults: 0, retries: 0, directReads: 0, partialSpans: 0,
  };

  const t0 = Date.now();
  let done = 0;
  const unread: Snippet[] = [];

  for (const [i, snippet] of queue.entries()) {
    const t = Date.now();
    const annotation = await readSnippet(complete, snippet, totals);

    if (!annotation) {
      unread.push(snippet);
      console.log(`${String(i + 1).padStart(3)}/${queue.length}  UNREAD  ${snippet.id}  ${snippet.prose.slice(0, 50)}`);
      continue;
    }

    // Written the instant it exists. 139 calls is over an hour and the run will
    // be interrupted; nothing is held in memory to be flushed at the end, and
    // the Reading on disk is itself the resume marker.
    vault.saveReading({
      facet: annotation.facet,
      stance: annotation.stance,
      reading: annotation.reading,
      cites: [`${snippet.id}@${snippet.version}`],
    });
    done++;

    const secs = Math.round((Date.now() - t) / 1000);
    const eta = Math.round(((Date.now() - t0) / (i + 1)) * (queue.length - i - 1) / 60000);
    console.log(
      `${String(i + 1).padStart(3)}/${queue.length}  ${String(secs).padStart(3)}s  ` +
      `${annotation.facet.padEnd(16)}${annotation.stance.padEnd(19)}` +
      `${annotation.path === 'direct' ? '[direct] ' : ''}${snippet.prose.slice(0, 44)}  (eta ${eta}m)`,
    );
  }

  const mins = Math.round((Date.now() - t0) / 60000);
  console.log(`\n${done} readings written in ${mins} minutes; ${unread.length} snippet(s) still unread.`);
  for (const s of unread) console.log(`  UNREAD ${s.id}  ${s.prose.slice(0, 70)}`);

  console.log('\n── harvest diagnostics, summed over the run ──');
  for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(24)} ${v}`);

  verify(vault);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(argv[limitArg + 1] ?? '0') : Number.POSITIVE_INFINITY;
const vault = createVault(VAULT_ROOT);

if (argv.includes('--verify')) {
  process.exitCode = verify(vault) ? 0 : 1;
} else if (argv.includes('--apply')) {
  await apply(vault, limit);
} else if (argv.includes('--plan')) {
  plan(vault);
} else {
  console.error('Pass --plan, --apply or --verify. The vault has no backup; --plan first.');
  process.exit(2);
}
