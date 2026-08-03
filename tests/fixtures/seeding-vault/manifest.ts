/**
 * The committed seeding fixture: six files, no frontmatter in any of them,
 * pinned ONCE here because Tasks 4, 8 and 15 all count them — three separate
 * descriptions of the same vault disagreed, so the numbers live in one place.
 *
 * Load-bearing properties, recorded so a drift cannot pass silently:
 * - Three of the four admitted files OPEN their prose with an anaphor — 'This
 *   is what…', 'It started…', 'This is the week…' — with no preceding
 *   paragraph. That is Task 10's three danglers against a cap of 2; if a
 *   dangler count drifts silently, the repair test stops testing the cap.
 * - SHARED_SENTENCE lives verbatim in two files under two dates — Task 8's
 *   retelling (Q-71): one sentence, two source paths, two dates, kept twice.
 */
export const FIXTURE_FILES = 6;
export const FIXTURE_ADMITTED = 4;
export const FIXTURE_REFUSED = 2;
export const FIXTURE_DATES = ['2019-11-02', '2019-11-03', '2021-03-04', '2021-03-05'];
export const SHARED_SENTENCE = 'The same sentence in two files is a retelling, and the rule keeps both copies.';
