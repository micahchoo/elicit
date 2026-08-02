// ---------------------------------------------------------------------------
// Acceptance for ticket 043 — the role split is real, not nominal (Q-48).
//
//   npx tsx scripts/accept-043.ts [--reps 3]
//
// Four phases, each printing a JSON line to stdout:
//   endpoints — both role endpoints answer, and each serves its own model only
//   elicitor  — probe-shaped call latency on the foreground endpoint
//   clerk     — harvest latency PER CHUNK, warm, on the background endpoint
//   wiring    — a real sitting through createApp: which role answered what,
//               how long each took, and which model the Cover summary names
//
// Nothing here asserts a threshold. It measures, and prints what it measured.
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { makeComplete, roleConfig, type LlmRole } from '../src/llm.js';
import { propose } from '../src/harvester/harvester.js';
import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import type { Complete, Turn } from '../src/types.js';

const REPS = Number(
  process.argv.slice(2).find((a) => a.startsWith('--reps='))?.slice('--reps='.length) ?? '3',
);

const PROBE_PROMPT =
  'You are conducting a reflective interview. Ask the one question a good interviewer would ask next. One question, one sentence, no preamble.';

const ANSWER =
  'I keep choosing the work that looks impressive over the work that actually holds my attention, and I have started to notice the cost.';

function say(phase: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ phase, ...data }));
}

function turn(text: string): Turn {
  return { role: 'user', text, at: new Date().toISOString() };
}

// ── Phase 1: both endpoints up, and each one serves only its own model ──

async function endpoints(): Promise<boolean> {
  let bothUp = true;
  const seen: Record<LlmRole, string[]> = { elicitor: [], clerk: [] };

  for (const role of ['elicitor', 'clerk'] as const) {
    const cfg = roleConfig(role);
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
      const body = (await res.json()) as { data?: { id: string }[] };
      seen[role] = (body.data ?? []).map((m) => m.id);
      const serves = seen[role].includes(cfg.modelId);
      say('endpoints', { role, baseUrl: cfg.baseUrl, model: cfg.modelId, up: res.ok, servesItsModel: serves });
      if (!res.ok || !serves) bothUp = false;
    } catch (err) {
      say('endpoints', { role, baseUrl: cfg.baseUrl, model: cfg.modelId, up: false, error: String(err) });
      bothUp = false;
    }
  }

  // The split is only real if the two endpoints are different backends: each
  // must NOT serve the other role's model.
  say('endpoints', {
    distinctBackends:
      roleConfig('elicitor').baseUrl !== roleConfig('clerk').baseUrl &&
      !seen.elicitor.includes(roleConfig('clerk').modelId) &&
      !seen.clerk.includes(roleConfig('elicitor').modelId),
  });
  return bothUp;
}

// ── Phase 2: foreground latency ──

async function elicitorLatency(): Promise<void> {
  const cfg = roleConfig('elicitor');
  const complete = makeComplete('elicitor');
  const ms: number[] = [];
  let sample = '';

  for (let i = 0; i <= REPS; i++) {
    const t0 = Date.now();
    try {
      sample = await complete(PROBE_PROMPT, [turn(ANSWER)]);
    } catch (err) {
      say('elicitor', { model: cfg.modelId, baseUrl: cfg.baseUrl, error: String(err) });
      return;
    }
    // The first call warms the endpoint; it is reported apart from the rest.
    ms.push(Date.now() - t0);
  }

  say('elicitor', {
    model: cfg.modelId,
    baseUrl: cfg.baseUrl,
    cold_ms: ms[0],
    warm_ms: ms.slice(1),
    warm_mean_ms: Math.round(ms.slice(1).reduce((s, v) => s + v, 0) / (ms.length - 1)),
    sample: sample.slice(0, 120),
  });
}

// ── Phase 3: harvest per chunk on the background endpoint ──
// The open question on the ticket: is the clerk model too slow to harvest a
// long sitting? propose() makes one call per user turn, so one call is one
// chunk, and a sitting costs this many times its harvestable turns.

async function clerkHarvestLatency(): Promise<void> {
  const cfg = roleConfig('clerk');
  const complete: Complete = makeComplete('clerk');
  const ms: number[] = [];
  let lastCuts = 0;
  let lastParsed = false;

  for (let i = 0; i <= REPS; i++) {
    const t0 = Date.now();
    try {
      const { proposals, diagnostics } = await propose('accept-043', [turn(ANSWER)], complete);
      lastCuts = proposals.length;
      lastParsed = diagnostics.parsed;
    } catch (err) {
      say('clerk', { model: cfg.modelId, baseUrl: cfg.baseUrl, error: String(err) });
      return;
    }
    ms.push(Date.now() - t0);
  }

  const warm = ms.slice(1);
  const mean = Math.round(warm.reduce((s, v) => s + v, 0) / warm.length);
  say('clerk', {
    model: cfg.modelId,
    baseUrl: cfg.baseUrl,
    cold_ms: ms[0],
    warm_ms: warm,
    warm_mean_per_chunk_ms: mean,
    parsed: lastParsed,
    cuts: lastCuts,
    projected_8_turn_sitting_ms: mean * 8,
  });
}

// ── Phase 4: the wiring, end to end, against both real models ──

async function wiring(): Promise<void> {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-043-'));
  const vault = createVault(vaultDir);

  // Two prior sittings: enough for the docket to mint openers and consolidate.
  for (const [session, prose] of [
    ['prior-one', 'I have never regretted the weeks I spent away from a screen.'],
    ['prior-two', 'My father measured a good life by how early you left the house.'],
  ] as const) {
    const at = new Date().toISOString();
    vault.startTranscript(session, {
      mode: { minutes: 25, energy: 'medium', target: 'self' },
      protocol: 'reflective',
      started: at,
    });
    vault.appendTurn(session, { role: 'user', text: prose, at });
    vault.saveSnippet(prose, {
      kind: 'harvest',
      session,
      question: 'What has been on your mind?',
      questionForm: 'deliberative',
    });
  }

  const calls: { role: LlmRole; ms: number }[] = [];
  const timed = (role: LlmRole): Complete => {
    const inner = makeComplete(role);
    return async (system, turns, opts) => {
      const t0 = Date.now();
      try {
        return await inner(system, turns, opts);
      } finally {
        calls.push({ role, ms: Date.now() - t0 });
      }
    };
  };

  let settled = 0;
  const app = await createApp({
    vault,
    complete: timed('elicitor'),
    clerk: { complete: timed('clerk'), modelName: roleConfig('clerk').modelId },
    queue: createQueueStore(vaultDir),
    index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
    vaultRoot: vaultDir,
    authStore: createFileAuth(join(vaultDir, '.auth.json')),
    modelName: roleConfig('elicitor').modelId,
    onDocketSettled: () => {
      settled++;
    },
  });

  const post = async (path: string, body?: unknown): Promise<Response> => {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { remoteAddr: '127.0.0.1' },
    );
    if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
    return res;
  };

  const bootStart = Date.now();
  while (settled < 1) await new Promise((r) => setTimeout(r, 200));
  const bootDocketMs = Date.now() - bootStart;
  const afterBoot = calls.length;

  // A sitting. Every turn here has a person waiting on it.
  const sessRes = await post('/api/session', { mode: { minutes: 10, energy: 'medium', target: 'self' } });
  const { sessionId } = (await sessRes.json()) as { sessionId: string };

  const turnMs: number[] = [];
  for (const text of [ANSWER, 'The applause fades in a day and the work stays for a year.']) {
    const t0 = Date.now();
    await post(`/api/session/${sessionId}/turn`, { text });
    turnMs.push(Date.now() - t0);
  }
  const sittingCalls = calls.slice(afterBoot);
  const afterSitting = calls.length;

  // Harvest: extraction is the clerk's, and so is the docket behind it.
  const t0 = Date.now();
  const endRes = await post(`/api/session/${sessionId}/end`);
  const { proposals } = (await endRes.json()) as { proposals: unknown[] };
  const endMs = Date.now() - t0;

  const beforeHarvest = settled;
  const t1 = Date.now();
  await post(`/api/session/${sessionId}/harvest`, {
    decisions: proposals.map((_, i) => ({ proposal: i, action: 'approve' })),
  });
  const harvestMs = Date.now() - t1;

  while (settled < beforeHarvest + 1) await new Promise((r) => setTimeout(r, 200));
  const docketTailMs = Date.now() - t1 - harvestMs;
  const harvestCalls = calls.slice(afterSitting);

  // Which sittings get bracketed depends on how many exist by the time the
  // docket runs, so read whatever summaries the run actually wrote.
  const summaryDir = join(vaultDir, 'marginalia', 'transcript-summaries');
  const coverStamps = existsSync(summaryDir)
    ? readdirSync(summaryDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => String(matter(readFileSync(join(summaryDir, f), 'utf-8')).data.model))
    : [];

  const roleOf = (list: { role: LlmRole; ms: number }[]) => [...new Set(list.map((c) => c.role))];
  const meanOf = (list: { role: LlmRole; ms: number }[]) =>
    list.length === 0 ? 0 : Math.round(list.reduce((s, c) => s + c.ms, 0) / list.length);

  say('wiring', {
    vault: vaultDir,
    boot_docket_ms: bootDocketMs,
    boot_docket_roles: roleOf(calls.slice(0, afterBoot)),
    sitting_roles: roleOf(sittingCalls),
    sitting_turn_ms: turnMs,
    sitting_call_mean_ms: meanOf(sittingCalls),
    end_propose_ms: endMs,
    proposals: proposals.length,
    harvest_response_ms: harvestMs,
    harvest_docket_tail_ms: docketTailMs,
    harvest_phase_roles: roleOf(harvestCalls),
    harvest_phase_call_mean_ms: meanOf(harvestCalls),
    cover_stamps: coverStamps,
    cover_stamps_all_clerk_model:
      coverStamps.length > 0 && coverStamps.every((m) => m === roleConfig('clerk').modelId),
    docket_events: readEvents(vaultDir).filter((e) => e.kind === 'docket-run').length,
  });
}

/** `--only=elicitor,wiring` runs those phases; absent, everything runs. */
const only = process.argv
  .slice(2)
  .find((a) => a.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',');
const wanted = (phase: string): boolean => only === undefined || only.includes(phase);

const up = await endpoints();
if (!up) {
  console.error('One endpoint is down. Latency and wiring phases would measure nothing — stopping.');
  process.exitCode = 1;
} else {
  if (wanted('elicitor')) await elicitorLatency();
  if (wanted('clerk')) await clerkHarvestLatency();
  if (wanted('wiring')) await wiring();
}
