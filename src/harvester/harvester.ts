import type { Complete, Turn, CutProposal, Bud, HarvestDecision, Vault, Snippet, Provenance } from '../types.js';

// ---------------------------------------------------------------------------
// System prompt for harvest cut proposal
// ---------------------------------------------------------------------------

// One user turn per call. Whole-transcript extraction collapses on this class
// of local model at 3+ user turns — it echoes the tail of the conversation
// instead of emitting cuts (ticket 034, eval finding #1). Single-turn
// extraction is the configuration measured to hold.
const SYSTEM_PROMPT = `You are a harvesting agent for Elicit. Your job: extract verbatim substrings from the user's message that could stand alone as independent Snippets.

You are given ONE message from the user. Return a JSON object with a "cuts" array. Each cut has:
- "text": exact substring of that message (verbatim, no edits — copy character-for-character)
- "sourceTurn": always 0
- "facet": one of "episode", "general-event", "lifetime-period", "fact", "construct", "intention", "value", "causal-theory"
- "stance": one of "avowal", "self-observation", "report-of-fact", "pole-preference", "commitment", "uncertainty-marked", "superseded"
- "reading": a one-line interpretation of what this fragment says about the user (agent prose)
- "standalone": boolean — can this fragment be understood without the surrounding transcript exchange?

Do not fabricate text. Every "text" must be an exact substring of the user's message.
Return ONLY valid JSON. No markdown fences. No commentary.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips markdown code fences from LLM output, keeping the inner content. */
function stripFences(raw: string): string {
  let s = raw.trim();
  // strip opening ```json or ```
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  // strip closing ```
  s = s.replace(/\n?```\s*$/, '');
  return s.trim();
}

/** Find the agent turn that elicited a given user turn index (0-based in user-turn space). */
function findElicitingProbe(
  transcript: Turn[],
  sourceTurn: number
): Turn | undefined {
  let userIdx = 0;
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i]!;
    if (turn.role === 'user') {
      if (userIdx === sourceTurn) {
        // The agent turn immediately before this user turn is the eliciting probe
        if (i > 0 && transcript[i - 1]!.role === 'agent') {
          return transcript[i - 1];
        }
        return undefined;
      }
      userIdx++;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Line-oriented fallback parser
// ---------------------------------------------------------------------------

interface RawCut {
  text?: string;
  sourceTurn?: number;
  facet?: string;
  stance?: string;
  reading?: string;
  standalone?: boolean;
}

function parseLineOriented(raw: string): RawCut[] {
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
          // Strip surrounding quotes if present
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

/**
 * Parse one chunk's raw output. `mode` records how it parsed so that a failed
 * parse and a genuinely empty answer never look alike downstream (ticket 034).
 * A line-oriented result counts as parsed only if it carries at least one
 * `text` — prose with stray colons in it otherwise reads as a successful parse.
 */
function parseChunk(raw: string): { cuts: RawCut[]; mode: ParseMode } {
  try {
    const parsed: unknown = JSON.parse(stripFences(raw));
    if (parsed !== null && typeof parsed === 'object') {
      const maybe = (parsed as { cuts?: unknown }).cuts;
      if (Array.isArray(maybe)) return { cuts: maybe as RawCut[], mode: 'json' };
    }
  } catch {
    // fall through to the line-oriented fallback
  }

  const cuts = parseLineOriented(raw).filter((c) => typeof c.text === 'string' && c.text.length > 0);
  return cuts.length > 0
    ? { cuts, mode: 'line-oriented' }
    : { cuts: [], mode: 'failed' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ParseMode = 'json' | 'line-oriented' | 'failed';

/**
 * What the harvest run actually did, in counts and flags only — never user
 * content. The Activity Log carries these so "the parser failed" and "the
 * sitting was genuinely thin" can never be logged identically (ticket 034).
 */
export type HarvestDiagnostics = {
  /** Total characters of raw model output across all chunks. */
  rawChars: number;
  /** True when at least one chunk's output parsed into cuts. */
  parsed: boolean;
  /** 'json' when every parsed chunk was clean JSON; 'failed' when none parsed. */
  parseMode: ParseMode;
  /** Cut objects the parser produced, before any validation dropped them. */
  cutsSeen: number;
  /** Cuts dropped because the text was not an exact substring of its turn. */
  fabricationDrops: number;
  /** Cuts whose model-claimed sourceTurn differed from the derived one. */
  sourceTurnCorrections: number;
  /** User turns sent — one complete() call each. */
  chunks: number;
  /** Chunks whose output parsed. */
  chunksParsed: number;
  /** Chunks where complete() threw; the remaining chunks still harvest. */
  chunkErrors: number;
};

export async function propose(
  session: string,
  transcript: Turn[],
  complete: Complete,
  /** Prompt variant under test by the ratchet harness (scripts/ratchet). */
  promptOverride?: string,
): Promise<{ proposals: CutProposal[]; buds: Bud[]; diagnostics: HarvestDiagnostics }> {
  // Collect user turns. Each becomes its own extraction call, so the message
  // list is always exactly one user turn — user-last by construction (llama.cpp
  // generates nothing when the list ends with an assistant turn), and trailing
  // agent turns drop out because they carry no harvestable text.
  const userTurns: { turn: Turn; userIdx: number }[] = [];
  let userIdx = 0;
  for (const turn of transcript) {
    if (turn.role === 'user') {
      userTurns.push({ turn, userIdx });
      userIdx++;
    }
  }

  const proposals: CutProposal[] = [];
  const buds: Bud[] = [];
  let rawChars = 0;
  let chunksParsed = 0;
  let chunkErrors = 0;
  let anyLineOriented = false;
  let cutsSeen = 0;
  let fabricationDrops = 0;
  let sourceTurnCorrections = 0;

  // Sequential: the local model is a single GPU, so parallel chunks buy
  // nothing and cost tail latency.
  for (const { turn, userIdx: derivedTurn } of userTurns) {
    let raw: string;
    try {
      raw = await complete(promptOverride ?? SYSTEM_PROMPT, [turn], { temperature: 0.1 });
    } catch (err) {
      // One chunk failing must not zero the whole harvest.
      chunkErrors++;
      console.warn(`Harvester: extraction failed for user turn ${derivedTurn}: ${String(err)}`);
      continue;
    }
    rawChars += raw.length;

    const { cuts, mode } = parseChunk(raw);
    if (mode === 'failed') {
      console.warn(`Harvester: user turn ${derivedTurn} produced no parsable cuts (${raw.length} chars)`);
      continue;
    }
    chunksParsed++;
    if (mode === 'line-oriented') anyLineOriented = true;
    cutsSeen += cuts.length;

    for (const cut of cuts) {
      // Required fields check
      if (
        typeof cut.text !== 'string' ||
        cut.text.length === 0 ||
        typeof cut.sourceTurn !== 'number' ||
        typeof cut.facet !== 'string' ||
        typeof cut.stance !== 'string' ||
        typeof cut.reading !== 'string' ||
        typeof cut.standalone !== 'boolean'
      ) {
        continue;
      }

      // Sole Authorship invariant: must be an exact substring of THIS turn
      if (!turn.text.includes(cut.text)) {
        fabricationDrops++;
        console.warn(
          `Harvester: dropped fabricated cut — "${cut.text}" is not a substring of user turn ${derivedTurn}`
        );
        continue;
      }

      // Non-standalone → Bud
      if (!cut.standalone) {
        buds.push({
          id: generateBudId(),
          captured: new Date().toISOString(),
          session,
          failures: ['standalone'],
          fragment: cut.text,
        });
        continue;
      }

      // sourceTurn is derived from the chunk, never trusted from the model.
      // The chunk holds one turn, so the model is asked for 0 — anything else
      // is an instruction-following miss worth counting.
      if (cut.sourceTurn !== 0) {
        sourceTurnCorrections++;
        console.warn(
          `Harvester: model sourceTurn=${cut.sourceTurn} corrected to actual=${derivedTurn}`
        );
      }

      const probe = findElicitingProbe(transcript, derivedTurn);

      proposals.push({
        text: cut.text,
        sourceTurn: derivedTurn,
        facet: cut.facet as CutProposal['facet'],
        stance: cut.stance as CutProposal['stance'],
        reading: cut.reading,
        question: probe?.text ?? '',
        questionForm: probe?.questionForm ?? 'deliberative',
        ...(probe?.questionSource ? { questionSource: probe.questionSource } : {}),
      });
    }
  }

  const diagnostics: HarvestDiagnostics = {
    rawChars,
    // With no user turns there is nothing to parse and nothing failed.
    parsed: userTurns.length === 0 || chunksParsed > 0,
    parseMode:
      userTurns.length === 0 ? 'json'
        : chunksParsed === 0 ? 'failed'
          : anyLineOriented ? 'line-oriented' : 'json',
    cutsSeen,
    fabricationDrops,
    sourceTurnCorrections,
    chunks: userTurns.length,
    chunksParsed,
    chunkErrors,
  };

  // ── Deduplicate proposals (across chunks as well as within one) ──
  const deduped: CutProposal[] = [];
  for (const p of proposals) {
    // Exact dupe: skip
    if (deduped.some((d) => d.text === p.text)) continue;
    // Near-dupe (existing contains new or vice versa): keep the longer
    const nearIdx = deduped.findIndex(
      (d) => d.text.includes(p.text) || p.text.includes(d.text),
    );
    if (nearIdx >= 0) {
      if (p.text.length > deduped[nearIdx]!.text.length) {
        deduped[nearIdx] = p;
      }
      continue;
    }
    deduped.push(p);
  }

  return { proposals: deduped, buds, diagnostics };
}

export function decide(
  session: string,
  proposals: CutProposal[],
  decisions: HarvestDecision[],
  vault: Vault,
  /** Origin of the kept material. 'unprompted' when no question elicited it. */
  origin: 'harvest' | 'unprompted' = 'harvest'
): { snippets: Snippet[]; buds: Bud[] } {
  const snippets: Snippet[] = [];

  for (const decision of decisions) {
    const proposal = proposals[decision.proposal];
    if (!proposal) { console.warn(`Harvester decide: proposal index ${decision.proposal} out of range (have ${proposals.length})`); continue; }
    const provenance: Provenance = {
      kind: origin,
      session,
      question: proposal.question,
      questionForm: proposal.questionForm,
      ...(proposal.questionSource ? { questionSource: proposal.questionSource } : {}),
    };

    switch (decision.action) {
      case 'approve': {
        const snippet = vault.saveSnippet(proposal.text, provenance);
        // Reading carries only facet, stance, reading, cites (Q-4 — no questionForm)
        vault.saveReading({
          facet: proposal.facet,
          stance: proposal.stance,
          reading: proposal.reading,
          cites: [`${snippet.id}@1`],
        });
        snippets.push(snippet);
        break;
      }

      case 'trim': {
        if (!decision.text) continue;
        // Trim must be a substring of the proposal text
        if (!proposal.text.includes(decision.text)) continue;

        const snippet = vault.saveSnippet(decision.text, provenance);
        vault.saveReading({
          facet: proposal.facet,
          stance: proposal.stance,
          reading: proposal.reading,
          cites: [`${snippet.id}@1`],
        });
        snippets.push(snippet);
        break;
      }

      case 'restate': {
        if (!decision.text) continue;
        const restateProvenance: Provenance = {
          kind: 'restatement',
          session,
          question: proposal.question,
          questionForm: proposal.questionForm,
          ...(proposal.questionSource ? { questionSource: proposal.questionSource } : {}),
        };
        // Restatement is a NEW snippet — no reading created
        const snippet = vault.saveSnippet(decision.text, restateProvenance);
        snippets.push(snippet);
        break;
      }

      case 'discard':
        // Nothing to persist
        break;

      default:
        console.warn(`Harvester decide: unknown action "${String((decision as HarvestDecision).action)}" — skipping`);
    }
  }

  return { snippets, buds: [] };
}

// ---------------------------------------------------------------------------
// Internal ID generation (for buds before vault assignment)
// ---------------------------------------------------------------------------

function generateBudId(): string {
  return `bud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
