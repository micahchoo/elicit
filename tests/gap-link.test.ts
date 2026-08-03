import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { propose, decide } from '../src/harvester/harvester.js';
import { buildIndex } from '../src/index/lexical.js';
import { makeScriptedComplete } from './fakes.js';
import type { QueueStore } from '../src/types.js';

/**
 * The arrival test for the gap link (Q-39, Q-4). One gap id must survive
 * queue.add → the drawn opening turn → the answering turn → the cut proposal
 * → the decided snippet ON DISK. A test that only asserted the field
 * compiles would pass over a product where hop 2 was never written, so every
 * hop here goes through the real modules over a real vault.
 *
 * No hand-built Provenance appears anywhere in this file: the provenance is
 * the harvester's to build, and asserting our own construction would prove
 * hop 4 and nothing else.
 */

const tempRoot = mkdtempSync(join(tmpdir(), 'elicit-gap-link-'));

afterAll(() => {
 rmSync(tempRoot, { recursive: true, force: true });
});

/** Mint the entry T6's gap route will mint: no target, no topic, no facet. */
function mintGapEntry(queue: QueueStore, gapId: string) {
 return queue.add({
  source: 'gap-declared',
  gap: gapId,
  license: 'arrangement-gap',
  question: 'Why does that arrangement keep working for you?',
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'session',
 });
}

/** The one user turn this sitting produces, and the cut it is harvested as. */
const ANSWER =
 'The arrangement keeps working because nobody has to ask permission for the small moves.';

function cutsJson(text: string): string {
 return JSON.stringify({
  cuts: [
   {
    text,
    sourceTurn: 0,
    facet: 'causal-theory',
    stance: 'self-observation',
    reading: 'names the mechanism that keeps the arrangement working',
    standalone: true,
   },
  ],
 });
}

describe('the gap link end to end', () => {
 it('carries the gap id from queue.add to the approved snippet on disk', async () => {
  const vault = createVault(tempRoot);
  const queue = createQueueStore(tempRoot);
  const gapId = '01GAP000000000000000000000A';

  // Hop 1: the entry is minted for a gap — no target, no topic, no facet.
  const entry = mintGapEntry(queue, gapId);

  // Hop 2: the opening draw serves the entry, and the asking turn carries
  // the gap. The opener is canned material, so no model call happens here;
  // the scripted complete is what the answering turn below will consume.
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   {
    complete: makeScriptedComplete(['{}', 'What makes you say that?']),
    vault,
    queue,
    index: buildIndex([]),
    protocolName: 'cdm',
    vaultRoot: tempRoot,
   },
  );
  expect(session.turns[0]!.text).toBe(entry.question);
  expect(session.turns[0]!.gap).toBe(gapId);

  // Answer it: each userTurn consumes two complete calls — red lights, then
  // the generic probe.
  await userTurn(session, ANSWER);

  // Hop 3: the cut the harvest proposes names the gap its question asked.
  const { proposals } = await propose(session.id, session.turns, makeScriptedComplete([cutsJson(ANSWER)]));
  expect(proposals).toHaveLength(1);
  expect(proposals[0]!.gap).toBe(gapId);

  // Hop 4: the decided snippet keeps it — asserted on disk, not in memory.
  const { snippets } = decide(session.id, proposals, [{ proposal: 0, action: 'approve' }], vault, 'harvest');
  expect(snippets).toHaveLength(1);
  const onDisk = matter.read(join(tempRoot, 'snippets', snippets[0]!.id, 'v1.md'));
  expect(onDisk.data.provenance.kind).toBe('harvest');
  expect(onDisk.data.provenance.gap).toBe(gapId);
 });

 it('carries the gap id to the restated snippet on disk too', async () => {
  const vault = createVault(tempRoot);
  const queue = createQueueStore(tempRoot);
  const gapId = '01GAP000000000000000000000B';

  const entry = mintGapEntry(queue, gapId);

  const session = startSession(
   { minutes: 30, energy: 'medium' },
   {
    complete: makeScriptedComplete(['{}', 'What makes you say that?']),
    vault,
    queue,
    index: buildIndex([]),
    protocolName: 'cdm',
    vaultRoot: tempRoot,
   },
  );
  expect(session.turns[0]!.gap).toBe(gapId);

  await userTurn(session, ANSWER);

  const { proposals } = await propose(session.id, session.turns, makeScriptedComplete([cutsJson(ANSWER)]));
  expect(proposals[0]!.gap).toBe(gapId);

  // A restated answer to a gap question is still an answer to that gap: the
  // restate path is NOT optional (the plan names it so, and the person took
  // most care over exactly these words).
  const restated = 'The arrangement works because the small moves need no permission.';
  const { snippets } = decide(session.id, proposals, [{ proposal: 0, action: 'restate', text: restated }], vault, 'harvest');
  expect(snippets).toHaveLength(1);
  const onDisk = matter.read(join(tempRoot, 'snippets', snippets[0]!.id, 'v1.md'));
  expect(onDisk.data.provenance.kind).toBe('restatement');
  expect(onDisk.data.provenance.gap).toBe(gapId);
 });
});
