/**
 * The Sounding gate's values — Q-35 turned into data, on the shared shape.
 *
 * The offer mechanism ships live (Q-62: its only power is to OFFER, declined
 * in a word), but the VALUES are measurements, and measurements need the same
 * reviewable licence any threshold has: a live flag and a graduatesWhen
 * sentence, so a re-derivation can change them against the record instead of
 * by editing a bare literal.
 */
import type { Threshold } from '../domain/thresholds.js';

export const SOUNDING_THRESHOLDS = {
  'sounding.sustainedOverlap': {
    name: 'sounding.sustainedOverlap',
    value: 0.10,
    live: true,
    graduatesWhen:
      'Re-derived 2026-08-05 from 957 window evaluations across 105 archived sittings (ticket 142): content-word Jaccard p50=0.053 p75=0.081 p90=0.115 p95=0.135. The prior 0.15 sat above p95 (3.4% of windows) and produced 0 offers in 216 evaluations; 0.10 sits near p85 — rare but reachable in a sitting of 8+ turns. Demote if the offer record shows descents offered on scattered threads.',
  },
  'sounding.lateQuestionCount': {
    name: 'sounding.lateQuestionCount',
    value: 6,
    live: true,
    graduatesWhen:
      'Re-derived 2026-08-05 from 209 sounding-license evaluations across six archive vaults (gate-repair): at questionCount>=9 the joint (late,sustained) cleared 0.5% — one offer in 209 windows; at 6 the sitting is past opening with turns enough for a three-turn thread. Demote if offers land in the opening phase.',
  },
} satisfies Record<string, Threshold>;

export type SoundingThresholdName = keyof typeof SOUNDING_THRESHOLDS;
