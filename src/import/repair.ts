/**
 * Repair — the step that runs after a clean commit (seeding Task 10).
 *
 * Of 139 imported snippets, 96 dangle and 25 resolve from nothing, and the
 * wrong answer to that is a screen listing 400 outstanding repairs — debt
 * rendered as a list, which Q-24 forbids. So each unresolvable dangler
 * becomes one Bud and one ordinary Queue question under a live cap, and
 * there is no repair surface to build.
 *
 * Two bounds, deliberately different (Q-72): the cap bounds the QUESTION,
 * never the Bud.
 *
 * 1. EVERY dangler found in `snippets` becomes a Bud — no cap, no
 *    exception. A Bud is a held fragment with its failures recorded (Q-6):
 *    it costs the person nothing, surfaces nowhere, and accuses no one, so
 *    there is nothing to rate-limit.
 * 2. The Queue question is then minted, oldest dangler first, one per
 *    dangler, until `repair.liveCap` live 'import-repair' entries exist
 *    (Q-56: a bound ships live at birth — a shadowed cap is not a cap).
 *    The rest are deferred, not dropped.
 *
 * The ledger (`vault/imports/repair-ledger.jsonl`) is what makes the
 * deferred ones findable: it records every dangler SEEN with whether its
 * question was minted, and a later run reads the ledger first — mints
 * questions for the unquestioned before touching this commit's new ones,
 * and re-Buds nothing. Without the ledger a dangler clipped by the cap is
 * invisible forever, because this step only ever sees the snippets of the
 * commit that called it — that is what makes the ledger load-bearing
 * rather than bookkeeping.
 *
 * No model call: the question is composed by template — the snippet quoted
 * verbatim and one fixed sentence naming the anaphor. A model call here
 * would buy phrasing and cost a second failure mode on a path that runs
 * after every commit (tests/import-repair.test.ts greps for LLM imports).
 */

import { join } from 'node:path';

import { appendLine, readLines } from '../jsonl.js';
import type { QueueStore, Snippet, Vault } from '../types.js';
import type { LogFn } from '../wiki/contract.js';
import { readBud } from '../vault/buds.js';
import { THRESHOLDS } from '../wiki/thresholds.js';

/** The closed anaphor lexicon. The detector under-detects on purpose: a
 * missed dangler costs nothing — a Bud waits without accusing anyone (Q-6)
 * — while a wrong repair question spends the person's attention on a
 * referent that was never unclear. */
const ANAPHORS: Record<string, true> = {
 this: true,
 that: true,
 these: true,
 those: true,
 it: true,
 they: true,
 he: true,
 she: true,
 him: true,
 her: true,
 them: true,
 such: true,
 there: true,
};

/** The recorded failure every repair Bud carries (Q-6's shape). */
const BUD_FAILURE = 'dangling-referent';

const QUEUE_SOURCE = 'import-repair';
const LEDGER_REL = join('imports', 'repair-ledger.jsonl');

/**
 * One ledger line — a dangler SEEN. `questioned` says whether its question
 * was minted; a deferred dangler keeps a `questioned: false` line so a
 * later run under room picks it up. `version` is the snippet version the
 * dangler was seen at — the cite a deferred question needs when it is
 * minted on a later run from the ledger alone. The LAST line per snippetId
 * wins on read, so a re-mint is a new line with `questioned: true`.
 */
type LedgerLine = {
 at: string;
 snippetId: string;
 budId: string;
 questioned: boolean;
 version: number;
};

export function runImportRepair(deps: {
 vault: Vault;
 queue: QueueStore;
 vaultRoot: string;
 log: LogFn;
 snippets: Snippet[];
 cap?: number;
}): { budded: number; questioned: number; deferred: number } {
 const capValue = THRESHOLDS['repair.liveCap'].value;
 const cap = deps.cap ?? (typeof capValue === 'number' ? capValue : 0);

 // READ the ledger first: the ledger is the memory, and a re-run over the
 // same snippets Buds nothing and re-mints nothing.
 const ledger = readRepairLedger(deps.vaultRoot);
 const lastSeen = new Map<string, LedgerLine>();
 for (const line of ledger) lastSeen.set(line.snippetId, line);
 const seen = new Set(lastSeen.keys());

 // The unquestioned danglers from earlier runs, oldest first — lines are
 // appended in captured order, so first-seen in the file is oldest.
 const unquestioned: LedgerLine[] = [];
 const firstSeen = new Set<string>();
 for (const line of ledger) {
  if (firstSeen.has(line.snippetId)) continue;
  firstSeen.add(line.snippetId);
  if (!lastSeen.get(line.snippetId)!.questioned) unquestioned.push(line);
 }

 // DETECTOR: the prose opens (trimmed) with a word from the closed anaphor
 // lexicon AND the 073 context window is absent — a dangler with a window
 // is not unresolvable. Under-detects on purpose (see the module note).
 const fresh = deps.snippets
  .filter(isDangler)
  .filter((s) => !seen.has(s.id))
  .sort((a, b) => a.captured.localeCompare(b.captured));

 // Bud FIRST — every unresolvable dangler becomes a Bud, no cap, no
 // exception (Q-72): the Bud is what survives the cap's clip.
 const budded: { snippet: Snippet; budId: string }[] = [];
 for (const s of fresh) {
  const bud = deps.vault.saveBud(s.prose, [BUD_FAILURE], s.provenance.session);
  budded.push({ snippet: s, budId: bud.id });
 }

 // Then the questions: oldest dangler first — earlier runs' deferred ones
 // before this commit's new ones — until the count of live 'import-repair'
 // entries reaches the cap.
 const live = deps.queue.list({ source: QUEUE_SOURCE, status: 'pending' }).length;
 let room = Math.max(0, cap - live);
 let questioned = 0;
 let deferred = 0;
 const reminted: { snippetId: string; budId: string; version: number }[] = [];

 for (const line of unquestioned) {
  if (room <= 0) {
   deferred++;
   continue;
  }
  // The prose lives in the Bud (Q-6: a verbatim fragment held, never
  // edited into shape) — the ledger alone has no prose to quote.
  const bud = readBud(deps.vaultRoot, line.budId);
  if (!bud) {
   deferred++;
   continue;
  }
  deps.queue.add({
   source: QUEUE_SOURCE,
   license: 'CC0',
   question: questionFor(bud.fragment),
   questionForm: 'deliberative',
   cites: [`${line.snippetId}@${line.version}`],
   quotedFragment: bud.fragment,
   horizon: 'now',
  });
  reminted.push({ snippetId: line.snippetId, budId: line.budId, version: line.version });
  room--;
  questioned++;
 }

 const mintedIds = new Set<string>();
 for (const { snippet, budId } of budded) {
  if (room <= 0) {
   deferred++;
   continue;
  }
  deps.queue.add({
   source: QUEUE_SOURCE,
   license: 'CC0',
   question: questionFor(snippet.prose),
   questionForm: 'deliberative',
   cites: [`${snippet.id}@${snippet.version}`],
   quotedFragment: snippet.prose,
   horizon: 'now',
  });
  mintedIds.add(snippet.id);
  room--;
  questioned++;
 }

 // Record every dangler SEEN. A minted question's line lands after the
 // question exists on disk, so the ledger never claims a question that was
 // not written; a crash between the two re-mints once, which the cap and
 // the ULID ids keep bounded.
 const now = new Date().toISOString();
 for (const { snippet, budId } of budded) {
  appendRepairLedger(deps.vaultRoot, {
   at: now,
   snippetId: snippet.id,
   budId,
   questioned: mintedIds.has(snippet.id),
   version: snippet.version,
  });
 }
 for (const m of reminted) {
  appendRepairLedger(deps.vaultRoot, {
   at: now,
   snippetId: m.snippetId,
   budId: m.budId,
   questioned: true,
   version: m.version,
  });
 }

 if (budded.length > 0) {
  deps.log({
   at: now,
   actor: 'clerk',
   kind: 'repair-budded',
   detail: `buds=${budded.length}`,
  });
 }
 if (deferred > 0) {
  deps.log({
   at: now,
   actor: 'clerk',
   kind: 'repair-question-capped',
   detail: `deferred=${deferred}`,
  });
 }

 return { budded: budded.length, questioned, deferred };
}

/** The detector: an anaphor opening AND no 073 context window. */
function isDangler(s: Snippet): boolean {
 if (s.provenance.context) return false;
 const first = s.prose.trim().split(/\s+/)[0];
 return first !== undefined && ANAPHORS[first.toLowerCase()] === true;
}

/** The question: the snippet quoted verbatim, then one fixed sentence
 * naming the anaphor (Q-15: ordinary, never accusatory). No model call. */
function questionFor(prose: string): string {
 return `"${prose}" — this opens by pointing at something; what was it pointing at?`;
}

function readRepairLedger(vaultRoot: string): LedgerLine[] {
 const lines: LedgerLine[] = [];
 for (const raw of readLines(vaultRoot, LEDGER_REL)) {
  if (raw.trim() === '') continue;
  try {
   const line = JSON.parse(raw) as LedgerLine;
   if (
    typeof line?.snippetId !== 'string' ||
    typeof line?.budId !== 'string' ||
    typeof line?.version !== 'number'
   ) {
    continue;
   }
   lines.push(line);
  } catch {
   // A half-written final line must not hide the backlog above it — the
   // sweep-deferral ledger's own rule (src/wiki/store.ts).
  }
 }
 return lines;
}

function appendRepairLedger(vaultRoot: string, line: LedgerLine): void {
 appendLine(vaultRoot, LEDGER_REL, JSON.stringify(line));
}
