/**
 * Atlas territory instrument types — ticket 110.
 *
 * An atlas is an INSTRUMENT: a crude, generic map of what a life contains,
 * plural and quarreling by design. No single ontology of persons gets to be
 * the geography; where atlases disagree, both views stay.
 *
 * Region-to-corpus links are readings under Q-50 statuses (unconfirmed
 * until touched), never priors (Q-66 killed priors).
 */

/** How the atlas was generated — provenance, not a model stamp. */
export type AtlasProvenance = {
  /** Generator identity: e.g. 'hand-authored-seed' */
  generator: string;
  /** ISO-8601 timestamp of generation */
  generatedAt: string;
  /** The instrument this provenance belongs to */
  instrument: string;
};

/** One region of a life the atlas maps. */
export type AtlasRegion = {
  /** Stable slug: instrument.region — e.g. 'indexical-checklist.people' */
  id: string;
  /** Human label — never surfaced verbatim in question text (the oneLine is the question material) */
  label: string;
  /** The topic as a noun phrase — what the question names */
  oneLine: string;
};

/** A complete atlas instrument for one territory of the self. */
export type AtlasInstrument = {
  /** Stable instrument id — e.g. 'indexical-checklist' */
  instrument: string;
  /** Human-readable name */
  label: string;
  /** What this atlas maps and why — never rendered to the user */
  description: string;
  /** Atlas ids this atlas disagrees with; empty when none */
  quarrelsWith: string[];
  /** Provenance */
  provenance: AtlasProvenance;
  /** The regions this atlas maps */
  regions: AtlasRegion[];
};
