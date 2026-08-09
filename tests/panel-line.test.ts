import { describe, it, expect } from 'vitest';

import { panelLine } from '../web/panel-line.js';

/**
 * The one-line waiting panels' three states (ticket 154), tested at the pure
 * seam. This repo has no DOM test environment, so the decision — offer vs
 * nothing vs error — is carried by `panelLine` in web/panel-line.ts, and the
 * element work in main.ts's renderWaiting is a thin wrapper over it.
 */

describe('the waiting panels\' three-state line (ticket 154)', () => {
  it('offers the line text when a panel has something to offer', () => {
    expect(panelLine('offer', 'the backlog', 'the page about you is 3 readings behind')).toEqual({
      kind: 'offer',
      text: 'the page about you is 3 readings behind',
    });
  });

  it('stays empty when there is genuinely nothing to offer', () => {
    expect(panelLine('none', 'the coach')).toBeNull();
  });

  it('renders one muted line naming the panel when the read fails', () => {
    expect(panelLine('error', 'the coach')).toEqual({
      kind: 'error',
      text: "couldn't check the coach just now",
    });
  });

  it('never puts the error line in the offer class', () => {
    expect(panelLine('error', 'the backlog')!.kind).toBe('error');
  });

  it('names each panel in its own error line', () => {
    for (const label of ['the reach', 'the backlog', 'the coach', 'the cadence', 'the anniversary']) {
      const line = panelLine('error', label)!;
      expect(line.kind).toBe('error');
      expect(line.text).toContain(label);
    }
  });
});
