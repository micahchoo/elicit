import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

// ── Types ──

export interface YieldReport {
 /** Protocol name from the transcript frontmatter. */
 protocol: string;
 /** Session (transcript) ID. */
 sessionId: string;
 /** Number of user turns in the transcript (one exchange per user turn). */
 exchangeCount: number;
 /** Number of distinct snippets harvested from this session. */
 keptSnippetCount: number;
 /**
  * Kept snippets per exchange.
  * `0` when exchangeCount is zero (empty transcript).
  */
 ratio: number;
}

// ── Implementation ──

/**
 * Pure function: compute kept-snippets-per-exchange for every session,
 * grouped by protocol.  Reads transcript and snippet files from the vault.
 *
 * Intended to be called at docket-time; the caller wires the result into
 * the Activity Log.  This module only exports the computation.
 */
export function computeYield(vaultRoot: string): YieldReport[] {
 const sessionExchanges = readSessionExchangeCounts(vaultRoot);
 const sessionSnippets = readSessionSnippetCounts(vaultRoot);

 const reports: YieldReport[] = [];

 for (const [sessionId, { protocol, exchangeCount }] of sessionExchanges) {
  const keptSnippetCount = sessionSnippets.get(sessionId) ?? 0;
  reports.push({
   protocol,
   sessionId,
   exchangeCount,
   keptSnippetCount,
   ratio: exchangeCount > 0 ? keptSnippetCount / exchangeCount : 0,
  });
 }

 return reports;
}

// ── Internal helpers ──

interface SessionMeta {
 protocol: string;
 exchangeCount: number;
}

function readSessionExchangeCounts(vaultRoot: string): Map<string, SessionMeta> {
 const result = new Map<string, SessionMeta>();
 const dir = join(vaultRoot, 'transcripts');
 if (!existsSync(dir)) return result;

 let files: string[];
 try {
  files = readdirSync(dir);
 } catch {
  return result;
 }

 for (const file of files) {
  if (!file.endsWith('.md')) continue;
  const sessionId = file.replace(/\.md$/, '');
  const path = join(dir, file);
  let raw: string;
  try {
   raw = readFileSync(path, 'utf-8');
  } catch {
   continue;
  }

  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const protocol = typeof data.protocol === 'string' ? data.protocol : 'unknown';

  // Count user turns: each `## user` heading in the body is one exchange
  const exchangeCount = (parsed.content.match(/^## user$/gm) ?? []).length;

  result.set(sessionId, { protocol, exchangeCount });
 }

 return result;
}

function readSessionSnippetCounts(vaultRoot: string): Map<string, number> {
 const result = new Map<string, number>();
 const dir = join(vaultRoot, 'snippets');
 if (!existsSync(dir)) return result;

 let snippetDirs: string[];
 try {
  snippetDirs = readdirSync(dir);
 } catch {
  return result;
 }

 for (const snippetId of snippetDirs) {
  const snippetDir = join(dir, snippetId);
  let versionFiles: string[];
  try {
   versionFiles = readdirSync(snippetDir).filter((f) => /^v\d+\.md$/.test(f));
  } catch {
   continue;
  }
  if (versionFiles.length === 0) continue;

  // Read the latest version for provenance
  const sorted = versionFiles.sort((a, b) => {
   const va = Number(a.match(/^v(\d+)\.md$/)![1]);
   const vb = Number(b.match(/^v(\d+)\.md$/)![1]);
   return vb - va;
  });
  const latest = join(snippetDir, sorted[0]!);

  let raw: string;
  try {
   raw = readFileSync(latest, 'utf-8');
  } catch {
   continue;
  }

  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const provenance = data.provenance as Record<string, unknown> | undefined;
  const session = typeof provenance?.session === 'string' ? provenance.session : undefined;

  if (session) {
   result.set(session, (result.get(session) ?? 0) + 1);
  }
 }

 return result;
}
