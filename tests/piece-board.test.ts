/**
 * The board's three bug fixes (redesign-2026-08-09 §12), asserted where
 * they live — the surface and its stylesheet. These are DOM-less checks:
 * the tabs' [hidden] behavior is visual, so the suite pins the rule that
 * makes it true; the take-out wiring is a caller that must exist; the
 * set-down rendering is a field the board's wire must carry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const css = readFileSync(join(ROOT, 'web', 'style.css'), 'utf-8');
const pieceSurface = readFileSync(join(ROOT, 'web', 'piece.ts'), 'utf-8');

describe('the piece board bug fixes (§12)', () => {
  it('the stylesheet carries the [hidden] rule — the tabs actually hide (bug 12.1)', () => {
    // .material-pieces (style.css) and .library-directions both set
    // display:flex, and an author rule beats the UA [hidden] rule regardless
    // of specificity — without `!important` the tabs hide nothing.
    expect(css).toContain('[hidden] {');
    expect(css).toContain('display: none !important;');
  });

  it('take out is wired: the piece page calls the remove route (bug 12.2)', () => {
    // POST /api/piece/:id/remove existed with no caller — the take-out verb
    // must reach it from the surface. The route is called with the entry to
    // remove, never with an arrangement (the ordering subsystem is gone).
    expect(pieceSurface).toMatch(/\/api\/piece\/\$\{encodeURIComponent\(pieceId\)\}\/remove/);
    expect(pieceSurface).toMatch(/\{ entry: \w+\.id \}/);
    expect(pieceSurface).not.toMatch(/\/remove[^)]*arrangement/);
  });

  it('set down is visible: the board wire carries setDownAt and renders it (bug 12.3)', () => {
    // PieceLite must not drop the field the server sends (routes.ts:191) —
    // and the pieces tab must render a set-down piece distinctly.
    expect(pieceSurface).toMatch(/export interface PieceLite \{/);
    expect(pieceSurface).toMatch(/setDownAt: string \| null;/);
    expect(pieceSurface).toContain('set-down');
    expect(pieceSurface).toContain('material-set-down');
  });
});
