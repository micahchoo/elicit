// The repair vault: one JSONL file per snippet id, one record per line,
// append-only. A repair is a disavowal — the user pressed `not mine` on a
// quoted fragment — and every draw point consults these records before
// re-surfacing anything that cites the snippet (Q-106).
//
// Q-3 holds here too: these files ARE the repair store. Nothing keeps state
// between calls; every read goes to disk, so a hand-edited file is picked up
// by the next consultation without any rebuild step.

import { join } from 'node:path';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import type { RepairRecord } from '../types.js';

const REPAIRS_DIR = 'repairs';

/** Write one repair record. Appends a JSON line to vault/repairs/<snippetId>.jsonl. */
export function writeRepair(root: string, record: RepairRecord): void {
  const dir = join(root, REPAIRS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = record.snippetRef.split('@')[0]!;
  const file = join(dir, `${id}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
}

/** Read all repair records for one snippet id. */
export function readRepairs(root: string, snippetId: string): RepairRecord[] {
  const file = join(root, REPAIRS_DIR, `${snippetId}.jsonl`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l) as RepairRecord);
}

/** Read every repair record in the vault. */
export function readAllRepairs(root: string): RepairRecord[] {
  const dir = join(root, REPAIRS_DIR);
  if (!existsSync(dir)) return [];
  const records: RepairRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = readFileSync(join(dir, f), 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) records.push(JSON.parse(line) as RepairRecord);
  }
  return records;
}
