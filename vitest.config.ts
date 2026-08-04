import { defineConfig, defaultExclude } from "vitest/config";
export default defineConfig({
  test: {
    // Worktrees under .claude/worktrees/ are parallel checkouts of this same
    // repo; without this exclude their entire test suites run again inside
    // ours (observed 2026-08-02: 180 files reported for a 94-file tests/).
    // Same for the improvement loop's variant worktrees and archived trials
    // (observed 2026-08-04: three copies of the real-boot test racing one
    // port, two losers asserting against the winner's server).
    exclude: [...defaultExclude, ".claude/worktrees/**", "eval/instances/**", "archives/**"],
  },
});
