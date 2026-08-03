import { defineConfig, defaultExclude } from "vitest/config";
export default defineConfig({
  test: {
    // Worktrees under .claude/worktrees/ are parallel checkouts of this same
    // repo; without this exclude their entire test suites run again inside
    // ours (observed 2026-08-02: 180 files reported for a 94-file tests/).
    exclude: [...defaultExclude, ".claude/worktrees/**"],
  },
});
