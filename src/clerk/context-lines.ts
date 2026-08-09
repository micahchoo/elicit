/**
 * The context-line composition job — Batch B2, §11 of the redesign.
 *
 * One context line per passage (snippet) without one. The line is agent
 * ink, marginalia-class, never quotable: *when* it was said, *what
 * question* drew it, *what stood before it* in the conversation, and
 * *what it echoes or clashes with* across the years (§11).
 *
 * The job's discipline is the whole product. The line is built from
 * MECHANICAL facts — captured date, eliciting question, the transcript
 * blocks that stood before the passage, and the lexical resonance hits
 * the index already computes — plus ONE model call that turns those
 * facts into the echo/clash sentence. The prompt pins the two
 * prohibitions the recorded harm class was about: describe the utterance
 * and its circumstances, never the person, and quote no prose from the
 * person. There is no negation to drop, no modality to flatten, no
 * referent to fabricate, because the line never models the person.
 *
 * Storage is the context-line store (`vault/wiki/context-lines.json`,
 * src/wiki/store.ts), read-then-upserted so the page's fix-context and
 * unlink-echo verbs are never clobbered. Every written line carries the
 * Q-34 model stamp. Every run logs its coverage — composed and skipped —
 * because §12's debt is that starvation must be a sentence on the
 * activity log, never a silence.
 */

import { buildIndex, resonate } from '../index/lexical.js';
import type { Complete, LexicalIndex, Snippet, Vault } from '../types.js';
import type { EventKind } from '../log/kinds.js';
import { readContextLines, writeContextLines, type ContextLineRecord } from '../wiki/store.js';
import { THRESHOLDS, readNumber } from '../wiki/thresholds.js';

/** The docket log sink, narrowed to what this job emits. */
export type ContextLinesLog = (e: {
 at: string;
 actor: 'clerk';
 kind: EventKind;
 detail: string;
 refs?: string[];
}) => void;

/**
 * How many older passages one context line may cite as its echo/clash
 * evidence. The echo list is a citation, not a model choice: the top
 * resonance hits ARE what the line rests on, and the page's unlink-echo
 * verb trims a hit that is not a real echo.
 */
const ECHO_CANDIDATES = 3;

/**
 * How much "what stood before it" one prompt may carry. Enough for the
 * eliciting question and a turn or two of context; a whole sitting would
 * drown the one line the model is asked to write.
 */
const BEFORE_CHARS = 700;

/**
 * The ONE system prompt of the job. Its discipline is load-bearing and
 * asserted in tests — exported as data so the suite can hold it still:
 * the line describes the utterance and its circumstances, never the
 * person, and quotes no prose from the person.
 */
export const CONTEXT_LINE_SYSTEM = `You write the context line for one passage of a person's own words — the marginalia of their archive.

The context line says when it was said, what question drew it, what stood before it in the conversation, and what it echoes or clashes with across the years.

The line describes the utterance and its circumstances, never the person. Quote no prose from the person: not the passage, not any other passage, not a phrase of either. The person's words appear only in the facts below, as context for you. Never write a trait sentence about the person.

The facts below are true. Reply with one plain sentence. No preamble.`;

/** One echo/clash fact: an older passage this one resonates with. */
export type EchoFact = {
 passageId: string;
 captured: string;
 sharedPhrase: string;
 score: number;
};

/**
 * Compose one context line: the mechanical facts go in, ONE model call
 * happens, and the line plus the echo citations it rests on come out.
 * Exported for the tests; `runContextLines` is its only production
 * caller.
 */
export async function composeContextLine(deps: {
 s: Snippet;
 /** What stood before the passage in its conversation ("" when nothing). */
 before: string;
 /** The older passages this one echoes or clashes with. */
 echoes: EchoFact[];
 complete: Complete;
}): Promise<{ text: string; echoes: string[] }> {
 const question = deps.s.provenance.question.trim();
 const echoLines = deps.echoes.map((e) => {
  const when = e.captured ? ` (${e.captured.slice(0, 10)})` : '';
  return `- passage ${e.passageId}${when} shares the phrase "${e.sharedPhrase}"`;
 });
 const facts = [
  `when: ${deps.s.captured}`,
  `question that drew it: ${question || 'none — these words were written unprompted'}`,
  `what stood before it: ${deps.before || 'none recorded'}`,
  `it echoes or clashes with: ${echoLines.length > 0 ? '\n' + echoLines.join('\n') : 'nothing found across the corpus'}`,
 ].join('\n');
 const turn = [
  `PASSAGE (the person's words — read them for context, quote none of them):`,
  '---',
  deps.s.prose,
  '---',
  '',
  'FACTS:',
  facts,
  '',
  'Write the one-line context.',
 ].join('\n');
 const line = (await deps.complete(CONTEXT_LINE_SYSTEM, [
  { role: 'user', text: turn, at: new Date().toISOString() },
 ])).trim();
 return { text: line, echoes: deps.echoes.map((e) => e.passageId) };
}

/** The transcript body as `## agent` / `## user` blocks, with char offsets. */
type TranscriptBlock = { role: 'agent' | 'user'; text: string; start: number; end: number };

function transcriptBlocks(body: string): TranscriptBlock[] {
 const blocks: TranscriptBlock[] = [];
 const re = /^##\s+(agent|user)\s*$/gm;
 const matches = [...body.matchAll(re)];
 for (let i = 0; i < matches.length; i++) {
  const m = matches[i]!;
  const role = m[1] === 'user' ? 'user' : 'agent';
  const start = m.index! + m[0].length;
  const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
  blocks.push({ role, text: body.slice(start, end).trim(), start, end });
 }
 return blocks;
}

/**
 * What stood before this passage in its conversation. Two mechanical
 * locators, in order: the legacy harvest `span` (when a snippet carries
 * one), else the first transcript block whose text contains the passage
 * prose — the words are verbatim in the transcript (Q-8), so their first
 * occurrence is the passage's own. Blocks before that point, role-prefixed
 * and capped, are the context. Without a transcript, the recorded
 * antecedent sentence (`provenance.context`) stands in; with neither, "".
 */
function beforeFacts(s: Snippet, transcript: string | undefined, cap: number): string {
 if (transcript) {
  const blocks = transcriptBlocks(transcript);
  let prior: TranscriptBlock[] | null = null;
  if (s.provenance.span) {
   const cut = blocks.findIndex((b) => b.start >= s.provenance.span!.start);
   prior = cut === -1 ? blocks : blocks.slice(0, cut);
  } else {
   const idx = blocks.findIndex((b) => b.text.includes(s.prose));
   if (idx > 0) prior = blocks.slice(0, idx);
  }
  if (prior && prior.length > 0) {
   let text = prior.map((b) => (b.role === 'agent' ? `Q: ${b.text}` : `A: ${b.text}`)).join('\n');
   if (text.length > cap) text = text.slice(-cap);
   return text;
  }
 }
 return s.provenance.context ?? '';
}

/** The lexical resonance hits of one passage — the echo/clash facts. */
function echoFacts(index: LexicalIndex, s: Snippet, all: Snippet[], k: number): EchoFact[] {
 const hits = resonate(index, s.prose, k);
 const byId = new Map(all.map((x) => [x.id, x]));
 const out: EchoFact[] = [];
 for (const h of hits) {
  if (h.snippetId === s.id) continue; // a passage never echoes itself
  const other = byId.get(h.snippetId);
  if (!other) continue;
  out.push({ passageId: h.snippetId, captured: other.captured, sharedPhrase: h.sharedPhrase, score: h.score });
 }
 return out;
}

/**
 * The context-line job, as a docket thunk: compose a stamped context line
 * for every passage without one, up to the per-run quota
 * (`contextLines.perRun`), newest first. Read-then-upsert on the store —
 * lines the page's verbs have fixed are never clobbered. Always logs its
 * coverage: how many passages got lines and how many were skipped, so a
 * starved run is a sentence on the activity log, never a silence.
 */
export async function runContextLines(deps: {
 vault: Vault;
 vaultRoot: string;
 complete: Complete;
 modelName: string;
 readTranscript?: (root: string, session: string) => string;
 log: ContextLinesLog;
}): Promise<{ composed: number; skipped: number }> {
 const at = () => new Date().toISOString();
 const snippets = Object.values(deps.vault.rebuildIndex().snippets);
 const existing = new Map(readContextLines(deps.vaultRoot).map((r) => [r.passageId, r]));
 const cap = readNumber(THRESHOLDS['contextLines.perRun'], 10);
 const eligible = snippets
  .filter((s) => !existing.has(s.id))
  .sort((a, b) => b.captured.localeCompare(a.captured));
 const candidates = eligible.slice(0, cap);
 const index = buildIndex(snippets);

 let composed = 0;
 for (const s of candidates) {
  try {
   const before = beforeFacts(s, deps.readTranscript?.(deps.vaultRoot, s.provenance.session), BEFORE_CHARS);
   const echoes = echoFacts(index, s, snippets, ECHO_CANDIDATES);
   const line = await composeContextLine({ s, before, echoes, complete: deps.complete });
   if (!line.text) continue;
   existing.set(s.id, {
    passageId: s.id,
    text: line.text,
    echoes: line.echoes,
    at: at(),
    model: deps.modelName,
   } satisfies ContextLineRecord);
   composed++;
  } catch {
   // One passage's failure is one passage's skip — never the run's.
  }
 }
 if (composed > 0) writeContextLines(deps.vaultRoot, [...existing.values()]);

 const skipped = Math.max(0, eligible.length - composed);
 deps.log({
  at: at(),
  actor: 'clerk',
  kind: 'context-lines-composed',
  detail: `composed=${composed} skipped=${skipped} cap=${cap}`,
 });
 return { composed, skipped };
}
