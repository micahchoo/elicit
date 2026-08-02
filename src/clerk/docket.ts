import type {
  Vault,
  QueueStore,
  QueueDraft,
  Snippet,
  LexicalIndex,
  DocketReport,
  Complete,
  QueueEntry,
} from '../types.js';

// ── Structural types from cover.ts contract (Task 4c) ──
// NOT imported — docket injects these structurally per the plan.
type SessionRef = { session: string; started: string; turnCount: number; chars: number };
type RangeSummary = { sessions: string[]; line: string; model: string; at: string };

// ── In-process lock ──
let running = false;

export async function runDocket(deps: {
  vault: Vault;
  queue: QueueStore;
  complete: Complete;
  buildIndex: (snippets: Snippet[]) => LexicalIndex;
  composeOpener: (s: Snippet, c: Complete) => Promise<QueueDraft | null>;
  composeStillTrue: (s: Snippet, c: Complete) => Promise<QueueDraft | null>;
  log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
  nextConsolidation?: (sessions: SessionRef[], summaries: RangeSummary[]) => string[] | null;
  saveSummary?: (root: string, s: RangeSummary) => void;
  loadSummaries?: (root: string) => RangeSummary[];
  listSessions?: (root: string) => SessionRef[];
  vaultRoot: string;
}): Promise<DocketReport> {
  if (running) {
    return {
      reindexed: 0,
      minted: [],
      expired: 0,
      index: deps.buildIndex([]),
    };
  }

  running = true;
  try {
    const ts = () => new Date().toISOString();

    // ── Log: run started ──
    deps.log({ at: ts(), actor: 'clerk', kind: 'run-started', detail: 'docket run started' });

    // ── 1. Rebuild lexical index from ALL snippets ──
    const allSnippets = Object.values(deps.vault.rebuildIndex().snippets);
    const index = deps.buildIndex(allSnippets);
    deps.log({ at: ts(), actor: 'clerk', kind: 'index-rebuilt', detail: `rebuilt index from ${allSnippets.length} snippets` });

    const minted: QueueEntry[] = [];

    // Cache sessions once for opener + consolidation use
    let sessions: SessionRef[] | undefined;
    if (deps.listSessions) {
      sessions = deps.listSessions(deps.vaultRoot);
      sessions.sort((a, b) => b.started.localeCompare(a.started));
    }

    // ── 2. Opener minting: uncited snippets from last 2 sessions ──
    let openerCount = 0;
    if (sessions) {
      const recentSessionIds = new Set(sessions.slice(0, 2).map(s => s.session));

      const allEntries = deps.queue.list();
      const citedIds = new Set<string>();
      for (const e of allEntries) {
        for (const cite of e.cites ?? []) {
          const [snippetId] = cite.split('@');
          if (snippetId) citedIds.add(snippetId);
        }
      }

      const candidates = allSnippets.filter(s =>
        recentSessionIds.has(s.provenance.session) && !citedIds.has(s.id),
      );

      const openerRefs: string[] = [];
      for (const s of candidates) {
        const draft = await deps.composeOpener(s, deps.complete);
        if (draft) {
          const entry = deps.queue.add(draft);
          minted.push(entry);
          openerCount++;
          if (draft.cites) openerRefs.push(...draft.cites);
        }
      }

      const evt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
        at: ts(), actor: 'clerk', kind: 'opener-minted',
        detail: `minted ${openerCount} openers`,
      };
      if (openerRefs.length > 0) evt.refs = openerRefs;
      deps.log(evt);
    }

    // ── 3. Still-true minting: snippets captured > 90 days, quota 2 ──
    const ninetyDaysMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const oldSnippets = allSnippets.filter(s => new Date(s.captured).getTime() < ninetyDaysMs);
    const stillTrueCandidates = oldSnippets.slice(0, 2);

    let stillTrueCount = 0;
    for (const s of stillTrueCandidates) {
      const draft = await deps.composeStillTrue(s, deps.complete);
      if (draft) {
        const entry = deps.queue.add(draft);
        minted.push(entry);
        stillTrueCount++;
      }
    }
    deps.log({ at: ts(), actor: 'clerk', kind: 'still-true-minted', detail: `minted ${stillTrueCount} still-true` });

    // ── 4. Expire stale queue entries ──
    const expired = deps.queue.expire(30);
    deps.log({ at: ts(), actor: 'clerk', kind: 'expired', detail: `expired ${expired} entries` });

    // ── 5. At most one consolidation ──
    if (deps.nextConsolidation && deps.saveSummary && deps.loadSummaries && sessions) {
      const summaries = deps.loadSummaries(deps.vaultRoot);
      const range = deps.nextConsolidation(sessions, summaries);
      if (range && range.length > 0) {
        const line = await deps.complete('Summarize the following sessions in one line.', []);
        deps.saveSummary(deps.vaultRoot, {
          sessions: range,
          line: line || 'consolidated',
          model: 'docket',
          at: ts(),
        });
      }
    }

    return {
      reindexed: allSnippets.length,
      minted,
      expired,
      index,
    };
  } finally {
    running = false;
  }
}
