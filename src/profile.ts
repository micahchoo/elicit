import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Who the vault is about, in their own name (Micah's ruling, 2026-08-06:
 * "ask the user their name and pronouns, use it randomly"). Optional at
 * every layer: an empty profile leaves every prompt exactly as it was, so
 * a person who skips the question is never renamed "the user" — they just
 * stay unnamed.
 *
 * Stored beside the vault (profile.json), not inside a snippet: the name is
 * configuration the person typed into a form, not elicited words, so it must
 * never enter the corpus as evidence (Q-1).
 */
export type Profile = {
 /** What the person asked to be called. */
 name?: string;
 /** Free-form, e.g. "she/her", "they/them" — used verbatim in prompts. */
 pronouns?: string;
};

const FILE = 'profile.json';

export function readProfile(vaultRoot: string): Profile {
 const path = join(vaultRoot, FILE);
 if (!existsSync(path)) return {};
 try {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object') return {};
  const o = parsed as Record<string, unknown>;
  return {
   ...(typeof o.name === 'string' && o.name.trim() !== '' ? { name: o.name.trim() } : {}),
   ...(typeof o.pronouns === 'string' && o.pronouns.trim() !== '' ? { pronouns: o.pronouns.trim() } : {}),
  };
 } catch {
  return {};
 }
}

export function writeProfile(vaultRoot: string, profile: Profile): Profile {
 const clean: Profile = {
  ...(profile.name && profile.name.trim() !== '' ? { name: profile.name.trim() } : {}),
  ...(profile.pronouns && profile.pronouns.trim() !== '' ? { pronouns: profile.pronouns.trim() } : {}),
 };
 writeFileSync(join(vaultRoot, FILE), JSON.stringify(clean, null, 1) + '\n');
 return clean;
}

/**
 * The line appended to the harvest and mint system prompts when a profile
 * exists. "Vary naturally" is the ruling's "use it randomly" — the model
 * varies; code stays deterministic. Undefined when the profile is empty, so
 * callers can pass prompts through untouched.
 */
export function personaLine(profile: Profile): string | undefined {
 if (!profile.name && !profile.pronouns) return undefined;
 const who = profile.name
  ? `${profile.name}${profile.pronouns ? ` (${profile.pronouns})` : ''}`
  : `the person (${profile.pronouns})`;
 return (
  `The person these words belong to is ${who}. ` +
  `When you write ABOUT them (readings, interpretations, claim bodies), refer to them by ` +
  `${profile.name ? 'name or pronoun, varying naturally between the two' : 'their pronouns'} — ` +
  `never as "the user" or "the person". Their own quoted words stay exactly as written.`
 );
}

/**
 * The profile words the coach's theme clustering must ignore: with claims
 * now phrased "Ada keeps…", the NAME becomes the word every claim shares —
 * the exact mega-cluster failure the claim-frame stopwords fixed for "user".
 */
export function profileFrameWords(profile: Profile): string[] {
 const words: string[] = [];
 for (const source of [profile.name, profile.pronouns]) {
  if (!source) continue;
  for (const w of source.toLowerCase().split(/[^a-z0-9]+/)) {
   if (w.length >= 2) words.push(w);
  }
 }
 return words;
}
