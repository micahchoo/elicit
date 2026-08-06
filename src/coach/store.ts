/**
 * The coach store — ticket 090 T3. Every coach record is a gray-matter
 * markdown file under `vault/coach/`, read back on every call (Q-3: a
 * restart resumes, nothing is cached). No API deletes a file: un-coaching,
 * retiring and declining are all field writes (Q-73, Q-75). Advice is the
 * exception that proves the rule — one file per Direction, REPLACED, never
 * appended, so a stacked second note is unrepresentable (Q-77).
 *
 * The read/write idiom mirrors src/queue/queue.ts: every optional frontmatter
 * key goes under a presence guard, because `matter.stringify` throws on a
 * present-but-undefined key and the whole write would be lost.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import {
 directionSlugFor,
 normalizeOption,
 type AdviceNote,
 type ArtifactRecord,
 type CoachLicenseEvent,
 type DirectionRecord,
 type Quest,
 type QuestOption,
 type QuestStatus,
} from './contract.js';

/**
 * The frontmatter of one transcript, with the quest/direction tags T4 adds.
 * `session` and `started` are always present; the tags only when the keys
 * exist. Quest provenance is derived, never stamped on the snippet (Q-75 —
 * `provenance.session` resolves to this).
 */
export type SittingTag = { session: string; started: string; quest?: string; direction?: string };

export type CoachStore = {
 declareCoached(name: string): DirectionRecord; // idempotent on slug; re-coaching flips coached back on
 uncoach(slug: string): DirectionRecord | null; // coached=false, uncoachedAt; deletes nothing (Q-73)
 getDirection(slug: string): DirectionRecord | null;
 listDirections(): DirectionRecord[]; // coached and not — the offer needs both
 recordVisit(slug: string, at: string): void;
 recordOfferDeclined(slug: string): void; // creates the stub if the Direction was never declared
 /** Q-110 door 2: create an un-coached DirectionRecord. Idempotent on slug. */
 createUncoached(name: string, opts?: { seeded?: boolean; claimCount?: number }): DirectionRecord;
 addDeclinedOption(slug: string, text: string): void; // stores normalizeOption(text)

 adoptQuest(input: { direction: string; act: string; cites: string[] }): Quest;
 retireQuest(id: string): Quest | null;
 getQuest(id: string): Quest | null;
 listQuests(direction?: string): Quest[];
 questStatus(q: Quest, tags: SittingTag[]): QuestStatus; // retiredAt → retired; any tag.quest===q.id → returned; else adopted

 declareArtifact(input: { direction: string; quest?: string; pointer: string; name: string; sentenceSession: string; declaredAt?: string }): ArtifactRecord;
 listArtifacts(direction?: string): ArtifactRecord[];

 writeAdvice(note: AdviceNote): void; // REPLACES vault/coach/advice/<slug>.md (Q-77 — structural cap)
 readAdvice(slug: string): AdviceNote | null;
 markAdviceRead(slug: string, at: string): void;
};

export function createCoachStore(vaultRoot: string): CoachStore {
 return new CoachStoreImpl(vaultRoot);
}

/**
 * Frontmatter of every transcript, with the quest/direction tags T4 adds.
 * Derived, cheap, recomputed. A transcript without a `session` or a `started`
 * key is not a sitting the coach can reason about and is skipped.
 */
export function readSittingTags(vaultRoot: string): SittingTag[] {
 const dir = join(vaultRoot, 'transcripts');
 let files: string[];
 try {
  files = readdirSync(dir);
 } catch {
  return [];
 }
 const tags: SittingTag[] = [];
 for (const f of files) {
  if (!f.endsWith('.md')) continue;
  const parsed = matter.read(join(dir, f));
  const data = parsed.data as Record<string, unknown>;
  const session = data.session as string | undefined;
  const started = data.started as string | undefined;
  if (!session || !started) continue;
  tags.push({
   session,
   started,
   ...(data.quest ? { quest: data.quest as string } : {}),
   ...(data.direction ? { direction: data.direction as string } : {}),
  });
 }
 return tags;
}

class CoachStoreImpl implements CoachStore {
 #root: string;

 constructor(root: string) {
  this.#root = root;
 }

 // ── the four record dirs under vault/coach/ ──

 #directionsDir(): string {
  const d = join(this.#root, 'coach', 'directions');
  mkdirSync(d, { recursive: true });
  return d;
 }

 #questsDir(): string {
  const d = join(this.#root, 'coach', 'quests');
  mkdirSync(d, { recursive: true });
  return d;
 }

 #artifactsDir(): string {
  const d = join(this.#root, 'coach', 'artifacts');
  mkdirSync(d, { recursive: true });
  return d;
 }

 #adviceDir(): string {
  const d = join(this.#root, 'coach', 'advice');
  mkdirSync(d, { recursive: true });
  return d;
 }

 #parseDirection(data: Record<string, unknown>): DirectionRecord {
  return {
   slug: data.slug as string,
   name: data.name as string,
   coached: data.coached as boolean,
   ...(data.coachedAt ? { coachedAt: data.coachedAt as string } : {}),
   ...(data.uncoachedAt ? { uncoachedAt: data.uncoachedAt as string } : {}),
   ...(data.offerDeclinedAt ? { offerDeclinedAt: data.offerDeclinedAt as string } : {}),
   ...(data.seededOfferParkedAt ? { seededOfferParkedAt: data.seededOfferParkedAt as string } : {}),
   ...(data.seededOfferParkedClaimCount !== undefined
    ? { seededOfferParkedClaimCount: data.seededOfferParkedClaimCount as number }
     : {}),
    ...(data.seeded ? { seeded: true } : {}),
    ...(data.lastVisit ? { lastVisit: data.lastVisit as string } : {}),
   declinedOptions: Array.isArray(data.declinedOptions) ? (data.declinedOptions as string[]) : [],
  };
 }

 #readDirection(slug: string): DirectionRecord | null {
  try {
   const parsed = matter.read(join(this.#directionsDir(), `${slug}.md`));
   return this.#parseDirection(parsed.data as Record<string, unknown>);
  } catch {
   return null;
  }
 }

 #writeDirection(rec: DirectionRecord): void {
  const fm: Record<string, unknown> = {
   slug: rec.slug,
   name: rec.name,
   coached: rec.coached,
   declinedOptions: rec.declinedOptions,
  };
  if (rec.coachedAt) fm.coachedAt = rec.coachedAt;
  if (rec.uncoachedAt) fm.uncoachedAt = rec.uncoachedAt;
  if (rec.offerDeclinedAt) fm.offerDeclinedAt = rec.offerDeclinedAt;
  if (rec.seededOfferParkedAt) fm.seededOfferParkedAt = rec.seededOfferParkedAt;
  if (rec.seededOfferParkedClaimCount !== undefined) fm.seededOfferParkedClaimCount = rec.seededOfferParkedClaimCount;
  if (rec.seeded) fm.seeded = true;
  if (rec.lastVisit) fm.lastVisit = rec.lastVisit;
  const content = matter.stringify('', fm);
  writeFileSync(join(this.#directionsDir(), `${rec.slug}.md`), content, 'utf-8');
 }

 /**
  * The person's declaration (Q-73 — the ONLY door). Idempotent on slug: a
  * re-declaration keeps the first coachedAt and flips coached back on, so
  * uncoach → re-declare round-trips without losing history.
  */
 declareCoached(name: string): DirectionRecord {
  const slug = directionSlugFor(name);
  const existing = this.#readDirection(slug);
  const rec: DirectionRecord = {
   slug,
   name,
   coached: true,
   coachedAt: existing?.coachedAt ?? new Date().toISOString(),
   ...(existing?.uncoachedAt ? { uncoachedAt: existing.uncoachedAt } : {}),
   ...(existing?.offerDeclinedAt ? { offerDeclinedAt: existing.offerDeclinedAt } : {}),
   ...(existing?.lastVisit ? { lastVisit: existing.lastVisit } : {}),
   declinedOptions: existing?.declinedOptions ?? [],
  };
  this.#writeDirection(rec);
  return rec;
 }

 /** Flipping the lens off archives nothing (Q-73): every file stays. */
 uncoach(slug: string): DirectionRecord | null {
  const rec = this.#readDirection(slug);
  if (!rec) return null;
  rec.coached = false;
  rec.uncoachedAt = new Date().toISOString();
  this.#writeDirection(rec);
  return rec;
 }

 getDirection(slug: string): DirectionRecord | null {
  return this.#readDirection(slug);
 }

 /** Both the coached and the un-coached records — the offer reads both. */
 listDirections(): DirectionRecord[] {
  const dir = this.#directionsDir();
  const out: DirectionRecord[] = [];
  for (const f of readdirSync(dir)) {
   if (!f.endsWith('.md')) continue;
   out.push(this.#parseDirection(matter.read(join(dir, f)).data as Record<string, unknown>));
  }
  return out;
 }

 recordVisit(slug: string, at: string): void {
  const rec = this.#readDirection(slug);
  if (!rec) return;
  rec.lastVisit = at;
  this.#writeDirection(rec);
 }

 /**
  * Q-112: a seeded offer declined parks, never permanently declines.
  * A coached-direction offer declined is permanent (Q-77). A never-declared
  * name gets a stub record — the offer can only decline a candidate it
  * surfaced, and the stub keeps the candidate on disk so the decline
  * survives a restart.
  */
 recordOfferDeclined(slug: string): void {
  const existing = this.#readDirection(slug);
  if (existing && existing.seeded) {
   // Q-112: park seeded directions (decline is temporary)
   existing.seededOfferParkedAt = new Date().toISOString();
   if (existing.seededOfferParkedClaimCount === undefined) {
    existing.seededOfferParkedClaimCount = 0;
   }
   this.#writeDirection(existing);
   return;
  }
  // Coached direction or no existing record: permanent decline (Q-77)
  const rec: DirectionRecord = existing ?? {
   slug,
   name: slug, // a stub has only the slug to speak for it
   coached: false,
   declinedOptions: [],
  };
  rec.offerDeclinedAt = new Date().toISOString();
  this.#writeDirection(rec);
 }

 /** Q-110 door 2: create an un-coached DirectionRecord. Idempotent on slug. */
 createUncoached(name: string, opts?: { seeded?: boolean; claimCount?: number }): DirectionRecord {
   const slug = directionSlugFor(name);
   const existing = this.#readDirection(slug);
   if (existing) return existing;
   const rec: DirectionRecord = {
     slug, name, coached: false, declinedOptions: [],
     ...(opts?.seeded ? { seeded: true as const } : {}),
     ...(opts?.claimCount !== undefined ? { seededOfferParkedClaimCount: opts.claimCount } : {}),
   };
   this.#writeDirection(rec);
   return rec;
 }

 /** Normalized texts of declined options — never re-offered (Q-77). */
 addDeclinedOption(slug: string, text: string): void {
  const normalized = normalizeOption(text);
  const rec = this.#readDirection(slug);
  if (!rec) return;
  if (rec.declinedOptions.includes(normalized)) return;
  rec.declinedOptions = [...rec.declinedOptions, normalized];
  this.#writeDirection(rec);
 }

 // ── quests ──

 #parseQuest(parsed: { data: Record<string, unknown>; content: string }): Quest {
  return {
   id: parsed.data.id as string,
   direction: parsed.data.direction as string,
   act: parsed.content.trimEnd(),
   cites: Array.isArray(parsed.data.cites) ? (parsed.data.cites as string[]) : [],
   adoptedAt: parsed.data.adoptedAt as string,
   ...(parsed.data.retiredAt ? { retiredAt: parsed.data.retiredAt as string } : {}),
  };
 }

 #readQuest(id: string): Quest | null {
  try {
   return this.#parseQuest(matter.read(join(this.#questsDir(), `${id}.md`)));
  } catch {
   return null;
  }
 }

 #writeQuest(q: Quest): void {
  const fm: Record<string, unknown> = {
   id: q.id,
   direction: q.direction,
   cites: q.cites,
   adoptedAt: q.adoptedAt,
  };
  if (q.retiredAt) fm.retiredAt = q.retiredAt;
  const content = matter.stringify(q.act, fm);
  writeFileSync(join(this.#questsDir(), `${q.id}.md`), content, 'utf-8');
 }

 /** Adoption MINTS the quest record (Q-74); the act text is the body. */
 adoptQuest(input: { direction: string; act: string; cites: string[] }): Quest {
  const q: Quest = {
   id: ulid(),
   direction: input.direction,
   act: input.act,
   cites: input.cites,
   adoptedAt: new Date().toISOString(),
  };
  this.#writeQuest(q);
  return q;
 }

 /** The person's verb (Q-75): a field write, never a deletion. */
 retireQuest(id: string): Quest | null {
  const q = this.#readQuest(id);
  if (!q) return null;
  q.retiredAt = new Date().toISOString();
  this.#writeQuest(q);
  return q;
 }

 getQuest(id: string): Quest | null {
  return this.#readQuest(id);
 }

 listQuests(direction?: string): Quest[] {
  const dir = this.#questsDir();
  const out: Quest[] = [];
  for (const f of readdirSync(dir)) {
   if (!f.endsWith('.md')) continue;
   const q = this.#parseQuest(matter.read(join(dir, f)));
   if (direction === undefined || q.direction === direction) out.push(q);
  }
  return out;
 }

 /**
  * Computed, never stored (Q-75) — a stored status could lie; a derived one
  * cannot. retiredAt → retired; else any sitting tagged with the quest →
  * returned; else adopted.
  */
 questStatus(q: Quest, tags: SittingTag[]): QuestStatus {
  if (q.retiredAt) return 'retired';
  if (tags.some((t) => t.quest === q.id)) return 'returned';
  return 'adopted';
 }

 // ── artifacts ──

 #parseArtifact(data: Record<string, unknown>): ArtifactRecord {
  return {
   id: data.id as string,
   direction: data.direction as string,
   ...(data.quest ? { quest: data.quest as string } : {}),
   pointer: data.pointer as string,
   name: data.name as string,
   sentenceSession: data.sentenceSession as string,
   declaredAt: data.declaredAt as string,
  };
 }

 #writeArtifact(a: ArtifactRecord): void {
  const fm: Record<string, unknown> = {
   id: a.id,
   direction: a.direction,
   pointer: a.pointer,
   name: a.name,
   sentenceSession: a.sentenceSession,
   declaredAt: a.declaredAt,
  };
  if (a.quest) fm.quest = a.quest;
  const content = matter.stringify('', fm);
  writeFileSync(join(this.#artifactsDir(), `${a.id}.md`), content, 'utf-8');
 }

 declareArtifact(input: { direction: string; quest?: string; pointer: string; name: string; sentenceSession: string; declaredAt?: string }): ArtifactRecord {
  const a: ArtifactRecord = {
   id: ulid(),
   direction: input.direction,
   ...(input.quest ? { quest: input.quest } : {}),
   pointer: input.pointer,
   name: input.name,
   sentenceSession: input.sentenceSession,
   declaredAt: input.declaredAt ?? new Date().toISOString(),
  };
  this.#writeArtifact(a);
  return a;
 }

 listArtifacts(direction?: string): ArtifactRecord[] {
  const dir = this.#artifactsDir();
  const out: ArtifactRecord[] = [];
  for (const f of readdirSync(dir)) {
   if (!f.endsWith('.md')) continue;
   const a = this.#parseArtifact(matter.read(join(dir, f)).data as Record<string, unknown>);
   if (direction === undefined || a.direction === direction) out.push(a);
  }
  return out;
 }

 // ── advice ──

 #parseAdvice(data: Record<string, unknown>): AdviceNote {
  return {
   direction: data.direction as string,
   mintedAt: data.mintedAt as string,
   license: data.license as CoachLicenseEvent,
   options: Array.isArray(data.options) ? (data.options as QuestOption[]) : [],
   ...(data.readAt ? { readAt: data.readAt as string } : {}),
  };
 }

 /**
  * The ONLY advice write, and it OVERWRITES (Q-77 — structural cap): one file
  * per Direction, so a stacked second note is unrepresentable and silence
  * over an option evaporates with the next replacement.
  */
 writeAdvice(note: AdviceNote): void {
  const fm: Record<string, unknown> = {
   direction: note.direction,
   mintedAt: note.mintedAt,
   license: note.license,
   options: note.options,
  };
  if (note.readAt) fm.readAt = note.readAt;
  const content = matter.stringify('', fm);
  writeFileSync(join(this.#adviceDir(), `${note.direction}.md`), content, 'utf-8');
 }

 readAdvice(slug: string): AdviceNote | null {
  try {
   const parsed = matter.read(join(this.#adviceDir(), `${slug}.md`));
   return this.#parseAdvice(parsed.data as Record<string, unknown>);
  } catch {
   return null;
  }
 }

 markAdviceRead(slug: string, at: string): void {
  const note = this.readAdvice(slug);
  if (!note) return;
  note.readAt = at;
  this.writeAdvice(note);
 }
}
