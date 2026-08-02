import type { Complete, Turn, CutProposal, Bud, HarvestDecision, Vault, Snippet, Provenance } from '../types.js';

// ---------------------------------------------------------------------------
// System prompt for harvest cut proposal
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a harvesting agent for Elicit. Your job: extract verbatim substrings from user turns that could stand alone as independent Snippets.

Given a transcript, return a JSON object with a "cuts" array. Each cut has:
- "text": exact substring of a user turn (verbatim, no edits — copy character-for-character)
- "sourceTurn": index of the user turn this came from (0-based, counting only user turns)
- "facet": one of "episode", "general-event", "lifetime-period", "fact", "construct", "intention", "value", "causal-theory"
- "stance": one of "avowal", "self-observation", "report-of-fact", "pole-preference", "commitment", "uncertainty-marked", "superseded"
- "reading": a one-line interpretation of what this fragment says about the user (agent prose)
- "standalone": boolean — can this fragment be understood without the surrounding transcript exchange?

Do not fabricate text. Every "text" must be an exact substring of some user turn.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function propose(
  session: string,
  transcript: Turn[],
  complete: Complete
): Promise<{ proposals: CutProposal[]; buds: Bud[] }> {
  const raw = await complete(SYSTEM_PROMPT, transcript, { temperature: 0.1 });

  // Parse — try JSON first, fall back to line-oriented
  let cuts: RawCut[];
  try {
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned);
    cuts = Array.isArray(parsed.cuts) ? parsed.cuts : [];
  } catch {
    // JSON parse failed — attempt line-oriented fallback
    cuts = parseLineOriented(raw);
  }

  // Collect user turns for substring validation
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

    // Sole Authorship invariant: must be an exact substring of some user turn
    const foundIn = userTurns.find((u) => u.turn.text.includes(cut.text!));
    if (!foundIn) {
      console.warn(
        `Harvester: dropped fabricated cut — "${cut.text}" is not a substring of any user turn`
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
    // Derive sourceTurn from transcript, not the model's number
    const derivedTurn = foundIn.userIdx;
    if (cut.sourceTurn !== derivedTurn) {
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

  // ── Deduplicate proposals ──
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

  return { proposals: deduped, buds };
}

export function decide(
  session: string,
  proposals: CutProposal[],
  decisions: HarvestDecision[],
  vault: Vault
): { snippets: Snippet[]; buds: Bud[] } {
  const snippets: Snippet[] = [];

  for (const decision of decisions) {
    const proposal = proposals[decision.proposal];
    if (!proposal) { console.warn(`Harvester decide: proposal index ${decision.proposal} out of range (have ${proposals.length})`); continue; }
    const provenance: Provenance = {
      kind: 'harvest',
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
