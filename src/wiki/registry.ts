/**
 * The identity registry — Q-32, which is a decision about POWER and not about
 * data modelling.
 *
 * **The model may add structure, link reversibly, and never collapse.** Who
 * counts as "the same" is self-description, not inference. A wrong alias
 * surfaces later as an absurd Juxtaposition and is edited away in one line of
 * markdown; a wrong merge is invisible and permanent, because after it there is
 * nothing left that remembers there were two.
 *
 * So this module has three write tiers, and the third does not exist:
 *
 *   1. **MINT** — an unknown name becomes a referent, freely. Reversible:
 *      delete the file.
 *   2. **ALIAS** — a name is linked to an existing canonical, if that canonical
 *      exists. Reversible: delete the line. An alias whose canonical is unknown
 *      is DROPPED and the name is minted on its own, because an unresolvable
 *      alias that silently linked to the nearest thing would be inference.
 *   3. **MERGE** — absent. There is no method, no export, and no code path.
 *      `mergeCandidates` returns pairs to LOOK at and mutates nothing; the
 *      merge verb belongs to the editing slice, takes user attestation, and
 *      will live in another module.
 *
 * The invariant that keeps tier 3 out is behavioural and testable: **no path
 * here reduces the referent count.** `listReferents().length` is monotonically
 * non-decreasing across any sequence of `resolve` calls, and
 * `tests/wiki-registry.test.ts` drives fifty randomized ones to say so.
 *
 * Two consequences worth naming, because both are places a later contributor
 * would reach for a merge without noticing:
 *
 *   - `resolve({ name, aliasOf })` where BOTH names already exist is a merge
 *     wearing an alias's clothes: it would fold one live entry into another.
 *     It is refused, logged, and left for a human.
 *   - A second reference proposing a different `kind` for a known name does not
 *     rewrite the entry. Re-describing an entity the user already described is
 *     the same power in a smaller costume.
 *
 * The similarity measure is PURE STRING WORK and this module names no model
 * type anywhere (Q-32); the entries are vault markdown written through the
 * store (Q-3); every entry carries the caller's stamp (Q-34); every tier logs
 * (Q-23); and the one threshold it reads goes through `shadowDecision` (Q-35).
 */

import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  LogFn,
  Referent,
  ReferentRef,
  Registry,
} from './contract.js';
import type { ThresholdRegister } from './lint.js';
import { THRESHOLDS, shadowDecision } from './thresholds.js';

/**
 * Longest slug this module will mint. A canonical name has no length limit and
 * a file name does; truncating here keeps the collision suffix meaningful,
 * since two long names that agree for 64 characters get `-2` rather than a
 * write that fails somewhere below.
 */
const SLUG_MAX = 64;

/** The slug for a name that survives normalization as nothing at all. */
const SLUG_FALLBACK = 'referent';

/**
 * Build a registry over a store.
 *
 * `thresholds` is optional and defaults to the shipped register, so every call
 * site written from the plan's three-argument signature is correct verbatim.
 * It exists so a test can graduate `registry.mergeCandidateSimilarity` by
 * flipping one boolean (Q-35) — the same door `lint` uses, and the reason the
 * shadow can be proven rather than assumed.
 *
 * Returns a plain object rather than a class instance, so the four methods are
 * ENUMERABLE: `Object.keys(registry)` is the whole power of this thing, and a
 * test can assert that none of it is a merge.
 */
export function createRegistry(
  store: ClaimStore,
  model: string,
  log: LogFn,
  thresholds: ThresholdRegister = THRESHOLDS,
): Registry {
  /**
   * The in-memory index, loaded once and kept in step with every write.
   *
   * Derived and disposable (Q-3): the markdown is the truth, this is a map of
   * it, and a registry built later reads the files again. It exists because
   * `resolve` is called once per referent per op during a sweep, and a
   * directory re-read per call is quadratic disk I/O for a question the run
   * already knows the answer to.
   */
  let bySlug: Map<string, Referent> | null = null;

  function index(): Map<string, Referent> {
    if (!bySlug) {
      bySlug = new Map(store.listReferents().map((r) => [r.slug, r]));
    }
    return bySlug;
  }

  /** Write through the store, then keep the index in step. Never removes. */
  function save(r: Referent): void {
    store.writeReferent(r);
    index().set(r.slug, r);
  }

  function lookup(name: string): Referent | null {
    const key = normalize(name);
    if (key === '') return null;
    for (const r of index().values()) {
      if (normalize(r.canonical) === key) return r;
      if (r.aliases.some((a) => normalize(a) === key)) return r;
    }
    return null;
  }

  /**
   * What an `aliasOf` names: a canonical or alias NAME, or the slug itself.
   * The slug fallback costs one lookup and cannot create a wrong link — a slug
   * that resolves names exactly one existing entry — while refusing it would
   * drop a well-formed proposal over spelling.
   */
  function namedCanonical(aliasOf: string): Referent | null {
    return lookup(aliasOf) ?? index().get(aliasOf.trim()) ?? null;
  }

  function uniqueSlug(base: string): string {
    const taken = index();
    if (!taken.has(base)) return base;
    // A numeric suffix, never a reuse: two distinct referents sharing a file
    // would be a merge performed by the filesystem.
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  function mint(ref: ReferentRef): Referent {
    const at = new Date().toISOString();
    const canonical = ref.name.trim();
    const minted: Referent = {
      slug: uniqueSlug(slugify(canonical)),
      canonical,
      kind: ref.kind,
      aliases: [],
      // Q-34: the stamp is the caller's, so the record says which model
      // produced this artifact and the two roles stay separable (Q-48).
      model,
      modelAt: at,
      created: at,
      updated: at,
      // `note` is deliberately absent rather than present-and-undefined: a
      // required key holding `undefined` throws in `matter.stringify` and the
      // whole write is lost.
    };
    save(minted);
    log({
      at,
      actor: 'clerk',
      kind: 'referent-minted',
      detail: `slug=${minted.slug} kind=${minted.kind} name="${minted.canonical}"`,
      refs: [minted.slug],
    });
    return minted;
  }

  /**
   * Called from ONE place, and only when `lookup(name)` came back empty — so
   * the name is neither this canonical nor one of its aliases, and there is no
   * duplicate to guard against here. The guard lives in `resolve`, where the
   * early return on an existing referent is what makes a repeated proposal a
   * no-op.
   */
  function addAlias(canonical: Referent, name: string): Referent {
    const alias = name.trim();
    const at = new Date().toISOString();
    // The stamp moves with the write (Q-34): the entry as it now stands was
    // last written by THIS model, and a stale stamp would tell the lazy
    // re-annotation that a model it has never run has seen the alias.
    const linked: Referent = {
      ...canonical,
      aliases: [...canonical.aliases, alias],
      model,
      modelAt: at,
      updated: at,
    };
    save(linked);
    log({
      at,
      actor: 'clerk',
      kind: 'referent-aliased',
      detail: `slug=${linked.slug} alias="${alias}"`,
      refs: [linked.slug],
    });
    return linked;
  }

  function resolve(ref: ReferentRef): Referent {
    const existing = lookup(ref.name);
    const canonical = ref.aliasOf === undefined ? null : namedCanonical(ref.aliasOf);

    if (existing) {
      if (ref.kind !== existing.kind) {
        // Not an error and not a rewrite. The entry stands as the user's
        // description of it, and the disagreement is a note.
        log({
          at: new Date().toISOString(),
          actor: 'clerk',
          kind: 'referent-kind-differs',
          detail: `slug=${existing.slug} stored=${existing.kind} proposed=${ref.kind}`,
          refs: [existing.slug],
        });
      }

      if (canonical && canonical.slug !== existing.slug) {
        // TIER 3 IN DISGUISE. Both names are already referents, so applying
        // this alias would fold one live entry into another — a collapse, and
        // the one thing this module must never do (Q-32). It becomes a note
        // for a human, who is the only one who can say they are the same.
        log({
          at: new Date().toISOString(),
          actor: 'clerk',
          kind: 'referent-alias-refused',
          detail:
            `existing=${existing.slug} aliasOf=${canonical.slug} ` +
            'both names are already referents; only user attestation merges two identities',
          refs: [existing.slug, canonical.slug],
        });
        return existing;
      }

      if (ref.aliasOf !== undefined && !canonical) {
        logUnresolvedAlias(ref, existing.slug);
      }
      return existing;
    }

    if (canonical) return addAlias(canonical, ref.name);

    if (ref.aliasOf !== undefined) {
      // The proposal is dropped and the name stands on its own. Linking it to
      // the nearest existing entry instead would be a silent link, which is
      // the failure this branch exists to prevent.
      const minted = mint(ref);
      logUnresolvedAlias(ref, minted.slug);
      return minted;
    }

    return mint(ref);
  }

  function logUnresolvedAlias(ref: ReferentRef, slug: string): void {
    log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'referent-alias-unresolved',
      detail: `name="${ref.name.trim()}" aliasOf="${ref.aliasOf ?? ''}" stands as slug=${slug}`,
      refs: [slug],
    });
  }

  /**
   * Every claim that names this slug, in graph order.
   *
   * Archived and superseded claims are INCLUDED: this is a lookup, and the
   * caller that cares about liveness — T11's referent channel pools only live
   * claims — is the one that knows which question it is asking. A lookup that
   * silently dropped rows would make "no claims" and "no live claims"
   * indistinguishable at the call site.
   */
  function claimsFor(slug: string, graph: ClaimGraph): Claim[] {
    return graph.claims.filter((c) => c.referents.includes(slug));
  }

  /**
   * Pairs of referents whose canonical names are close enough to be worth a
   * human's glance. **Pure**: it reads the graph it is given, writes no file,
   * and mutates nothing.
   *
   * Every pair carries BOTH referents, because a note on one entry is a note
   * the reader of the other never sees, and either is as likely to be the page
   * they open. T8 materializes the same fact as two `merge-candidate` findings,
   * one per subject; here it is one tuple, and the one-sided form does not
   * exist to be written by mistake.
   *
   * Shadowed (Q-35), and the shadow record is the point: nobody knows yet
   * whether 0.85 over token overlap surfaces pairs a human would agree about.
   * While the entry is shadowed this returns nothing at all and the log carries
   * what it would have returned.
   *
   * `lint`'s `merge-candidate` finding (T8) computes this same relation over
   * the same data, because `lint`'s signature takes a graph and not a registry
   * — deliberately, since a registry is a thing that can write. The duplication
   * cannot be removed from this side; it is made DETECTABLE instead, by a test
   * that drives both over one fixture and fails the day they disagree. If they
   * ever do, lint's is the note the user sees, and this one is wrong.
   */
  function mergeCandidates(graph: ClaimGraph): [Referent, Referent][] {
    const t = thresholds['registry.mergeCandidateSimilarity'];
    // The register admits booleans, because two of its entries are switches.
    // This one is a similarity; anything else is not one and is not acted on.
    if (typeof t.value !== 'number') return [];

    const referents = [...graph.referents].sort((a, b) =>
      a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
    );
    const pairs: [Referent, Referent][] = [];

    for (let i = 0; i < referents.length; i++) {
      const a = referents[i];
      if (!a) continue;
      for (let j = i + 1; j < referents.length; j++) {
        const b = referents[j];
        if (!b) continue;

        const score = nameSimilarity(a.canonical, b.canonical);
        if (score <= t.value) continue;

        const would = `pair merge-candidate ${a.slug} and ${b.slug} similarity=${score.toFixed(2)}`;
        if (!shadowDecision(t, would, log)) continue;

        pairs.push([a, b]);
      }
    }

    return pairs;
  }

  return { resolve, lookup, claimsFor, mergeCandidates };
}

/**
 * Normalized token overlap between two canonical names — Jaccard over the
 * words, case and punctuation and word order discarded.
 *
 * What it catches at 0.85: "Sarah Kim" against "kim, SARAH", "The Bakery"
 * against "the bakery ". What it does NOT catch: "Sarah" against "Sara", or
 * "Mum" against "Mother" — one shared token out of two scores 0.5, far under
 * the bar. That is the intended reach. Deciding that two differently spelled
 * names are one person is inference about identity, and Q-32 keeps inference
 * out of identity. The shadow record is what will say whether this reach is
 * enough.
 *
 * A pure string function, and the only similarity measure in the wiki slice.
 * `lint` imports this exported copy — the two files cannot drift (Phase 8).
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Unicode-aware, so a name with an accent in it is one token and not three. */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0),
  );
}

/** Trimmed and lower-cased: what "the same name" means for `lookup`. */
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A canonical name as a file name.
 *
 * Everything that is not a letter or a digit becomes a separator, which drops
 * `/`, `\`, `\0` and `.` on the way — the store rejects those outright, and a
 * referent named `../../etc/passwd` must not reach it as a path.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .join('-')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug === '' ? SLUG_FALLBACK : slug;
}
