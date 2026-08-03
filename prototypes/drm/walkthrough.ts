#!/usr/bin/env bun
/**
 * DRM prototype walkthrough — CLI demonstration of the flow.
 *
 * Runs the state machine through a mock interaction, printing the state
 * transitions and what the UI would show at each step. Pure output; no
 * imports from src/, no disk writes.
 *
 * Run: bun prototypes/drm/walkthrough.ts
 */

import { initDRM, reduceDRM, fragmentText, type DRMAction, type DRMMessage } from './logic.js';

// ── Mock yesterday ──
const YESTERDAY = '2026-08-02';

// ── Mock interaction script ──
type ScriptStep = { label: string; action: DRMAction };

const script: ScriptStep[] = [
  { label: 'User opens the DRM instrument',                   action: { kind: 'begin', yesterday: YESTERDAY } },
  { label: 'User names first episode',                        action: { kind: 'add-episode', name: 'morning coffee', startHour: 7 } },
  { label: 'User names second episode',                       action: { kind: 'add-episode', name: 'commute to work', startHour: 8 } },
  { label: 'User names third episode',                        action: { kind: 'add-episode', name: 'morning deep work', startHour: 9 } },
  { label: 'User names fourth episode',                       action: { kind: 'add-episode', name: 'lunch with Mira', startHour: 12 } },
  { label: 'User signals enumeration done',                   action: { kind: 'done-enumerating' } },

  // Episode 1: morning coffee
  { label: 'Answers place probe',                             action: { kind: 'answer', text: 'kitchen table, by the window' } },
  { label: 'Answers activity probe',                          action: { kind: 'answer', text: 'drinking pour-over, reading news and a few pages of Austerlitz' } },
  { label: 'Answers who-with probe',                          action: { kind: 'answer', text: 'alone — the apartment was still quiet' } },
  { label: 'Answers affect probe',                            action: { kind: 'answer', text: 'calm and present, a little groggy but optimistic. the light through the window was good.' } },
  { label: 'Gate: continue to next episode',                  action: { kind: 'gate', choice: 'continue' } },

  // Episode 2: commute
  { label: 'Answers place probe',                             action: { kind: 'answer', text: 'the B train, standing room only' } },
  { label: 'Answers activity probe',                          action: { kind: 'answer', text: 'standing, listening to a podcast about Roman logistics' } },
  { label: 'Answers who-with probe',                          action: { kind: 'answer', text: 'strangers — no one I knew' } },
  { label: 'Answers affect probe',                            action: { kind: 'answer', text: 'mildly irritated by the crowd, but the podcast was absorbing enough to tune it out' } },
  { label: 'Gate: park here',                                 action: { kind: 'gate', choice: 'park' } },

  // Resume from parked state
  // (In real flow, the parkState would be persisted to disk and read back;
  //  here we take it from the parked state directly.)
  { label: '--- RESUMING LATER ---',                          action: null as unknown as DRMAction },

  // Episode 3: morning deep work
  { label: 'Answers place probe',                             action: { kind: 'answer', text: 'office desk, facing the wall' } },
  { label: 'Answers activity probe',                          action: { kind: 'answer', text: 'refactoring a data pipeline — the join logic was wrong' } },
  { label: 'Answers who-with probe',                          action: { kind: 'answer', text: 'alone, with Slack pings I ignored' } },
  { label: 'Answers affect probe',                            action: { kind: 'answer', text: 'focused and frustrated in equal measure. the frustration was productive — it meant I was close.' } },
  { label: 'Gate: continue to last episode',                  action: { kind: 'gate', choice: 'continue' } },

  // Episode 4: lunch with Mira
  { label: 'Answers place probe',                             action: { kind: 'answer', text: 'the Lebanese place on 14th, corner booth' } },
  { label: 'Answers activity probe',                          action: { kind: 'answer', text: 'eating shawarma, talking about her residency application' } },
  { label: 'Answers who-with probe',                          action: { kind: 'answer', text: 'Mira — old friend from college' } },
  { label: 'Answers affect probe',                            action: { kind: 'answer', text: 'warm and attentive. I was happy to be useful — she wanted my take on her personal statement.' } },
  { label: 'Gate: continue (last episode → complete)',        action: { kind: 'gate', choice: 'continue' } },
];

// ── Run ──

let state = initDRM();

function printHeader(s: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${s}`);
  console.log('═'.repeat(60));
}

function printMsg(m: DRMMessage) {
  switch (m.kind) {
    case 'intro':
      console.log('\n  Welcome. We will walk through yesterday, episode by episode.');
      console.log('  Name each block of time — where you were and what you were doing.');
      console.log('  There are no wrong answers. The shape of your day is the signal.\n');
      break;
    case 'ask-episode':
      if (m.count === 0) {
        console.log('  ▶ What was the first episode of your day?  Name it and give the hour it started.');
      } else {
        console.log(`  ▶ Episode ${m.count} named.  Next one, or say "done" when you have named them all.`);
      }
      break;
    case 'probe-question':
      console.log(`\n  ┌─ ${m.episode}`);
      console.log(`  │  ${m.question}`);
      break;
    case 'gate': {
      const lines = fragmentText(m.fragment).split('\n');
      console.log(`\n  ┌─ FRAGMENT ─────────────────────────`);
      for (const l of lines) console.log(`  │ ${l}`);
      console.log(`  └────────────────────────────────────`);
      if (m.atEnd) {
        console.log('  ■ Last episode complete.  [continue] [park for now] [another day]');
      } else {
        console.log('  ■ Gate:  [continue] [park for now] [another day]');
      }
      break;
    }
    case 'parked':
      console.log(`\n  ◈ Parked at "${m.atEpisode}" — state saved for later.`);
      break;
    case 'complete':
      console.log('\n  ◆ Day reconstruction complete.');
      console.log(`  ◆ ${m.fragments.length} episode${m.fragments.length === 1 ? '' : 's'} captured.\n`);
      for (const f of m.fragments) {
        console.log(fragmentText(f));
        console.log('');
      }
      break;
    case 'error':
      console.log(`  ⚠ ERROR: ${m.msg}`);
      break;
    default:
      break;
  }
}

printHeader('DAY RECONSTRUCTION METHOD — PROTOTYPE WALKTHROUGH');

for (const step of script) {
  // Special case: resume from parked
  if (step.label.startsWith('---')) {
    if (state.parkState) {
      console.log(`\n  ${step.label}`);
      const result = reduceDRM(state, { kind: 'resume', state: state.parkState });
      state = result.state;
      for (const m of result.messages) printMsg(m);
    }
    continue;
  }

  console.log(`\n  ● ${step.label}`);
  const result = reduceDRM(state, step.action);
  state = result.state;
  for (const m of result.messages) printMsg(m);
}

printHeader('WALKTHROUGH COMPLETE');
console.log(`\n  Final phase: ${state.phase}`);
console.log(`  Fragments captured: ${state.fragments.length}`);
console.log(`  Episodes enumerated: ${state.episodes.length}`);
