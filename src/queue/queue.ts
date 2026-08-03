import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { QueueStore, QueueEntry, QueueDraft, Mode, Facet } from '../types.js';
import { appendEvent } from '../log/activity.js';
import type { EventKind } from '../log/format.js';
import {
 applyFacetBalance,
 facetBalanceIsLive,
 FACETS,
 formatDistribution,
 readVaultFacetDistribution,
 sessionBlueprint,
 underRepresented,
 type FacetDistribution,
} from './facet-balance.js';

export function createQueueStore(root: string): QueueStore {
 return new QueueStoreImpl(root);
}

/**
 * The two ways a question can be the person's own: typed in by hand, or
 * placed as a gap to fill. Everything else — including a model-marked gap
 * fill — is the system's material and weighs the same as any mint. This is
 * what `draw`'s priority sort and rung 2 test; `expire` deliberately does
 * NOT use it (Q-41, see the guard there).
 */
export function isUserDeclaredWeight(e: QueueEntry): boolean {
 return e.source === 'user-declared' || e.source === 'gap-declared';
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

/** A hard filter, named as the ladder's log lines say it. */
type FilterName = 'status' | 'sounding' | 'modeNeeds' | 'sharpness' | 'horizon' | 'target';

type DrawFilter = {
 name: FilterName;
 keep: (e: QueueEntry) => boolean;
 /**
  * Rung 2 of the degradation ladder (Q-55) admits `user-declared` entries
  * past exactly these, and past nothing else. `status` is incoherent to
  * relax, `target` is the one thing the person said this sitting is FOR
  * (Q-19/045), and `horizon` protects the sitting's budget.
  */
 relaxable: boolean;
};

/**
 * The draw's hard filters as data rather than control flow, in the order they
 * apply. The order is a values statement (Q-55), so it is written once, read
 * by the normal path, by rung 2, and by the floor's "which filter emptied the
 * pool" — one list, no re-implementation.
 */
function drawFilters(mode: Mode, phase: 'opening' | 'mid' | 'late'): DrawFilter[] {
 const modeEnergy = ENERGY_LEVEL[mode.energy];
 return [
  {
   name: 'status',
   relaxable: false,
   keep: (e) => e.status === 'pending' || e.status === 'deferred',
  },
  // A parked ladder is a pointer, not a question. Rung 2 of the
  // degradation ladder (Q-55) exists to admit the person's own
  // declared questions past a preference, never a pointer as if it
  // were a question — relaxable: false is the whole point.
  { name: 'sounding', relaxable: false, keep: (e) => e.source !== 'parked-sounding' },
  {
   name: 'modeNeeds',
   relaxable: true,
   keep: (e) => {
    if (e.modeNeeds?.minMinutes && e.modeNeeds.minMinutes > mode.minutes) return false;
    if (e.modeNeeds?.energy) {
     const needLevel = ENERGY_LEVEL[e.modeNeeds.energy] ?? 0;
     if (needLevel > modeEnergy) return false;
    }
    return true;
   },
  },
  {
   name: 'sharpness',
   relaxable: true,
   keep: (e) => phase === 'late' || e.sharpness === 'weak',
  },
  // Never drawn into an exchange, at any rung: a days-horizon question is
  // not a question for now.
  { name: 'horizon', relaxable: false, keep: (e) => e.horizon !== 'days' },
  // The sitting's declared Target — a hard filter, not a preference (045).
  // A domain sitting drew self material because nothing here looked at the
  // Target at all; the cost was every declared domain sitting, since one
  // composed self entry is enough to hijack it. An entry with no target
  // claim serves either sitting; an entry with the other target is simply
  // not in the pool, so the caller falls through to its own opener.
  {
   name: 'target',
   relaxable: false,
   keep: (e) =>
    mode.target === undefined || e.target === undefined || e.target === mode.target,
  },
 ];
}

type ChainRun = {
 pool: QueueEntry[];
 /**
  * The first filter that took a non-empty pool to empty. Null when the queue
  * was already empty — an empty vault is not a filter's doing, and saying
  * `status` there would be a lie the floor log then repeats.
  */
 emptiedBy: FilterName | null;
};

/**
 * Run the chain, recording where the pool died. `relaxUserDeclared` is rung 2:
 * an entry whose source is `user-declared` passes the relaxable filters
 * regardless of what they think of it. The person asked for that question by
 * name (Q-20), and the system's judgement that it is too sharp for an opening
 * is exactly the judgement that should yield to an explicit request.
 */
function runChain(
 entries: QueueEntry[],
 filters: DrawFilter[],
 relaxUserDeclared: boolean,
): ChainRun {
 let pool = entries;
 let emptiedBy: FilterName | null = null;
 for (const f of filters) {
  if (pool.length === 0) break;
  pool = pool.filter(
   (e) => f.keep(e) || (relaxUserDeclared && f.relaxable && isUserDeclaredWeight(e)),
  );
  if (pool.length === 0) {
   emptiedBy = f.name;
   break;
  }
 }
 return { pool, emptiedBy };
}

/**
 * Which relaxations actually earned their keep: the filters that reject an
 * entry still standing in the pool. Nothing else is named, so `relaxed=` says
 * what happened rather than what was permitted.
 */
function relaxedBy(pool: QueueEntry[], filters: DrawFilter[]): FilterName[] {
 const names = new Set<FilterName>();
 for (const e of pool) {
  for (const f of filters) if (f.relaxable && !f.keep(e)) names.add(f.name);
 }
 return [...names];
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
   // The quest a reflection question follows. Read back because the
   // (quest, session) pair is the dedupe key across restarts (Q-75).
   ...(data.quest ? { quest: data.quest as string } : {}),
   // The Gap this entry was minted to fill. Read back because the gap link
   // has to survive a restart: the mint wrote it, the draw read it (Q-39).
   ...(data.gap ? { gap: data.gap as string } : {}),
   // The Bud and the recorded failure this gap-fill entry asks about.
   // Read back because the per-failure dedupe keys on the pair across
   // restarts (ticket 027).
   ...(data.bud ? { bud: data.bud as string } : {}),
   ...(data.failure ? { failure: data.failure as string } : {}),
   // The snippet a half-Construct question is about. Read back because
   // the construct dedupe keys on it across restarts (ticket 027).
   ...(data.snippet ? { snippet: data.snippet as string } : {}),
   // The pair an undiscriminated-range question stands between (ticket
   // 060). Read back because the pair is the dedupe key and the answer's
   // routing address, across restarts.
   ...(data.claims ? { claims: data.claims as string[] } : {}),
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
   // The ladder a parked-sounding pointer names. Read back because the
   // resume route keys on it across restarts (Q-3: the ladder file is the
   // truth, the pointer only points).
   ...(data.soundingId ? { soundingId: data.soundingId as string } : {}),
   // The KTG territory node this entry was minted for. Read back because
   // the dedupe key is the node id across restarts (094).
   ...(data.territoryNode ? { territoryNode: data.territoryNode as string } : {}),
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
 if (entry.quest) fm.quest = entry.quest;
  if (entry.gap) fm.gap = entry.gap;
  if (entry.bud) fm.bud = entry.bud;
  if (entry.failure) fm.failure = entry.failure;
  if (entry.snippet) fm.snippet = entry.snippet;
  if (entry.claims) fm.claims = entry.claims;
  if (entry.cites) fm.cites = entry.cites;
  if (entry.quotedFragment) fm.quotedFragment = entry.quotedFragment;
  if (entry.target) fm.target = entry.target;
  if (entry.topic) fm.topic = entry.topic;
  if (entry.targetFacet) fm.targetFacet = entry.targetFacet;
  if (entry.modeNeeds) fm.modeNeeds = entry.modeNeeds;
  if (entry.direction) fm.direction = entry.direction;
 if (entry.soundingId) fm.soundingId = entry.soundingId;
  if (entry.territoryNode) fm.territoryNode = entry.territoryNode;
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

 /**
  * The degradation ladder (Q-55): the system drops its own inferences before
  * it drops the person's declarations, and when it runs out of inferences to
  * drop it composes rather than compromises.
  *
  * Step 1 runs the hard filters. If they leave nothing, rung 2 re-runs them
  * admitting `user-declared` entries past sharpness and modeNeeds. If that
  * leaves nothing too, the floor is `return null` — and the caller composing
  * fresh with full context (Q-36) is the RIGHT outcome, not a failure, so the
  * floor is logged rather than repaired. Rung 1 — dropping facet balance —
  * lives at step 4, because line-order already guarantees the facet filter
  * can never be what emptied the pool.
  */
 draw(mode: Mode, phase: 'opening' | 'mid' | 'late'): QueueEntry | null {
  const all = this.#readAll();
  const filters = drawFilters(mode, phase);

  // Step 1: the hard filters, in the order Q-55 fixes.
  const normal = runChain(all, filters, false);
  let candidates = normal.pool;

  // Step 2: rung 2, and only when step 1 came back empty.
  if (candidates.length === 0) {
   const relaxed = runChain(all, filters, true);
   if (relaxed.pool.length === 0) {
    this.#logFloor(all.length, normal.emptiedBy, mode, phase);
    return null;
   }
   this.#logRung(
    2,
    relaxedBy(relaxed.pool, filters).join(',') || 'none',
    relaxed.pool.length,
    relaxed.pool.map((e) => e.id),
   );
   candidates = relaxed.pool;
  }

  // Step 3: sort — the person's own questions first, then recency (newest first)
  candidates.sort((a, b) => {
   const aUd = isUserDeclaredWeight(a) ? 0 : 1;
   const bUd = isUserDeclaredWeight(b) ? 0 : 1;
   if (aUd !== bUd) return aUd - bUd;
   return b.created.localeCompare(a.created);
  });

  // Step 4: facet balance — a second hard filter on the pool, applied BEFORE
  // the top-k pick so chance runs inside the constraints (Q-13), and running
  // in shadow until its log earns it the right to act (Q-35). It narrows
  // what the Target filter already left; the two compose, in that order.
  const dist = readVaultFacetDistribution(this.#root);
  const wanted = underRepresented(dist);
  const balanced = applyFacetBalance(candidates, wanted);
  const live = facetBalanceIsLive(process.env);

  // Rung 1 of the ladder: the facet filter wanted this pool empty and stood
  // down instead. It is the system's inference about corpus shape, so it is
  // the first thing dropped — and `applyFacetBalance` already drops it,
  // which is why this rung is a log line rather than a branch. A corpus that
  // owes every Facet owes none in particular; that stand-down is cold start,
  // not a rung, and the filter had no claim to drop.
  if (!balanced.applied && wanted.size < FACETS.length) {
   this.#logRung(1, 'facet-balance', candidates.length, []);
  }

  // Step 5: top-k (k=3), uniform random pick — once for the open pool, once
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

  // Step 6: markAsked immediately
  this.markAsked(picked.id);

  return picked;
 }

 /**
  * One line per rung actually used. `before` is the pool the constraint left
  * — zero, at every rung, because a rung only fires when a constraint emptied
  * the pool — and `after` is what relaxing it recovered. Without this, "the
  * filters emptied the pool" stays a hypothesis and Q-55's claim that a long
  * cascade is unnecessary has no evidence behind it either way.
  */
 #logRung(rung: 1 | 2, relaxed: string, after: number, refs: string[]): void {
  this.#append({
   kind: 'queue-rung',
   detail: `rung=${rung} relaxed=${relaxed} before=0 after=${after}`,
   refs,
  });
 }

 /**
  * The floor: the caller composes fresh, which Q-55 calls the right outcome.
  * What it names is the filter that got there first — the one rung a longer
  * ladder would have had to relax next, recorded so that the decision to have
  * no such rung can be reviewed against what actually happens.
  */
 #logFloor(
  poolSize: number,
  emptiedBy: FilterName | null,
  mode: Mode,
  phase: 'opening' | 'mid' | 'late',
 ): void {
  this.#append({
   kind: 'queue-floor',
   detail: [
    `emptiedBy=${emptiedBy ?? 'none'}`,
    `pool=${poolSize}`,
    `phase=${phase}`,
    `target=${mode.target ?? 'none'}`,
    `mode=${mode.minutes}m/${mode.energy}`,
   ].join(' '),
   refs: [],
  });
 }

 /** The log is evidence, not a dependency — a draw never fails on it. */
 #append(e: { kind: EventKind; detail: string; refs: string[] }): void {
  try {
   appendEvent(this.#root, {
    at: new Date().toISOString(),
    actor: 'elicitor',
    kind: e.kind,
    detail: e.detail,
    ...(e.refs.length > 0 ? { refs: e.refs } : {}),
   });
  } catch {
   // Deliberately silent, exactly as `#logFacetBalance` is.
  }
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
   // Q-41: gap questions expire on the normal queue rule — the asymmetry is
   // the whole point. Only a question the person typed in by hand survives
   // the sweep; the literal below is deliberate and must not grow.
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
