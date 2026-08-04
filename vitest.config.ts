import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, defaultExclude } from "vitest/config";
export default defineConfig({
  test: {
    // The suite asserts SHIPPED behavior. The runtime demotion/graduation
    // stores (data/{demotions,graduations}.json, read via ELICIT_DATA_DIR ??
    // cwd/data) are owner-instance state — on a machine where the loop has
    // graduated a shadow threshold, an un-pinned data dir would flip pin
    // tests. An empty temp dir keeps every run hermetic; tests that exercise
    // the stores set ELICIT_DATA_DIR themselves and restore it.
    env: { ELICIT_DATA_DIR: mkdtempSync(join(tmpdir(), "elicit-test-data-")) },
    // Worktrees under .claude/worktrees/ are parallel checkouts of this same
    // repo; without this exclude their entire test suites run again inside
    // ours (observed 2026-08-02: 180 files reported for a 94-file tests/).
    // Same for the improvement loop's variant worktrees and archived trials
    // (observed 2026-08-04: three copies of the real-boot test racing one
    // port, two losers asserting against the winner's server).
    exclude: [...defaultExclude, ".claude/worktrees/**", "eval/instances/**", "archives/**"],
  },
});
