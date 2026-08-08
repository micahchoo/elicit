import { describe, it, expect } from 'vitest';

import { chokedFolder } from '../web/import-entry.js';

/**
 * The import scan error names the folder it choked on (ticket 154), tested
 * at the pure seam: `chokedFolder` extracts the folder the server named, so
 * the entry surface's error state says *which* folder — never the generic
 * "that did not go through".
 */

describe('the import scan error names the folder (ticket 154)', () => {
  it('names the folder the server could not read', () => {
    const cause = new Error(
      '400 Bad Request: {"error":"Error: cannot read folder /tmp/vault/notes: EACCES: permission denied, scandir \'/tmp/vault/notes\'"}',
    );
    expect(chokedFolder(cause, '/requested')).toBe('/tmp/vault/notes');
  });

  it('falls back to the folder the person asked for when the error names none', () => {
    expect(chokedFolder(new Error('400 Bad Request: {"error":"no folder"}'), '/requested')).toBe(
      '/requested',
    );
    expect(chokedFolder('not an Error at all', '/requested')).toBe('/requested');
  });
});
