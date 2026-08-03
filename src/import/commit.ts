/**
 * Commit — one accepted item becomes one dated sitting (step 7 of 13).
 *
 * This is the only path from an import into the corpus, and it carries the
 * two acceptance criteria that cannot be checked anywhere else: the sitting's
 * date spans the real range (`record.date`, decided once by `store.admit`),
 * and every kept piece is an exact substring of its SOURCE FILE rather than
 * of the prepared prose the importer wrote.
 *
 * The verification gate runs FIRST and is all-or-nothing: re-read the source,
 * re-hash the body, check every decision against it, and only then open the
 * transcript. A partial import would leave a sitting whose transcript claims
 * more than its snippets carry, so any unverifiable decision refuses the
 * whole item and writes nothing at all.
 *
 * Writes, in order:
 *   1. `startTranscript` — one dated sitting, `started` always `record.date`,
 *      never a branch: `store.admit` already decided the date (frontmatter
 *      `date` for a new path, `lastmod` for Q-59's second sitting) and wrote
 *      it to the record. A second branch here would be a second rule, and the
 *      two would drift.
 *   2. `appendTurn` per prepared turn — the prose exactly as the harvester
 *      saw it. The transcript is the lineage plane; it is rebuilt, never
 *      invented.
 *   3. One snippet per kept decision, `kind: 'unprompted'` (nothing was asked
 *      for these words), `channel: 'pasted'` (048), and `context` per 073's
 *      landed rule — the preceding paragraph when the cut opens a paragraph,
 *      computed from the cut's recorded offset in the source body, never
 *      present-but-empty.
 *   4. One reading per kept decision, from the cut's own labels (ticket 062
 *      exists because extraction persists them).
 *   5. `store.put` — status 'accepted', the session id, and `kept`: the exact
 *      texts written as Snippets. `kept` is what T5's Q-59 dedupe reads on a
 *      later scan of the same source path, so an edited post offers only what
 *      is new.
 *
 * The session id is `import-<hash>`, stable and derived, so a crash between
 * transcript and snippets cannot mint a second sitting for the same item on
 * retry.
 */

import matter from 'gray-matter';

import { toTurns } from './body.js';
import type { ImportDecision, RegionRecord } from './contract.js';
import type { ImportStore } from './store.js';
import { bodyHash } from './scan.js';
import { isQuotedFromSource, quotedSpans } from '../harvester/admissibility.js';
import type { Facet, Stance, Vault } from '../types.js';
import type { LogFn } from '../wiki/contract.js';

export type CommitDeps = {
  vault: Vault;
  store: ImportStore;
  readSource: (p: string) => string;
  log: LogFn;
  /** Injected, not imported: the region store, so a test hands one region.
   *  Injection site: the commitImport deps literal in POST
   *  /api/import/:hash/decisions (src/server.ts, seeding Task 12 Step 3).
   *  Without that step every imported snippet ships with no `authorship`
   *  key and Tasks 1, 2, 7 and 13 amount to a form the vault never hears
   *  about. */
  regionFor?: (sourcePath: string) => RegionRecord | null;
};

export type CommitRefusal = 'stale' | 'not-extracted' | 'unverifiable';

export type CommitResult =
  | { ok: true; sessionId: string; snippets: number }
  | { ok: false; reason: CommitRefusal; detail: string };

/**
 * The preceding paragraph when `at` opens a paragraph of the source body
 * (073's landed rule for imported pieces): split the body on blank lines,
 * track each paragraph's start offset, and a cut whose `at` equals the
 * containing paragraph's start — and is not the piece's first paragraph —
 * gets that paragraph's predecessor VERBATIM. Absent for a cut that opens
 * the piece or lands mid-paragraph: absent means absent (048's hazard is a
 * present key holding `undefined`, which throws in matter.stringify).
 */
function precedingParagraph(body: string, at: number): string | undefined {
  const sep = /\n[ \t]*\n/g;
  const paras: { start: number; end: number }[] = [];
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = sep.exec(body)) !== null) {
    paras.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  paras.push({ start, end: body.length });

  for (let i = 0; i < paras.length; i++) {
    if (at === paras[i]!.start) {
      if (i === 0) return undefined;
      return body.slice(paras[i - 1]!.start, paras[i - 1]!.end);
    }
  }
  return undefined;
}

/** Refuse the whole item: log it and return before anything is written. */
function refuse(deps: CommitDeps, reason: CommitRefusal, detail: string): CommitResult {
  deps.log({
    at: new Date().toISOString(),
    actor: 'clerk',
    kind: 'import-commit-refused',
    detail: `${detail} reason=${reason}`,
  });
  return { ok: false, reason, detail };
}

export function commitImport(
  deps: CommitDeps,
  hash: string,
  decisions: ImportDecision[],
): CommitResult {
  // 1. The record must exist and have been extracted — nothing to commit
  //    otherwise.
  const record = deps.store.get(hash);
  if (record === null || record.status !== 'extracted') {
    const status = record === null ? 'missing' : record.status;
    return refuse(
      deps,
      'not-extracted',
      `hash=${hash} status=${status}`,
    );
  }

  // One region lookup, once, before any write: every snippet of this
  // sitting is stamped with the same authorship, or none at all.
  const region = deps.regionFor?.(record.sourcePath) ?? null;

  // 2. Re-read the source and re-hash the body. A changed body is a NEW item
  //    (Q-59): the next scan admits it under its own hash, dated to `lastmod`
  //    by `admit`. It is never a new version of these snippets — versioning
  //    it would date 2027 prose to 2018.
  const raw = deps.readSource(record.sourcePath);
  const body = matter(raw).content;
  if (bodyHash(body) !== record.hash) {
    return refuse(
      deps,
      'stale',
      `hash=${hash} path=${record.sourcePath}`,
    );
  }

  // 3. Verify every decision against the source BEFORE any write. A check
  //    that runs after the first write is not a gate.
  const cuts = record.cuts ?? [];
  if (cuts.length === 0) {
    return refuse(deps, 'not-extracted', `hash=${hash} cuts=0`);
  }
  const rawSpans = quotedSpans(raw);
  const kept: string[] = [];
  for (const d of decisions) {
    const cut = cuts[d.cut];
    if (cut === undefined) {
      return refuse(
        deps,
        'unverifiable',
        `hash=${hash} cut=${d.cut} out of range (${cuts.length} cuts)`,
      );
    }
    let text: string;
    if (d.action === 'approve') {
      text = cut.text;
    } else if (d.action === 'trim') {
      // A trim is the reviewer's own cut of the proposed cut: it must be a
      // non-empty substring of the proposal, and of the source body below.
      if (d.text === undefined || d.text.length === 0 || !cut.text.includes(d.text)) {
        return refuse(
          deps,
          'unverifiable',
          `hash=${hash} cut=${d.cut} trim not a substring of the proposed cut`,
        );
      }
      text = d.text;
    } else {
      continue; // 'discard' keeps nothing
    }
    // The kept piece must exist verbatim in the source body (never in the
    // prepared prose alone), and must not sit inside a quotation of the raw
    // file (Q-51, same predicate and same raw scope as extraction).
    if (!body.includes(text)) {
      return refuse(
        deps,
        'unverifiable',
        `hash=${hash} cut=${d.cut} text not in the source body`,
      );
    }
    if (isQuotedFromSource(text, rawSpans)) {
      return refuse(
        deps,
        'unverifiable',
        `hash=${hash} cut=${d.cut} text sits inside a quotation in the source file`,
      );
    }
    kept.push(text);
  }

  // ── Write phase ──

  // Stable, derived id: a crash mid-commit cannot mint a second sitting on
  // retry.
  const sessionId = `import-${record.hash}`;
  const started = `${record.date}T00:00:00.000Z`;

  deps.vault.startTranscript(sessionId, {
    mode: { minutes: 0, energy: 'medium' },
    protocol: 'import',
    started,
  });

  // The prepared prose, exactly as the harvester saw it — the lineage plane,
  // rebuilt never invented.
  for (const turn of toTurns(deps.store.prepared(hash), started)) {
    deps.vault.appendTurn(sessionId, turn);
  }

  for (const d of decisions) {
    if (d.action === 'discard') continue;
    const cut = cuts[d.cut]!;
    const text = d.action === 'approve' ? cut.text : d.text!;
    const context = precedingParagraph(body, cut.at);
    const provenance = {
      kind: 'unprompted' as const,
      session: sessionId,
      question: '',
      questionForm: 'deliberative' as const,
      channel: 'pasted' as const,
      // Task 9 (authorship reaches the snippet): the region's declared
      // authorship is a STAMP on every snippet of the sitting. Conditional
      // spread — never `authorship: undefined`: a present key holding
      // undefined throws in matter.stringify and loses the whole snippet
      // write (048, documented at src/import/store.ts:72-74). A record with
      // no region writes NO authorship key at all — the 19 adopted posts
      // stay exactly as they are; absent means never asked, nothing
      // backfills. The stamp never gates: it cannot refuse an item, and the
      // all-or-nothing commit rule is untouched.
      ...(region ? { authorship: region.authorship } : {}),
      // 048: conditional spread — a PRESENT key holding undefined throws in
      // matter.stringify and loses the entire snippet write.
      ...(context !== undefined ? { context } : {}),
    };
    const snippet = deps.vault.saveSnippet(text, provenance);
    deps.vault.saveReading({
      facet: cut.facet as Facet,
      stance: cut.stance as Stance,
      reading: cut.reading,
      cites: [`${snippet.id}@1`],
    });
  }

  deps.store.put({ ...record, status: 'accepted', sessionId, kept });

  deps.log({
    at: new Date().toISOString(),
    actor: 'clerk',
    kind: 'import-committed',
    detail: `path=${record.sourcePath} session=${sessionId} snippets=${kept.length} date=${record.date}`,
  });
  return { ok: true, sessionId, snippets: kept.length };
}
