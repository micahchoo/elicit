/**
 * Coach seeding — Q-111 door 1, extracted from server.ts's docket wiring.
 *
 * Clusters live claim bodies by simple content-word overlap, logs every
 * cluster's size for honest re-tuning, and mints an un-coached
 * DirectionRecord for themes with 3+ claims (Q-111 threshold, no distinct-
 * sitting requirement). Themed clustering runs zero-LLM; the mint is a
 * coach-store write, never a model call.
 */
import type { ClaimStore } from '../wiki/contract.js';
import type { EventKind } from '../log/kinds.js';
import type { CoachStore } from '../coach/store.js';
import { clusterClaimsByTheme } from '../coach/license.js';

/** The docket log sink, narrowed to what this sweep emits. */
export type CoachSeedLog = (e: {
  at: string;
  actor: 'clerk';
  kind: EventKind;
  detail: string;
  refs?: string[];
}) => void;

/** Themes with at least this many claims seed an un-coached direction (Q-111). */
const SEED_THRESHOLD = 3;

export async function runCoachSeedSweep(deps: {
  claimStore: ClaimStore;
  coachStore: CoachStore;
  frameWords: string[];
  log: CoachSeedLog;
}): Promise<{ clustered: number; minted: number }> {
  const slice = deps.claimStore.loadSlice();
  const claims = slice.claims.filter((c) => !c.archived && !c.supersededBy);
  const themes = clusterClaimsByTheme(
    claims.map((c) => ({ id: c.id, body: c.body })),
    deps.frameWords,
  );
  let clustered = 0;
  let minted = 0;
  for (const [, theme] of themes) {
    clustered++;
    deps.log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'coach-seed-cluster',
      detail: `theme=${theme.name} claims=${theme.claims}`,
      refs: [],
    });
    if (theme.claims >= SEED_THRESHOLD) {
      const dir = deps.coachStore.createUncoached(theme.name, { seeded: true, claimCount: theme.claims });
      minted++;
      deps.log({
        at: new Date().toISOString(),
        actor: 'clerk',
        kind: 'coach-seed-minted',
        detail: `slug=${dir.slug} name=${theme.name} claims=${theme.claims}`,
        refs: [],
      });
    }
  }
  // Log aggregate cluster sizes for honest re-tuning (Q-111)
  const sizes = [...themes.values()].map((t) => String(t.claims)).join(',');
  if (sizes) {
    deps.log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'coach-seed-evaluated',
      detail: `themes=${themes.size} clusterSizes=[${sizes}]`,
      refs: [],
    });
  }
  return { clustered: themes.size, minted };
}
