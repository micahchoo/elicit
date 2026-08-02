import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { QueueStore, QueueEntry, QueueDraft, Mode, Facet } from '../types.js';
import { appendEvent } from '../log/activity.js';
import {
  applyFacetBalance,
  facetBalanceIsLive,
  formatDistribution,
  readVaultFacetDistribution,
  sessionBlueprint,
  underRepresented,
  type FacetDistribution,
} from './facet-balance.js';

export function createQueueStore(root: string): QueueStore {
  return new QueueStoreImpl(root);
}

const ENERGY_LEVEL: Record<NonNullable<Mode['energy']>, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** How far ahead the shadow blueprint plans. Only its first slot is ever asked. */
const SESSION_BLUEPRINT_SLOTS = 6;

/** Constraints are done; chance takes the last step (Q-13). */
function pickTopK(pool: QueueEntry[], k = 3): QueueEntry {
  const top = pool.slice(0, k);
  return top[Math.floor(Math.random() * top.length)]!;
}

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
      // Absent until `markAnswered` writes it. Its absence is the uptake
      // signal's "not yet", never a zero (ticket 041).
      ...(data.answeredAt ? { answeredAt: data.answeredAt as string } : {}),
      // The Claim a lint-minted still-true question is about. Read back
      // because the still-true dedupe keys on it across restarts (Q-31).
      ...(data.claim ? { claim: data.claim as string } : {}),
      ...(data.quotedFragment
        ? { quotedFragment: data.quotedFragment as NonNullable<QueueEntry['quotedFragment']> }
        : {}),
      // Absent stays absent — an entry written before `target` existed makes
      // no target claim, and the draw treats that as eligible for either.
      ...(data.target ? { target: data.target as NonNullable<QueueEntry['target']> } : {}),
      ...(data.topic ? { topic: data.topic as NonNullable<QueueEntry['topic']> } : {}),
      ...(data.targetFacet
        ? { targetFacet: data.targetFacet as NonNullable<QueueEntry['targetFacet']> }
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
    // Every optional field is written under a guard, never as a present key
    // holding `undefined` — `matter.stringify` throws on that and the whole
    // write is lost.
    if (entry.answeredAt) fm.answeredAt = entry.answeredAt;
    if (entry.claim) fm.claim = entry.claim;
    if (entry.cites) fm.cites = entry.cites;
    if (entry.quotedFragment) fm.quotedFragment = entry.quotedFragment;
    if (entry.target) fm.target = entry.target;
    if (entry.topic) fm.topic = entry.topic;
    if (entry.targetFacet) fm.targetFacet = entry.targetFacet;
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

    // Step 5: the sitting's declared Target — a hard filter, not a preference
    // (045). A domain sitting drew self material because nothing here looked
    // at the Target at all; the cost was every declared domain sitting, since
    // one composed self entry is enough to hijack it. An entry with no target
    // claim serves either sitting; an entry with the other target is simply
    // not in the pool, so the caller falls through to its own opener.
    if (mode.target) {
      candidates = candidates.filter(
        (e) => e.target === undefined || e.target === mode.target,
      );
    }

    if (candidates.length === 0) return null;

    // Step 6: sort — user-declared first, then recency (newest first)
    candidates.sort((a, b) => {
      const aUd = a.source === 'user-declared' ? 0 : 1;
      const bUd = b.source === 'user-declared' ? 0 : 1;
      if (aUd !== bUd) return aUd - bUd;
      return b.created.localeCompare(a.created);
    });

    // Step 7: facet balance — a second hard filter on the pool, applied BEFORE
    // the top-k pick so chance runs inside the constraints (Q-13), and running
    // in shadow until its log earns it the right to act (Q-35). It narrows
    // what the Target filter already left; the two compose, in that order.
    const dist = readVaultFacetDistribution(this.#root);
    const wanted = underRepresented(dist);
    const balanced = applyFacetBalance(candidates, wanted);
    const live = facetBalanceIsLive(process.env);

    // Step 8: top-k (k=3), uniform random pick — once for the open pool, once
    // for the balanced pool, so the shadow log can name the road not taken.
    const openPick = pickTopK(candidates);
    const balancedPick = balanced.applied ? pickTopK(balanced.kept) : null;
    const picked = live && balancedPick ? balancedPick : openPick;

    this.#logFacetBalance({
      live,
      dist,
      wanted,
      poolSize: candidates.length,
      keptSize: balanced.applied ? balanced.kept.length : candidates.length,
      applied: balanced.applied,
      openPick,
      balancedPick,
    });

    // Step 9: markAsked immediately
    this.markAsked(picked.id);

    return picked;
  }

  /**
   * One line per draw, whether or not the filter bit. The shadow record is
   * free evidence (Q-23) and the only thing that can graduate the filter.
   */
  #logFacetBalance(o: {
    live: boolean;
    dist: FacetDistribution;
    wanted: Set<Facet>;
    poolSize: number;
    keptSize: number;
    applied: boolean;
    openPick: QueueEntry;
    balancedPick: QueueEntry | null;
  }): void {
    const plan = sessionBlueprint(o.dist, SESSION_BLUEPRINT_SLOTS);
    const diverged = o.balancedPick !== null && o.balancedPick.id !== o.openPick.id;
    const detail = [
      `mode=${o.live ? 'live' : 'shadow'}`,
      `dist=${formatDistribution(o.dist)}`,
      `under=${[...o.wanted].join(',') || 'none'}`,
      `plan=${plan.join(',')}`,
      `pool=${o.poolSize}`,
      `kept=${o.keptSize}`,
      `applied=${o.applied}`,
      `would=${o.balancedPick?.id ?? 'none'}`,
      `wouldFacet=${o.balancedPick?.targetFacet ?? 'none'}`,
      `open=${o.openPick.id}`,
      `openFacet=${o.openPick.targetFacet ?? 'none'}`,
      `diverged=${diverged}`,
    ].join(' ');

    try {
      appendEvent(this.#root, {
        at: new Date().toISOString(),
        actor: 'elicitor',
        kind: o.live ? 'facet-balance-applied' : 'facet-balance-shadow',
        detail,
        refs: o.balancedPick ? [o.openPick.id, o.balancedPick.id] : [o.openPick.id],
      });
    } catch {
      // The log is evidence, not a dependency — a draw never fails on it.
    }
  }

  markAsked(id: string): void {
    const entry = this.#readOne(id);
    if (!entry) return;
    entry.status = 'asked';
    this.#write(entry);
  }

  /**
   * The status and the time it happened are one fact, so they are written
   * together: a downstream horizon that reads `answered` without a date has
   * nothing to measure from (ticket 041).
   */
  markAnswered(id: string): void {
    const entry = this.#readOne(id);
    if (!entry) return;
    entry.status = 'answered';
    entry.answeredAt = new Date().toISOString();
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
