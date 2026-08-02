import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ActivityEvent = {
 at: string;
 actor: 'clerk' | 'elicitor' | 'harvester' | 'system';
 kind: string;
 detail: string;
 refs?: string[];
};

const LOG_DIR = join('vault', 'log');

const VALID_ACTORS: Record<string, true> = {
 clerk: true,
 elicitor: true,
 harvester: true,
 system: true,
};

/**
 * Extract YYYY-MM-DD from an ISO 8601 timestamp string.
 */
function dateKey(at: string): string {
 const m = /^\d{4}-\d{2}-\d{2}/.exec(at);
 if (!m) throw new Error(`ActivityEvent.at must be an ISO 8601 string, got: ${at}`);
 return m[0];
}

/**
 * Append a single event to the append-only activity log.
 * File: vault/log/<date>.jsonl — one JSON object per line, final newline.
 */
export function appendEvent(root: string, e: ActivityEvent): void {
 const dir = join(root, LOG_DIR);
 if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
 }
 const day = dateKey(e.at);
 const path = join(dir, `${day}.jsonl`);
 appendFileSync(path, `${JSON.stringify(e)}\n`, 'utf-8');
}

/**
 * Read all events from the activity log, chronologically across day files.
 * `since` is an ISO 8601 prefix — events with `at >= since` are returned.
 * Malformed lines are silently skipped.
 */
export function readEvents(root: string, since?: string): ActivityEvent[] {
 const dir = join(root, LOG_DIR);
 if (!existsSync(dir)) return [];

 const dayFiles = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .sort(); // YYYY-MM-DD.jsonl sorts chronologically

 const events: ActivityEvent[] = [];

 for (const file of dayFiles) {
  const path = join(dir, file);
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
   const trimmed = line.trim();
   if (trimmed === '') continue;
   try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isActivityEvent(parsed)) {
     if (!since || parsed.at >= since) {
      events.push(parsed);
     }
    }
   } catch {
    // Malformed line — skip silently
   }
  }
 }

 return events;
}

/** Structural type guard for ActivityEvent. */
function isActivityEvent(value: unknown): value is ActivityEvent {
 if (value === null || typeof value !== 'object') return false;
 const o = value as Record<string, unknown>;
 return (
  typeof o.at === 'string' &&
  typeof o.actor === 'string' && o.actor in VALID_ACTORS &&
  typeof o.kind === 'string' &&
  typeof o.detail === 'string'
 );
}
