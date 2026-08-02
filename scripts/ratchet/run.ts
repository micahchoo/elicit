// ---------------------------------------------------------------------------
// Protocol ratchet harness — metrics runner.
//
// Usage:
//   npx tsx scripts/ratchet/run.ts --mode harvest [--prompt <path>] [--role clerk|elicitor] [--constrained] [--schema <path>] [--timeout <seconds>]
//   npx tsx scripts/ratchet/run.ts --mode probe    [--prompt <path>] [--role clerk|elicitor] [--timeout <seconds>]
//
// --constrained sends the cuts response_format (JSON schema) from harvester.ts
// on every harvest call. --schema <path> reads a JSON schema from a file and
// wraps it the same way; --constrained uses the built-in CUTS_RESPONSE_FORMAT.
// --timeout overrides the per-call guard (default 120s) — the longest corpus
// turns can exceed it, and a timeout reads as an unparsed chunk in the
// metrics, so a measurement run must set it high enough to let the model
// finish (ticket 078).
//
// --role picks which model answers (Q-48). It defaults to the role that runs
// the mode in production: harvest is clerk work, probing is elicitor work.
//
// Reads the corpus at scripts/ratchet/corpus.json, runs the model over every
// exchange, and prints the metrics JSON to stdout. Warnings and errors go to
// stderr. This script never edits src/ — see the harvest-mode WARNING for the
// prompt-override change propose() would need.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeComplete, roleConfig, type LlmRole, type ResponseFormat } from '../../src/llm.js';
import { propose, CUTS_RESPONSE_FORMAT } from '../../src/harvester/harvester.js';
import type { Complete, Turn } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Outer guard for every model call (pi-ai may hang on a dead endpoint). */
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

function modelTimeoutMs(): number {
 const raw = argValue('timeout');
 if (raw === undefined) return DEFAULT_MODEL_TIMEOUT_MS;
 const parsed = Number(raw);
 if (!Number.isFinite(parsed) || parsed <= 0) {
  console.error(`ERROR: --timeout must be a positive number of seconds, got "${raw}".`);
  process.exitCode = 1;
  return DEFAULT_MODEL_TIMEOUT_MS;
 }
 return Math.round(parsed * 1000);
}

const DEFAULT_PROBE_PROMPT = `You are conducting a reflective interview. Your task is to deepen the thread — not to catalogue facts, but to help the speaker see their own thinking from a new angle.

First, understand what the speaker just said. Notice what is alive in it — a tension, a distinction, a claim, an image, a choice. Then ask the one question a good interviewer would ask next.

SOME WAYS IN (repertoire, not prescription — pick the move the material wants):
- Go smaller: a general claim wants a specific scene, moment, or example.
- Go larger: a stated action or habit wants its purpose — what it serves, what would be lost without it.
- Find the edge: a category or judgment wants its nearest counterexample.
- Shift time: a stable-sounding trait wants its history — when it became true, when it was last false.
- Name the cost: a dilemma or tradeoff wants its price — in time, energy, attention, or relationship.
- Follow the image: a metaphor or concrete detail wants to be opened — what it feels like, what lives inside it.
- Connect: something said earlier resonates with what was just said. Name the thread.

HARD RULES:
- One question, one sentence. No preamble, no acknowledgment, no summary, no paraphrase.
- NEVER ask about "this conversation" itself.
- Never repeat a question you have already asked in this conversation. Vary sentence shape.
- Never praise, judge, or explain your question.
- Quoting their words is available, not required. When you do quote, use the exact phrase.
- When the thread is exhausted, output [SATURATED] and nothing else.`;

const CONVERSATION_PHRASES = [
 'this conversation',
 'this exchange',
 'our conversation',
 'this interview',
 "what we're doing",
];

const STOP_WORDS = new Set<string>([
 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
 'should', 'may', 'might', 'must', 'can', 'could',
 'i', 'you', 'he', 'she', 'it', 'we', 'they',
 'me', 'him', 'her', 'us', 'them',
 'my', 'your', 'his', 'its', 'our', 'their',
 'mine', 'yours', 'hers', 'ours', 'theirs',
 'this', 'that', 'these', 'those',
 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
 'at', 'by', 'in', 'of', 'on', 'to', 'with', 'from', 'up', 'down', 'out',
 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
 'between', 'under', 'again', 'then', 'once', 'here', 'there',
 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
 'such', 'no', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
 'because', 'as', 'until', 'while', 'if', 'though', 'although', 'even',
 'also',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorpusEntry {
 session: string;
 turns: Turn[];
}

interface HarvestExchangeMetrics {
 session: string;
 totalCuts: number;
 fabricatedCuts: number;
 fabricationRate: number;
 proposalCount: number;
 facetDistribution: Record<string, number>;
 buds: number;
 /** How the chunk output parsed: 'json' | 'line-oriented' | 'failed'. */
 parseMode: string;
 /** Chunks sent (one per harvestable user turn). */
 chunks: number;
 /** Chunks whose output parsed. */
 chunksParsed: number;
 /** Chunks where the API call itself failed (timeout, connection) — the
  *  path that survives grammar constraint (ticket 078, ticket 034). */
 chunkErrors: number;
 /** Chunks that parsed / chunks sent — 1 means every call parsed. */
 parseRate: number;
 /** Chunks that parsed / chunks that returned output — 1 means every
  *  returned chunk was well-formed (timeouts are not parse failures). */
 returnedParseRate: number;
 error?: string;
}

interface HarvestAggregate {
 totalCuts: number;
 fabricationRate: number;
 facetDistribution: Record<string, number>;
 meanProposalCount: number;
 /** Chunks that parsed / chunks sent, summed across exchanges. */
 parseRate: number;
 /** Chunks that parsed / chunks that returned output — timeouts excluded. */
 returnedParseRate: number;
 /** Per-exchange parse modes, counted. */
 parseModes: Record<string, number>;
}

interface ProbeExchangeMetrics {
 session: string;
 probeText: string;
 /** Unique frames across ALL exchanges in this run (same value per exchange). */
 distinctFrameCount: number;
 frames: string[];
 repeatRate: number;
 conversationReferenceRate: number;
 echoRate: number;
 error?: string;
}

interface ProbeAggregate {
 distinctFrames: number;
 meanRepeatRate: number;
 meanConversationReferenceRate: number;
 meanEchoRate: number;
}

interface RawCut {
 text?: string;
 sourceTurn?: number;
 facet?: string;
 stance?: string;
 reading?: string;
 standalone?: boolean;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
 const args = process.argv.slice(2);
 const eq = args.find((a) => a.startsWith(`--${name}=`));
 if (eq !== undefined) return eq.slice(`--${name}=`.length);
 const idx = args.indexOf(`--${name}`);
 if (idx >= 0) {
  const value = args[idx + 1];
  if (value !== undefined && !value.startsWith('--')) return value;
 }
 return undefined;
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

function loadCorpus(): CorpusEntry[] {
 const corpusUrl = new URL('./corpus.json', import.meta.url);
 const parsed = JSON.parse(readFileSync(corpusUrl, 'utf8')) as unknown;
 if (!Array.isArray(parsed)) {
  throw new Error(`corpus.json must be an array of exchanges, got ${typeof parsed}`);
 }
 return parsed as CorpusEntry[];
}

// ---------------------------------------------------------------------------
// Model call guard
// ---------------------------------------------------------------------------

async function callWithTimeout<T>(
 fn: () => Promise<T>,
 ms: number,
 label: string
): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 const timeout = new Promise<never>((_resolve, reject) => {
  timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
 });
 try {
  return await Promise.race([fn(), timeout]);
 } finally {
  if (timer !== undefined) clearTimeout(timer);
 }
}

// ---------------------------------------------------------------------------
// Harvest parsing (mirrors src/harvester/harvester.ts so we can count
// total vs fabricated cuts from the raw model output)
// ---------------------------------------------------------------------------

export function stripFences(raw: string): string {
 let s = raw.trim();
 // strip opening ```json or ```
 s = s.replace(/^```(?:json)?\s*\n?/i, '');
 // strip closing ```
 s = s.replace(/\n?```\s*$/, '');
 return s.trim();
}

export function parseLineOriented(raw: string): RawCut[] {
 const blocks = raw.split(/\n\s*\n/);
 const cuts: RawCut[] = [];
 for (const block of blocks) {
  const trimmed = block.trim();
  if (!trimmed) continue;

  const cut: RawCut = {};
  for (const line of trimmed.split('\n')) {
   const colonIdx = line.indexOf(':');
   if (colonIdx === -1) continue;
   const key = line.slice(0, colonIdx).trim().toLowerCase();
   const value = line.slice(colonIdx + 1).trim();

   switch (key) {
    case 'text':
    case 'cut':
     cut.text = value.replace(/^"(.*)"$/, '$1');
     break;
    case 'source':
    case 'sourceturn':
     cut.sourceTurn = parseInt(value, 10);
     break;
    case 'facet':
     cut.facet = value;
     break;
    case 'stance':
     cut.stance = value;
     break;
    case 'reading':
     cut.reading = value;
     break;
    case 'standalone':
     cut.standalone = value.toLowerCase() === 'true';
     break;
   }
  }
  cuts.push(cut);
 }
 return cuts;
}

export function parseCuts(raw: string): RawCut[] {
 const cleaned = stripFences(raw);
 try {
  const parsed = JSON.parse(cleaned) as { cuts?: unknown };
  return Array.isArray(parsed.cuts) ? (parsed.cuts as RawCut[]) : [];
 } catch {
  // JSON parse failed — attempt line-oriented fallback
  return parseLineOriented(raw);
 }
}

/** True when the cut's text is a non-empty verbatim substring of some user turn. */
export function isVerbatim(text: string | undefined, userTexts: string[]): boolean {
 if (text === undefined || text.length === 0) return false;
 return userTexts.some((u) => u.includes(text));
}

// ---------------------------------------------------------------------------
// Probe text analysis
// ---------------------------------------------------------------------------

/** Whitespace-split tokens, lowercased, punctuation stripped from the edges. */
export function wordTokens(text: string): string[] {
 return text
  .toLowerCase()
  .split(/\s+/)
  .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
  .filter((w) => w.length > 0);
}

export function contentWords(text: string): string[] {
 return wordTokens(text).filter((w) => !STOP_WORDS.has(w));
}

/** Frame = first 3 words of the probe, lowercased (whitespace split, no filtering). */
export function frameOf(probeText: string): string {
 return probeText
  .trim()
  .toLowerCase()
  .split(/\s+/)
  .filter((w) => w.length > 0)
  .slice(0, 3)
  .join(' ');
}

export function referencesConversation(probeText: string): boolean {
 const lower = probeText.toLowerCase();
 return CONVERSATION_PHRASES.some((p) => lower.includes(p));
}

/**
 * Echo rate: 1 when >=50% of the probe's content words appear in the user's
 * last answer; 0 otherwise. Content words are stop-word-filtered tokens; the
 * answer side is compared as a token set (all words, no stop-word filtering).
 */
export function echoRateOf(probeText: string, answerText: string): number {
 const probeWords = contentWords(probeText);
 if (probeWords.length === 0) return 0;
 const answerWords = new Set(wordTokens(answerText));
 const echoed = probeWords.filter((w) => answerWords.has(w)).length;
 return echoed / probeWords.length >= 0.5 ? 1 : 0;
}

/** Last agent-question + user-answer pair (agent first when present). */
export function lastExchangePair(turns: Turn[]): Turn[] {
 let lastUser: Turn | undefined;
 let lastUserIdx = -1;
 let lastAgentIdx = -1;
 for (let i = 0; i < turns.length; i++) {
  const t = turns[i]!;
  if (t.role === 'user') {
   lastUser = t;
   lastUserIdx = i;
  } else {
   lastAgentIdx = i;
  }
 }
 if (lastUser === undefined) return [];
 const agent = lastAgentIdx >= 0 && lastAgentIdx < lastUserIdx ? turns[lastAgentIdx] : undefined;
 return agent !== undefined ? [agent, lastUser] : [lastUser];
}

function errorMessage(e: unknown): string {
 return e instanceof Error ? e.message : String(e);
}

export function mean(values: number[]): number {
 return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Harvest mode
// ---------------------------------------------------------------------------

async function runHarvest(
 corpus: CorpusEntry[],
 role: LlmRole,
 /**
  * The candidate harvest prompt, or undefined to use `propose()`'s own
  * `SYSTEM_PROMPT`. Forwarded to `propose()`'s `promptOverride`, which has
  * existed since ticket 034 — this script warned for months that it did not,
  * and therefore ran every harvest A/B against the DEFAULT prompt while
  * reporting a keep-or-revert verdict, which is worse than not running.
  */
 promptOverride?: string,
 /**
  * Generation-time shape constraint (ticket 078): sent as response_format
  * on every call when provided, so a malformed cut list cannot be emitted.
  */
 responseFormat?: ResponseFormat
): Promise<{ perExchange: HarvestExchangeMetrics[]; aggregate: HarvestAggregate; erroredExchanges: number }> {
 const complete = makeComplete(role, responseFormat !== undefined ? { responseFormat } : undefined);
 const perExchange: HarvestExchangeMetrics[] = [];
 let erroredExchanges = 0;
 const timeoutMs = modelTimeoutMs();

 for (const entry of corpus) {
  const timed: Complete = async (system, turns, opts) =>
   callWithTimeout(
    () => complete(system, turns, opts),
    timeoutMs,
    `harvest exchange "${entry.session}"`
   );

  try {
   // Cut counts come from propose()'s diagnostics. Since ticket 034 the
   // harvest runs one call per user turn, so the last raw output covers
   // only the last turn — counting from it would under-report.
   const { proposals, buds, diagnostics } = await propose(entry.session, entry.turns, timed, promptOverride);
   const totalCuts = diagnostics.cutsSeen;
   const fabricatedCuts = diagnostics.fabricationDrops;

   const facetDistribution: Record<string, number> = {};
   for (const p of proposals) {
    facetDistribution[p.facet] = (facetDistribution[p.facet] ?? 0) + 1;
   }

   perExchange.push({
    session: entry.session,
    totalCuts,
    fabricatedCuts,
    fabricationRate: totalCuts === 0 ? 0 : fabricatedCuts / totalCuts,
    proposalCount: proposals.length,
    facetDistribution,
    buds: buds.length,
    parseMode: diagnostics.parseMode,
    chunks: diagnostics.chunks,
    chunksParsed: diagnostics.chunksParsed,
    chunkErrors: diagnostics.chunkErrors,
    parseRate: diagnostics.chunks === 0 ? 0 : diagnostics.chunksParsed / diagnostics.chunks,
    returnedParseRate:
     diagnostics.chunks - diagnostics.chunkErrors === 0
      ? 0
      : diagnostics.chunksParsed / (diagnostics.chunks - diagnostics.chunkErrors),
   });
  } catch (e) {
   erroredExchanges++;
   perExchange.push({
    session: entry.session,
    totalCuts: 0,
    fabricatedCuts: 0,
    fabricationRate: 0,
    proposalCount: 0,
    facetDistribution: {},
    buds: 0,
    parseMode: 'failed',
    chunks: 0,
    chunksParsed: 0,
    chunkErrors: 0,
    parseRate: 0,
    returnedParseRate: 0,
    error: errorMessage(e),
   });
  }
 }

 const ok = perExchange.filter((e) => e.error === undefined);
 const totalCuts = ok.reduce((s, e) => s + e.totalCuts, 0);
 const totalFabricated = ok.reduce((s, e) => s + e.fabricatedCuts, 0);
 const facetDistribution: Record<string, number> = {};
 for (const e of ok) {
  for (const [facet, count] of Object.entries(e.facetDistribution)) {
   facetDistribution[facet] = (facetDistribution[facet] ?? 0) + count;
  }
 }
 const chunks = ok.reduce((s, e) => s + e.chunks, 0);
 const parsed = ok.reduce((s, e) => s + e.chunksParsed, 0);
 const returned = ok.reduce((s, e) => s + (e.chunks - e.chunkErrors), 0);
 const parseModes: Record<string, number> = {};
 for (const e of ok) {
  parseModes[e.parseMode] = (parseModes[e.parseMode] ?? 0) + 1;
 }

 return {
  perExchange,
  aggregate: {
   totalCuts,
   fabricationRate: totalCuts === 0 ? 0 : totalFabricated / totalCuts,
   facetDistribution,
   meanProposalCount: mean(ok.map((e) => e.proposalCount)),
   parseRate: chunks === 0 ? 0 : parsed / chunks,
   returnedParseRate: returned === 0 ? 0 : parsed / returned,
   parseModes,
  },
  erroredExchanges,
 };
}

// ---------------------------------------------------------------------------
// Probe mode
// ---------------------------------------------------------------------------

async function runProbe(
 corpus: CorpusEntry[],
 systemPrompt: string,
 role: LlmRole
): Promise<{ perExchange: ProbeExchangeMetrics[]; aggregate: ProbeAggregate; erroredExchanges: number }> {
 const complete = makeComplete(role);
 const perExchange: ProbeExchangeMetrics[] = [];
 let erroredExchanges = 0;
 const timeoutMs = modelTimeoutMs();

 // Run-wide accumulation (distinctFrameCount needs every probe first).
 const frames: string[] = [];
 const earlierProbeTexts: string[] = [];

 for (const entry of corpus) {
  const pair = lastExchangePair(entry.turns);
  const answerTurn = [...entry.turns].reverse().find((t) => t.role === 'user');
  const answerText = answerTurn?.text ?? '';
  const messages: Turn[] = pair.map((t) => ({
   role: 'user',
   text: `User said: ${t.text}`,
   at: t.at,
  }));

  try {
   const probeText = await callWithTimeout(
    () => complete(systemPrompt, messages),
    timeoutMs,
    `probe exchange "${entry.session}"`
   );
   const frame = frameOf(probeText);
   frames.push(frame);
   const repeatRate = earlierProbeTexts.includes(probeText) ? 1 : 0;
   earlierProbeTexts.push(probeText);

   perExchange.push({
    session: entry.session,
    probeText,
    distinctFrameCount: 0, // filled after the loop (run-wide)
    frames: [frame],
    repeatRate,
    conversationReferenceRate: referencesConversation(probeText) ? 1 : 0,
    echoRate: echoRateOf(probeText, answerText),
   });
  } catch (e) {
   erroredExchanges++;
   perExchange.push({
    session: entry.session,
    probeText: '',
    distinctFrameCount: 0,
    frames: [],
    repeatRate: 0,
    conversationReferenceRate: 0,
    echoRate: 0,
    error: errorMessage(e),
   });
  }
 }

 const distinctFrames = new Set(frames).size;
 for (const ex of perExchange) {
  ex.distinctFrameCount = distinctFrames;
 }

 const ok = perExchange.filter((e) => e.error === undefined);
 return {
  perExchange,
  aggregate: {
   distinctFrames,
   meanRepeatRate: mean(ok.map((e) => e.repeatRate)),
   meanConversationReferenceRate: mean(ok.map((e) => e.conversationReferenceRate)),
   meanEchoRate: mean(ok.map((e) => e.echoRate)),
  },
  erroredExchanges,
 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
 const mode = argValue('mode');
 const promptPath = argValue('prompt');
 const roleArg = argValue('role');

 if (mode !== 'harvest' && mode !== 'probe') {
  console.error(
   'Usage: npx tsx scripts/ratchet/run.ts --mode harvest|probe [--prompt <path>] [--role clerk|elicitor]'
  );
  process.exitCode = 1;
  return;
 }

 if (roleArg !== undefined && roleArg !== 'clerk' && roleArg !== 'elicitor') {
  console.error(`ERROR: --role must be clerk or elicitor, got "${roleArg}".`);
  process.exitCode = 1;
  return;
 }

 // Each mode measures the role that runs it in production (Q-48).
 const role: LlmRole = roleArg ?? (mode === 'harvest' ? 'clerk' : 'elicitor');
 const cfg = roleConfig(role);
 console.error(`Measuring the ${role} role: ${cfg.modelId} at ${cfg.baseUrl}.`);

 let corpus: CorpusEntry[];
 try {
  corpus = loadCorpus();
 } catch (e) {
  console.error(`ERROR: failed to load corpus: ${errorMessage(e)}`);
  process.exitCode = 1;
  return;
 }

 if (mode === 'harvest') {
  // `propose()` has taken a `promptOverride` since ticket 034. This branch
  // used to warn that it did not and run the default prompt anyway, which
  // meant every harvest A/B compared the default against itself and reported
  // a keep-or-revert verdict on the result. Ticket 032's ratchet was silently
  // measuring nothing. Found by ticket 037, 2026-08-02.
  let harvestPrompt: string | undefined;
  if (promptPath !== undefined) {
   try {
    harvestPrompt = readFileSync(promptPath, 'utf8');
   } catch (e) {
    console.error(`ERROR: cannot read --prompt file ${promptPath}: ${errorMessage(e)}`);
    process.exitCode = 1;
    return;
   }
  }
  // Ticket 078: constrain the cuts payload's shape at generation. The
  // schema is exported from harvester.ts so the measured artifact is the
  // production artifact, never a copy.
  let responseFormat: ResponseFormat | undefined;
  const schemaPath = argValue('schema');
  const constrained = process.argv.slice(2).includes('--constrained');
  if (schemaPath !== undefined) {
   try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
    responseFormat = {
     type: 'json_schema',
     json_schema: { name: 'harvest_cuts', strict: true, schema },
    };
   } catch (e) {
    console.error(`ERROR: cannot read --schema file ${schemaPath}: ${errorMessage(e)}`);
    process.exitCode = 1;
    return;
   }
  } else if (constrained) {
   responseFormat = CUTS_RESPONSE_FORMAT;
  }
  const result = await runHarvest(corpus, role, harvestPrompt, responseFormat);
  console.log(
   JSON.stringify(
    {
     mode: 'harvest',
     prompt: promptPath ?? 'default (propose SYSTEM_PROMPT)',
     constrained: responseFormat !== undefined,
     timeoutMs: modelTimeoutMs(),
     role,
     model: cfg.modelId,
     baseUrl: cfg.baseUrl,
     ...result,
    },
    null,
    2
   )
  );
  return;
 }

 // probe mode
 let systemPrompt = DEFAULT_PROBE_PROMPT;
 if (promptPath !== undefined) {
  try {
   systemPrompt = readFileSync(promptPath, 'utf8');
  } catch (e) {
   console.error(`ERROR: cannot read --prompt file ${promptPath}: ${errorMessage(e)}`);
   process.exitCode = 1;
   return;
  }
 }
 const result = await runProbe(corpus, systemPrompt, role);
 console.log(
  JSON.stringify(
   {
    mode: 'probe',
    prompt: promptPath ?? 'default (hardcoded probe prompt)',
    timeoutMs: modelTimeoutMs(),
    role,
    model: cfg.modelId,
    baseUrl: cfg.baseUrl,
    ...result,
   },
   null,
   2
  )
 );
}

// Run only when executed directly (not when imported by tests).
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
 main().catch((e) => {
  console.error(`ERROR: ${errorMessage(e)}`);
  process.exitCode = 1;
 });
}
