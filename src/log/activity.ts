import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventKind } from './kinds.js';

export type ActivityEvent = {
 at: string;
 actor: 'clerk' | 'elicitor' | 'harvester' | 'system';
 kind: EventKind;
 detail: string;
 refs?: string[];
};

const LOG_DIR = 'log';

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
/**
 * In-process append listeners, keyed by vault root (ticket 150). The
 * Activity Log is the one spine every actor writes through (Q-23), which
 * makes an append the complete "something changed" signal — the SSE route
 * subscribes here so open screens can refresh instead of waiting for a
 * manual reload. Listeners fire AFTER the line is on disk (the log stays
 * the truth; the notification is an echo of it), and a throwing listener
 * never blocks the write path.
 */
type AppendListener = (e: ActivityEvent) => void;
const appendListeners = new Map<string, Set<AppendListener>>();

export function onAppend(root: string, listener: AppendListener): () => void {
 let set = appendListeners.get(root);
 if (!set) {
  set = new Set();
  appendListeners.set(root, set);
 }
 set.add(listener);
 return () => {
  set!.delete(listener);
 };
}

export function appendEvent(root: string, e: ActivityEvent): void {
 const dir = join(root, LOG_DIR);
 if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
 }
 const day = dateKey(e.at);
 const path = join(dir, `${day}.jsonl`);
 appendFileSync(path, `${JSON.stringify(e)}\n`, 'utf-8');
 const listeners = appendListeners.get(root);
 if (listeners) {
  for (const listener of [...listeners]) {
   try {
    listener(e);
   } catch {
    /* a dead listener never blocks the log */
   }
  }
 }
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
