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
import type { SittingContext } from './composed.js';
import { isExpeditionCandidate } from './composed.js';
import { readSitting, sittingCache } from './sitting.js';

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
  composeOpener: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
  composeStillTrue: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
  composeExpedition?: (s: Snippet, c: Complete, sitting?: SittingContext) => Promise<QueueDraft | null>;
  /**
   * The sitting a snippet's session declared (045). Injected for tests; the
   * default reads the session's transcript frontmatter.
   */
  sittingOf?: (root: string, session: string) => SittingContext;
  log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
  nextConsolidation?: (sessions: SessionRef[], summaries: RangeSummary[]) => string[] | null;
  saveSummary?: (root: string, s: RangeSummary) => void;
  loadSummaries?: (root: string) => RangeSummary[];
  listSessions?: (root: string) => SessionRef[];
  readTranscript?: (root: string, session: string) => string;
  modelName?: string;
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

    // ── 1. Rebuild index from ALL snippets ──
    const rebuildResult = deps.vault.rebuildIndex();
    const allSnippets = Object.values(rebuildResult.snippets);
    const allReadings = rebuildResult.readings;
    const index = deps.buildIndex(allSnippets);
    deps.log({ at: ts(), actor: 'clerk', kind: 'index-rebuilt', detail: `rebuilt index from ${allSnippets.length} snippets` });

    const minted: QueueEntry[] = [];

    // Every question this run mints quotes one snippet, so it belongs to the
    // sitting that snippet came from — a domain sitting's words make a domain
    // question, whatever the question happens to be about (045).
    const sittingFor = sittingCache(deps.vaultRoot, deps.sittingOf ?? readSitting);

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
        try {
          const draft = await deps.composeOpener(s, deps.complete, sittingFor(s.provenance.session));
          if (draft) {
            const entry = deps.queue.add(draft);
            minted.push(entry);
            openerCount++;
            if (draft.cites) openerRefs.push(...draft.cites);
          }
        } catch (err) {
          deps.log({ at: ts(), actor: 'clerk', kind: 'opener-failed', detail: `composeOpener for snippet ${s.id} failed: ${String(err)}` });
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
    let stillTrueCount = 0;
    const oldSnippets = allSnippets.filter(s => new Date(s.captured).getTime() < ninetyDaysMs);
    const stillTrueCandidates = oldSnippets.slice(0, 2);

    for (const s of stillTrueCandidates) {
      try {
        const draft = await deps.composeStillTrue(s, deps.complete, sittingFor(s.provenance.session));
        if (draft) {
          const entry = deps.queue.add(draft);
          minted.push(entry);
          stillTrueCount++;
        }
      } catch (err) {
        deps.log({ at: ts(), actor: 'clerk', kind: 'still-true-failed', detail: `composeStillTrue for snippet ${s.id} failed: ${String(err)}` });
      }
    }
    deps.log({ at: ts(), actor: 'clerk', kind: 'still-true-minted', detail: `minted ${stillTrueCount} still-true` });

    // ── 4. Expire stale queue entries ──
    const expired = deps.queue.expire(30);
    deps.log({ at: ts(), actor: 'clerk', kind: 'expired', detail: `expired ${expired} entries` });

    // ── 5. At most one consolidation ──
    if (deps.nextConsolidation && deps.saveSummary && deps.loadSummaries && sessions) {
      try {
        const summaries = deps.loadSummaries(deps.vaultRoot);
        const range = deps.nextConsolidation(sessions, summaries);
        if (range && range.length > 0) {
          // The summary must see actual content — cap per-transcript and total
          // so one consolidation always fits the local model's context.
          const texts = range.map((session) => {
            const body = deps.readTranscript ? deps.readTranscript(deps.vaultRoot, session) : '';
            return `[session ${session}]\n${body.slice(0, 4000)}`;
          });
          const line = (await deps.complete(
            'You summarize interview transcripts. Reply with ONE plain line stating what the person talked about. No interpretation beyond what is present, no praise, no advice.',
            [{ role: 'user', text: texts.join('\n\n').slice(0, 12000), at: ts() }],
          )) ?? '';
          deps.saveSummary(deps.vaultRoot, {
            sessions: range,
            line: line.trim() || 'consolidated (model returned nothing)',
            model: deps.modelName ?? 'unknown',
            at: ts(),
          });
          deps.log({ at: ts(), actor: 'clerk', kind: 'consolidated', detail: `summarized ${range.length} sessions` });
        }
      } catch (err) {
        deps.log({ at: ts(), actor: 'clerk', kind: 'consolidation-failed', detail: String(err) });
      }
    }

    // ── 6. Expedition minting: at most ONE per run ──
    if (deps.composeExpedition) {
      try {
        const allEntries = deps.queue.list();
        for (const s of allSnippets) {
          if (isExpeditionCandidate(s, allReadings, allEntries, allSnippets)) {
            const draft = await deps.composeExpedition(s, deps.complete, sittingFor(s.provenance.session));
            if (draft) {
              const entry = deps.queue.add(draft);
              minted.push(entry);
              const logEvt: { at: string; actor: string; kind: string; detail: string; refs?: string[] } = {
                at: ts(),
                actor: 'clerk',
                kind: 'expedition-minted',
                detail: `minted expedition from snippet ${s.id}`,
              };
              if (draft.cites) logEvt.refs = draft.cites;
              deps.log(logEvt);
            }
            break; // At most ONE expedition per run
          }
        }
      } catch (err) {
        deps.log({ at: ts(), actor: 'clerk', kind: 'expedition-failed', detail: String(err) });
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
