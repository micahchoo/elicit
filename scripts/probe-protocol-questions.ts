/**
 * Ticket 158 RESULTS check: protocols must now read distinct in the composed
 * channels — P1 (juxtaposition) and P2 (follow-up) carry the def body as the
 * sitting's method, so the questions a sitting actually asks differ per
 * protocol instead of being the same shape for all six.
 *
 * One fixture user turn per protocol, run through the REAL production model
 * via the same local-complete construction the server uses (src/llm.ts
 * makeComplete, ELICIT_LLM_* env convention). Prints each question under its
 * protocol's title. RESULTS-style: record, don't gate — run manually:
 *
 *   npx tsx scripts/probe-protocol-questions.ts
 *
 * Add `--dry` to print the composed system prompts (via a recording fake
 * complete) instead of calling the model — a wiring preflight that needs no
 * endpoint. Real-model runs can take minutes (cold-model warm-up measured at
 * ~370s, ticket 007); expect that on first use.
 */
import { makeComplete, roleConfig, describeRole } from '../src/llm.js';
import { loadProtocolDefinitions } from '../src/protocols/registry.js';
import { composeFollowUp, composeJuxtaposition } from '../src/clerk/composed.js';
import { machineQuestion, composeMachineSystemPrompt, type MachineState } from '../src/protocols/machine.js';
import type { Complete, RedLight, ResonanceHit, Turn } from '../src/types.js';

const DRY = process.argv.includes('--dry');

// ── Fixture: one turn, one snippet, a shared phrase verbatim in both ──
const TURN =
  'I keep catching myself hedging in whichever direction is socially cheaper, honestly.';
const SNIPPET = 'Hedging in whichever direction is socially cheaper is my reflex.';
const PHRASE = 'whichever direction is socially cheaper';

const light: RedLight = { kind: 'odd-term', phrase: PHRASE };
const hit: ResonanceHit = {
  snippetId: 'probe-fixture',
  version: 1,
  snippetText: SNIPPET,
  sharedPhrase: PHRASE,
  score: 1,
};

/** A Complete that also records every system prompt it was sent (dry mode). */
interface RecordingComplete extends Complete {
  prompts: string[];
}

/**
 * Dry-mode complete: records every system prompt, answers each channel with a
 * shape-valid question so the real gates accept it on the first try.
 */
function recordingComplete(): RecordingComplete {
  const prompts: string[] = [];
  const complete: RecordingComplete = async (
    system: string,
    _turns: Turn[],
  ) => {
    prompts.push(system);
    // Both channels demand the phrase verbatim inside quotation marks.
    return 'You wrote "whichever direction is socially cheaper" — what does that cost you?';
  };
  complete.prompts = prompts;
  return complete;
}

if (DRY) {
  console.log('DRY MODE: printing the composed system prompts, no model call.\n');
} else {
  console.log(`model: ${describeRole(roleConfig('elicitor'))}`);
  console.log(
    'Real-model run — each protocol costs two calls (P2 follow-up, P1 juxtaposition); a cold model adds minutes on the first call.\n',
  );
}

const recording = DRY ? recordingComplete() : null;
const complete: Complete = recording ?? makeComplete('elicitor');

const prompts = recording?.prompts ?? null;

for (const def of loadProtocolDefinitions().values()) {
  console.log(`\n=== ${def.name} ===`);
  const followUp = await composeFollowUp(TURN, light, complete, def);
  const juxtaposed = await composeJuxtaposition(TURN, hit, complete, undefined, def);
  if (DRY) {
    console.log('P2 follow-up system prompt:\n');
    console.log(prompts!.at(-2) ?? '');
    console.log('\nP1 juxtaposition system prompt:\n');
    console.log(prompts!.at(-1) ?? '');
  } else {
    console.log(`P2 follow-up: ${followUp ?? '(rejected twice — fell through)'}`);
    console.log(`P1 juxtaposition: ${juxtaposed ?? '(rejected twice — fell through)'}`);
  }
  // The phase machine (ticket 159): one question per phase, each a fresh
  // machine at that phase on the same fixture turn. Shows whether the
  // phases read as distinct instruments, not one reworded follow-up.
  if (def.phases && def.phases.length > 0) {
    console.log('\n  phases:');
    for (let i = 0; i < def.phases.length; i++) {
      const phase = def.phases[i]!;
      const state: MachineState = {
        protocol: def.name,
        phaseIndex: i,
        exchanges: def.phases.map(() => 0),
        startedAt: new Date().toISOString(),
      };
      if (DRY) {
        console.log(`  [${phase.id}] system prompt:\n${composeMachineSystemPrompt(def, state) ?? ''}`);
      } else {
        const q = await machineQuestion(state, def, [{ role: 'user', text: TURN, at: new Date().toISOString() }], complete);
        console.log(`  [${phase.id}] ${q ?? '(marker or empty)'}`);
      }
    }
  }
}
