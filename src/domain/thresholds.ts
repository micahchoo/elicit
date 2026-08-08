import type { EventKind } from '../log/kinds.js';
/**
 * The threshold shape — Q-35 turned into data, shared by every register.
 *
 * One definition of what a threshold IS, so the wiki register, the
 * randomizer register, the semantic channel's entries, and the sounding
 * gate's values cannot drift apart on the shape. Each subsystem keeps its
 * own register as DATA (values are decisions); only the shape lives here,
 * dependency-free, so the domain layer never has to import src/wiki/.
 */
export type Threshold = {
  name: string;
  value: number | boolean;
  /** False means: compute, log what you would have done, change nothing. */
  live: boolean;
  /**
   * The evidence that would license this threshold to act — prose, never a
   * date. For an entry that already acts, this records the licence it acts
   * under, so demoting it is as reviewable as promoting it.
   */
  graduatesWhen: string;
};

/** A log sink shaped like the audit log's events, for shadow decisions. */
export type ThresholdLogFn = (e: {
  at: string;
  actor: 'clerk';
  kind: EventKind;
  detail: string;
  refs?: string[];
}) => void;
