import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { QueueStore, QueueEntry, QueueDraft, Mode } from '../types.js';

export function createQueueStore(root: string): QueueStore {
  return new QueueStoreImpl(root);
}

const ENERGY_LEVEL: Record<NonNullable<Mode['energy']>, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

class QueueStoreImpl implements QueueStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(): string {
    const d = join(this.#root, 'queue');
    mkdirSync(d, { recursive: true });
    return d;
  }

  #readAll(): QueueEntry[] {
    const dir = this.#dir();
    const entries: QueueEntry[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const parsed = matter.read(join(dir, f));
      const data = parsed.data as Record<string, unknown>;
      entries.push(this.#parseEntry(data));
    }
    return entries;
  }

  #parseEntry(data: Record<string, unknown>): QueueEntry {
    return {
      id: data.id as string,
      status: data.status as QueueEntry['status'],
      source: data.source as QueueEntry['source'],
      license: data.license as string,
      question: data.question as string,
      questionForm: data.questionForm as QueueEntry['questionForm'],
      sharpness: data.sharpness as QueueEntry['sharpness'],
      horizon: data.horizon as QueueEntry['horizon'],
      created: data.created as string,
      ...(data.cites ? { cites: data.cites as NonNullable<QueueEntry['cites']> } : {}),
      ...(data.quotedFragment
        ? { quotedFragment: data.quotedFragment as NonNullable<QueueEntry['quotedFragment']> }
        : {}),
      ...(data.modeNeeds
        ? { modeNeeds: data.modeNeeds as NonNullable<QueueEntry['modeNeeds']> }
        : {}),
      ...(data.direction
        ? { direction: data.direction as NonNullable<QueueEntry['direction']> }
        : {}),
    };
  }

  #write(entry: QueueEntry): void {
    const { id, status, source, license, question, questionForm, sharpness, horizon, created } =
      entry;
    const fm: Record<string, unknown> = {
      id,
      status,
      source,
      license,
      question,
      questionForm,
      sharpness,
      horizon,
      created,
    };
    if (entry.cites) fm.cites = entry.cites;
    if (entry.quotedFragment) fm.quotedFragment = entry.quotedFragment;
    if (entry.modeNeeds) fm.modeNeeds = entry.modeNeeds;
    if (entry.direction) fm.direction = entry.direction;
    const content = matter.stringify('', fm);
    writeFileSync(join(this.#dir(), `${entry.id}.md`), content, 'utf-8');
  }

  #readOne(id: string): QueueEntry | null {
    try {
      const parsed = matter.read(join(this.#dir(), `${id}.md`));
      return this.#parseEntry(parsed.data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  // ── Public API ──

  add(draft: QueueDraft): QueueEntry {
    const entry: QueueEntry = {
      id: ulid(),
      status: 'pending',
      created: new Date().toISOString(),
      ...draft,
    };
    this.#write(entry);
    return entry;
  }

  list(
    filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] },
  ): QueueEntry[] {
    let entries = this.#readAll();
    if (filter?.status) {
      entries = entries.filter((e) => e.status === filter.status);
    }
    if (filter?.source) {
      entries = entries.filter((e) => e.source === filter.source);
    }
    return entries;
  }

  draw(mode: Mode, phase: 'opening' | 'mid' | 'late'): QueueEntry | null {
    const all = this.#readAll();
    const modeEnergy = ENERGY_LEVEL[mode.energy];

    // Step 1: filter by status=pending or deferred
    let candidates = all.filter(
      (e) => e.status === 'pending' || e.status === 'deferred',
    );

    // Step 2: hard-filter by modeNeeds vs mode
    candidates = candidates.filter((e) => {
      if (e.modeNeeds?.minMinutes && e.modeNeeds.minMinutes > mode.minutes) {
        return false;
      }
      if (e.modeNeeds?.energy) {
        const needLevel = ENERGY_LEVEL[e.modeNeeds.energy] ?? 0;
        if (needLevel > modeEnergy) return false;
      }
      return true;
    });

    // Step 3: filter by phase vs sharpness
    candidates = candidates.filter((e) => {
      if (phase === 'opening' || phase === 'mid') {
        return e.sharpness === 'weak';
      }
      return true;
    });

    // Step 4: horizon 'days' never drawn into exchange
    candidates = candidates.filter((e) => e.horizon !== 'days');

    if (candidates.length === 0) return null;

    // Step 5: sort — user-declared first, then recency (newest first)
    candidates.sort((a, b) => {
      const aUd = a.source === 'user-declared' ? 0 : 1;
      const bUd = b.source === 'user-declared' ? 0 : 1;
      if (aUd !== bUd) return aUd - bUd;
      return b.created.localeCompare(a.created);
    });

    // Step 6: top-k (k=3)
    const pool = candidates.slice(0, 3);

    // Step 7: uniform random pick
    const idx = Math.floor(Math.random() * pool.length);
    const picked = pool[idx]!;

    // Step 8: markAsked immediately
    this.markAsked(picked.id);

    return picked;
  }

  markAsked(id: string): void {
    const entry = this.#readOne(id);
    if (!entry) return;
    entry.status = 'asked';
    this.#write(entry);
  }

  markAnswered(id: string): void {
    const entry = this.#readOne(id);
    if (!entry) return;
    entry.status = 'answered';
    this.#write(entry);
  }

  defer(id: string): void {
    const entry = this.#readOne(id);
    if (!entry) return;
    entry.status = 'deferred';
    this.#write(entry);
  }

  expire(olderThanDays: number): number {
    const now = Date.now();
    const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
    const all = this.#readAll();
    let count = 0;

    for (const entry of all) {
      if (entry.status !== 'pending') continue;
      if (entry.source === 'user-declared') continue;
      const createdMs = new Date(entry.created).getTime();
      if (createdMs < cutoff) {
        entry.status = 'expired';
        this.#write(entry);
        count++;
      }
    }

    return count;
  }
}
