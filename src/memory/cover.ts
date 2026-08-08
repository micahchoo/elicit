// Cover — bounded-context tiling over transcripts.
// Pure core + thin gray-matter persistence. No LLM calls in this module.
// Summary text arrives from callers.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { writeMarginaliaLine, readMarginaliaLine, listMarginaliaFiles } from '../vault/marginalia.js';

// ── Types ──

export type SessionRef = {
 session: string;
 started: string;
 turnCount: number;
 chars: number;
};

export type Tile =
 | { kind: 'verbatim'; session: string }
 | { kind: 'summary'; sessions: string[]; line: string }
 | { kind: 'unsummarized'; sessions: string[] };

export type RangeSummary = {
 sessions: string[];
 line: string;
 model: string;
 at: string;
};

// ── cover ──

/**
 * Tile sessions into bounded-context representation.
 *
 * @param sessions   Newest-first session refs.
 * @param summaries  Existing range summaries (sessions oldest-first within each).
 * @param budgetChars  Character budget for verbatim tiles.
 * @returns Tiles ordered from newest context to oldest.
 */
export function cover(
 sessions: SessionRef[],
 summaries: RangeSummary[],
 budgetChars: number,
): Tile[] {
 const claimed = new Set<string>();
 const tiles: Tile[] = [];

 // Phase 1: newest sessions verbatim while budget allows
 let remaining = budgetChars;
 for (const s of sessions) {
  if (s.chars <= remaining) {
   tiles.push({ kind: 'verbatim', session: s.session });
   claimed.add(s.session);
   remaining -= s.chars;
  } else {
   break;
  }
 }

 if (claimed.size === sessions.length) return tiles;

 // Phase 2: remaining sessions, newest-remaining first
 // Sort summaries by size descending so we find the largest covering summary first
 const sortedSummaries = [...summaries].sort(
  (a, b) => b.sessions.length - a.sessions.length,
 );

 let i = 0;
 while (i < sessions.length) {
  if (claimed.has(sessions[i]!.session)) {
   i++;
   continue;
  }

  // Find the largest summary that covers this session and all its
  // sessions (from this point forward toward older) are unclaimed.
  const sid = sessions[i]!.session;
  let best: RangeSummary | null = null;

  for (const sum of sortedSummaries) {
   const idx = sum.sessions.indexOf(sid);
   if (idx === -1) continue;

   // All sessions in the summary from idx onward must be unclaimed.
   // Earlier sessions in the summary (newer than current scan position)
   // would have been claimed in phase 1 — check anyway for safety.
   const allUnclaimed = sum.sessions.every((s) => !claimed.has(s));
   if (!allUnclaimed) continue;

   best = sum;
   break; // sorted by size desc, first match is largest
  }

  if (best) {
   tiles.push({
    kind: 'summary',
    sessions: best.sessions,
    line: best.line,
   });
   for (const s of best.sessions) claimed.add(s);

   // Advance past all claimed sessions
   while (i < sessions.length && claimed.has(sessions[i]!.session)) i++;
  } else {
   // Collect consecutive unsummarized sessions
   const group: string[] = [];
   while (i < sessions.length && !claimed.has(sessions[i]!.session)) {
    const csid = sessions[i]!.session;

    // Check if any summary covers this session (with all its sessions unclaimed)
    const hasSummary = sortedSummaries.some((s) => {
     const idx = s.sessions.indexOf(csid);
     if (idx === -1) return false;
     return s.sessions.every((ss) => !claimed.has(ss));
    });
    if (hasSummary) break;

    group.push(csid);
    claimed.add(csid);
    i++;
   }
   if (group.length > 0) {
    tiles.push({ kind: 'unsummarized', sessions: group });
   }
  }
 }

 return tiles;
}

// ── nextConsolidation ──

interface TreeNode {
 sessions: string[];
 children: [TreeNode, TreeNode] | null;
}

/**
 * Find the next contiguous range that needs a summary.
 *
 * Binary bracketing: pairs → pairs of pairs → … until one root.
 * Proposes the oldest unsummarized pair whose children are all summarized
 * (or are leaf sessions, which need no summary).
 *
 * @param sessions   Oldest-first session refs.
 * @param summaries  Existing range summaries.
 * @returns Session IDs of the next range to summarize, or null if complete.
 */
export function nextConsolidation(
 sessions: SessionRef[],
 summaries: RangeSummary[],
): string[] | null {
 if (sessions.length <= 1) return null;

 // Build the binary-bracketing tree bottom-up
 let level: TreeNode[] = sessions.map((s) => ({
  sessions: [s.session],
  children: null,
 }));

 const internalNodes: TreeNode[] = [];

 while (level.length > 1) {
  const next: TreeNode[] = [];
  for (let i = 0; i < level.length; i += 2) {
   if (i + 1 < level.length) {
    const node: TreeNode = {
     sessions: [...level[i]!.sessions, ...level[i + 1]!.sessions],
     children: [level[i]!, level[i + 1]!],
    };
    internalNodes.push(node);
    next.push(node);
   } else {
    // Odd one out — promote to next level unchanged
    next.push(level[i]!);
   }
  }
  level = next;
 }

 // Summary lookup keyed by joined session IDs
 const summaryKeys = new Set(
  summaries.map((s) => s.sessions.join(',')),
 );

 function isReady(node: TreeNode): boolean {
  if (node.children === null) return true; // leaf — single session, always available
  return summaryKeys.has(node.sessions.join(','));
 }

 // internalNodes is already level-ordered (lowest first), left-to-right within each level
 for (const node of internalNodes) {
  if (summaryKeys.has(node.sessions.join(','))) continue; // already summarized
  const [left, right] = node.children!;
  if (isReady(left) && isReady(right)) {
   return node.sessions;
  }
 }

 return null;
}

// ── Persistence ──

const SUMMARIES_DIR = 'marginalia/transcript-summaries';

/**
 * Persist a range summary to disk.
 * Written to `{root}/marginalia/transcript-summaries/<first>-<last>.md`,
 * through the shared marginalia store (the range summary's sessions ride in
 * a comment-adjacent YAML block the store does not model).
 */
export function saveSummary(root: string, s: RangeSummary): void {
 const first = s.sessions[0]!;
 const last = s.sessions[s.sessions.length - 1]!;
 const yamlSessions = s.sessions.map((sid) => `  - ${sid}`).join('\n');
 writeMarginaliaLine(root, 'transcript-summaries', `${first}-${last}.md`, {
  ...s,
  extra: `sessions:\n${yamlSessions}\n`,
 });
}

/**
 * Load all persisted range summaries from disk.
 */
export function loadSummaries(root: string): RangeSummary[] {
 const results: RangeSummary[] = [];
 for (const file of listMarginaliaFiles(root, 'transcript-summaries')) {
  const s = readMarginaliaLine(root, 'transcript-summaries', `${file}.md`);
  if (s === null) continue;
  // The sessions list lives in the summary's frontmatter, which the shared
  // store's line reader does not model — re-read it here.
  try {
   const parsed = matter.read(join(root, SUMMARIES_DIR, `${file}.md`));
   const sessions = parsed.data.sessions as string[] | undefined;
   if (!Array.isArray(sessions) || sessions.length === 0) continue;
   results.push({ sessions, ...s });
  } catch {
   continue;
  }
 }
 return results;
}
