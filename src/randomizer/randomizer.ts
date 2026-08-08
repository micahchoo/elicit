/**
 * The Randomizer — Q-18's draw, and the constraint that it can only ever
 * shuffle.
 *
 * **This module holds no model handle. There is no such parameter anywhere in
 * its public surface, and that absence IS the contract.** A reader deciding
 * whether an invented question can leave here does not have to trace a call
 * graph: the one argument is a bag of file paths, two read-only stores, a
 * clock and a source of uniform randomness, and none of them can reach an LLM.
 * `tests/randomizer.test.ts` holds it shut three ways — a `@ts-expect-error` on
 * a second argument, a check that no import specifier names a model-bearing
 * module, and a grep of this file's own source for the words that appear where
 * a model is being called. The grep is the one `src/wiki/lint.ts` invites; it
 * is written down here as a test rather than left as a habit.
 *
 * Why so much machinery for one rule. Q-18's reasoning is that the agent's
 * inventions are correlated with the agent's own model, so a "random" question
 * it writes is not uncorrelated variety, it is the same voice at a higher
 * temperature — and Fu et al.'s "too far" noise is what the person actually
 * experiences. The only genuinely uncorrelated sources available are the
 * person's own older self and a deck someone curated by hand. So the draw has
 * exactly two channels and both are shuffles of material that already exists.
 *
 * The other half of Q-18, and of Q-16: the agent may not VETO a draw either.
 * `invokedBy: 'user'` therefore reaches the pool with no licence check in its
 * path. The licence is computed and logged on that path too, because the
 * evidence is free (Q-23) — but it is evidence, not a gate.
 */

import { readEvents, appendEvent } from '../log/activity.js';
import type { EventKind } from '../log/kinds.js';
import {
  applyFacetBalance,
  facetBalanceIsLive,
  readVaultFacetDistribution,
  underRepresented,
} from '../queue/facet-balance.js';
import type {
  DeckEntry,
  DrawProvenance,
  Facet,
  Index,
  QueueEntry,
  QuestionForm,
  Stratum,
} from '../types.js';
import { deckCardRef, loadDecks } from './decks.js';
import { licenseForDraw, type LicenseVerdict } from './license.js';
import {
  bySitting,
  datedSnippets,
  readSittingDates,
  stratify,
  type DatedSnippet,
} from './strata.js';
import {
  daysBetween,
  RANDOMIZER_THRESHOLDS,
  type RandomizerThresholds,
} from './thresholds.js';

/** Who asked. The only thing the licence is allowed to change. */
export type InvokedBy = 'user' | 'system';

export type RandomizerDraw = {
  question: string;
  questionForm: QuestionForm;
  provenance: 'deck' | 'resurfacing';
  draw: DrawProvenance;
  /** Carried from the deck's curation. Never inferred, never guessed. */
  targetFacet?: Facet;
  /**
   * Display-only lineage (ticket 073): the probe that elicited the
   * resurfaced snippet (Provenance.question). Never quoted into `question`,
   * never enters the transcript. Resurfacing draws only.
   */
  snippetQuestion?: string;
  /**
   * Display-only lineage (ticket 073): the antecedent window
   * (Provenance.context). Never quoted into `question`, never enters the
   * transcript. Resurfacing draws only.
   */
  context?: string;
};

/**
 * Everything the draw is allowed to touch. Read the field list as the proof of
 * the module docstring: two readers, a directory, a clock, a coin.
 */
export type RandomizerDeps = {
  /** Vault root. Snippets, transcripts, the Activity Log and vault decks. */
  root: string;
  vault: { rebuildIndex: () => Index };
  queue: { list: () => QueueEntry[] };
  /** Where the shipped JSONL decks live. Defaults to `data/decks`. */
  deckDir?: string;
  now?: Date;
  /** Uniform in [0,1). Injected so a test can name the card it will get. */
  random?: () => number;
  thresholds?: RandomizerThresholds;
  env?: Record<string, string | undefined>;
};

/**
 * The frame a resurfaced snippet is put in. A CONSTANT, and it has to be: the
 * question the person is asked about their own words must not be written by a
 * model, and the words themselves are reproduced verbatim and set off, which
 * is what ticket 040 fixed everywhere else in the tree.
 *
 * Not truncated at any length. Trimming a long snippet to fit a question box
 * would be the agent editing the person's prose (Q-1), and a paragraph they
 * wrote in 2020 is exactly the thing worth reading back in full.
 */
export function resurfaceQuestion(wroteOn: string, prose: string): string {
  return `You wrote this on ${wroteOn}:\n\n"${prose}"\n\nWhat do you make of it now?`;
}

/** Uniform pick. The last step of every draw, and the only step chance takes. */
function pick<T>(items: T[], r: number): T {
  const i = Math.min(items.length - 1, Math.floor(r * items.length));
  return items[i]!;
}

/** Fixed band order, so a given rng sequence draws the same band everywhere. */
const STRATUM_ORDER: readonly Stratum[] = ['recent', 'season', 'years', 'deep'];

/**
 * What the person has seen lately, by ref. Both channels write their ref into
 * `randomizer-drawn`, so the same read serves both — the log IS the memory,
 * and nothing else has to be persisted for a shuffle not to repeat itself.
 */
function recentlyDrawn(root: string, now: Date, t: RandomizerThresholds): Set<string> {
  const cutoff = t['randomizer.cooldownDays'].value;
  const seen = new Set<string>();
  for (const e of readEvents(root)) {
    if (e.kind !== 'randomizer-drawn') continue;
    if (daysBetween(e.at, now) > cutoff) continue;
    for (const r of e.refs ?? []) seen.add(r);
  }
  return seen;
}

/** Every act is logged (Q-23). A draw never fails on its own log line. */
function log(root: string, kind: EventKind, detail: string, refs: string[], now: Date): void {
  try {
    appendEvent(root, {
      at: now.toISOString(),
      actor: 'elicitor',
      kind,
      detail,
      ...(refs.length > 0 ? { refs } : {}),
    });
  } catch {
    // Deliberately silent, exactly as the queue's draw logging is.
  }
}

function deckDraw(
  entries: DeckEntry[],
  root: string,
  env: Record<string, string | undefined>,
  r: number,
): { draw: RandomizerDraw; ref: string; facetFilter: string } {
  // Q-13 in its usual order: constraints, then chance. The facet filter is the
  // same one the Queue's draw runs, on the same graduation switch — a deck
  // entry's `targetFacet` exists precisely so this can bite (ticket 042).
  const live = facetBalanceIsLive(env);
  const wanted = underRepresented(readVaultFacetDistribution(root));
  const balanced = applyFacetBalance(entries, wanted);
  const pool = live && balanced.applied ? balanced.kept : entries;
  const card = pick(pool, r);
  return {
    draw: {
      question: card.question,
      questionForm: 'deliberative',
      provenance: 'deck',
      draw: { kind: 'deck', deck: card.deck, channel: card.channel, blockId: card.blockId },
      ...(card.targetFacet ? { targetFacet: card.targetFacet } : {}),
    },
    ref: deckCardRef(card),
    facetFilter: `${live ? 'live' : 'shadow'}/${balanced.applied ? 'applied' : 'stood-down'}`,
  };
}

function resurfaceDraw(
  snips: DatedSnippet[],
  random: () => number,
): { draw: RandomizerDraw; ref: string } {
  // Three uniform picks, and each one answers a different skew — see the
  // header of `strata.ts` for the measurements that made all three necessary.
  const strata = stratify(snips);
  const bands = STRATUM_ORDER.filter((s) => strata.has(s));
  const band = pick(bands, random());
  const sittings = bySitting(strata.get(band)!);
  const sitting = pick(sittings, random());
  const s = pick(sitting, random());
  return {
    draw: {
      question: resurfaceQuestion(s.wroteAt.slice(0, 10), s.prose),
      questionForm: 'deliberative',
      provenance: 'resurfacing',
      draw: {
        kind: 'resurfacing',
        snippetId: s.id,
        version: s.version,
        stratum: s.stratum,
        wroteAt: s.wroteAt,
      },
      // Display-only lineage (ticket 073): carried verbatim for a display
      // seam, absent when the snippet's provenance holds nothing. Never
      // spliced into the framed question above.
      ...(s.question ? { snippetQuestion: s.question } : {}),
      ...(s.context ? { context: s.context } : {}),
    },
    ref: s.id,
  };
}

/**
 * An anniversary draw — the third Randomizer channel (ticket 107).
 * Filters snippets to those whose wroteAt month+day matches `now`,
 * then picks uniformly. Returns null when no snippet anniversary falls today.
 *
 * Q-18 holds by construction: every candidate is a date the user wrote,
 * and no model is involved. The channel is an OFFER (Q-62): the waiting
 * surface requests it explicitly, and the user declines with one tap.
 *
 * The `question` field carries a floor line (date + quote). The composed
 * layer owns the wording per the 079 pattern; this is the fallback.
 */
export function anniversaryDraw(
  snips: DatedSnippet[],
  random: () => number,
  now: Date,
): { draw: RandomizerDraw; ref: string } | null {
  const month = now.getMonth();
  const day = now.getDate();

  const candidates = snips.filter((s) => {
    const d = new Date(s.wroteAt);
    return d.getMonth() === month && d.getDate() === day;
  });

  if (candidates.length === 0) return null;

  const s = pick(candidates, random());
  const wroteOn = s.wroteAt.slice(0, 10);
  const yearDiff = now.getFullYear() - new Date(s.wroteAt).getFullYear();
  const ago = yearDiff <= 0 ? 'this year' : yearDiff === 1 ? '1 year ago' : `${yearDiff} years ago`;

  return {
    draw: {
      question: `${wroteOn} (${ago}):\n\n"${s.prose}"`,
      questionForm: 'deliberative',
      provenance: 'resurfacing',
      draw: {
        kind: 'anniversary',
        snippetId: s.id,
        version: s.version,
        stratum: s.stratum,
        wroteAt: s.wroteAt,
      },
      ...(s.question ? { snippetQuestion: s.question } : {}),
      ...(s.context ? { context: s.context } : {}),
    },
    ref: s.id,
  };
}

/**
 * Build the draw. One call, one shuffle, one pair of log lines.
 *
 * `invokedBy` is the ONLY thing the licence can change:
 *
 *   - `'user'` — the person pressed "shuffle a deck". Q-16 forbids the veto,
 *     so the licence is computed, logged and then not consulted. A shuffle
 *     that the system declined to perform would be the agent's judgement
 *     overriding an explicit request, which is the failure Q-16 names.
 *   - `'system'` — nobody asked. The draw happens only when a coverage ground
 *     was found AND the threshold behind that ground has graduated (Q-35), so
 *     today it never happens and the shadow log accumulates the record that
 *     would let it.
 *
 * Returns null when there is nothing to shuffle. That is not a failure: the
 * caller falls through to its own opener, exactly as it does at the Queue's
 * composing floor (Q-55).
 */
export function createRandomizer(deps: RandomizerDeps): (invokedBy: InvokedBy) => RandomizerDraw | null {
  return (invokedBy) => {
    const now = deps.now ?? new Date();
    const random = deps.random ?? Math.random;
    const t = deps.thresholds ?? RANDOMIZER_THRESHOLDS;
    const env = deps.env ?? process.env;

    const verdict: LicenseVerdict = licenseForDraw({
      entries: deps.queue.list(),
      events: readEvents(deps.root),
      now,
      thresholds: t,
    });

    log(
      deps.root,
      'randomizer-license',
      `invokedBy=${invokedBy} grounds=${verdict.grounds} licensed=${verdict.licensed} live=${verdict.live} ${verdict.detail}`,
      [],
      now,
    );

    if (invokedBy === 'system' && !(verdict.licensed && verdict.live)) return null;

    const seen = recentlyDrawn(deps.root, now, t);

    const cards = loadDecks({
      ...(deps.deckDir !== undefined ? { deckDir: deps.deckDir } : {}),
      vaultRoot: deps.root,
    }).filter((e) => !seen.has(deckCardRef(e)));

    const snips = datedSnippets(
      deps.vault.rebuildIndex(),
      readSittingDates(deps.root),
      now,
      t,
    ).filter((s) => !seen.has(s.id));

    // A uniform pick between the channels that have something in them. Neither
    // channel is preferred: they are two uncorrelated sources and ranking them
    // would be the correlation Q-18 is trying to avoid.
    const channels: ('deck' | 'resurfacing')[] = [];
    if (cards.length > 0) channels.push('deck');
    if (snips.length > 0) channels.push('resurfacing');
    if (channels.length === 0) {
      log(
        deps.root,
        'randomizer-empty',
        `invokedBy=${invokedBy} decks=0 snippets=0 cooldown=${seen.size}`,
        [],
        now,
      );
      return null;
    }

    const channel = pick(channels, random());

    if (channel === 'deck') {
      const { draw, ref, facetFilter } = deckDraw(cards, deps.root, env, random());
      log(
        deps.root,
        'randomizer-drawn',
        `channel=deck deck=${draw.draw.kind === 'deck' ? draw.draw.deck : ''} pool=${cards.length} facetFilter=${facetFilter} grounds=${verdict.grounds}`,
        [ref],
        now,
      );
      return draw;
    }

    const { draw, ref } = resurfaceDraw(snips, random);
    const d = draw.draw;
    log(
      deps.root,
      'randomizer-drawn',
      `channel=resurfacing stratum=${d.kind === 'resurfacing' ? d.stratum : ''} wrote=${d.kind === 'resurfacing' ? d.wroteAt.slice(0, 10) : ''} pool=${snips.length} grounds=${verdict.grounds}`,
      [ref],
      now,
    );
    return draw;
  };
}
