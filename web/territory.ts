/**
 * The territory surface renderer — ticket 152, prototype.
 *
 * Draws the GET /api/territory response as a survey-map-style indented
 * outline — the grammar the import surface already taught: one line per
 * node, two spaces per depth, each carrying its state word and cite
 * count. A prototype for the person to react to, not the final design:
 * the outline is the whole surface, nothing modal.
 *
 * Q-79 binds every word: coverage is a fact about the ARCHIVE, never a
 * judgement about the person. The state words below say what the archive
 * carries; an instrument the archive has never touched gets a quiet
 * invitation to sit (154's convention — empty state and error state are
 * distinct), never a silence and never a "you".
 */

import type { TerritoryNode, TerritoryResponse } from '../src/territory.js';
import type { NodeCoverageStatus } from '../src/ktg/coverage.js';

/** The state word for a coverage status — archive facts only (Q-79). */
export function stateWord(state: NodeCoverageStatus): string {
  switch (state) {
    case 'evidenced':
      return 'the archive carries two or more sittings of this';
    case 'touched':
      return 'one sitting in the archive touches this';
    case 'unprobed':
      return 'nothing in the archive touches this yet';
  }
}

/** One outline line: indented name, state word, cite count. */
export function nodeLine(node: TerritoryNode): string {
  const name = `${'  '.repeat(node.depth - 1)}${node.name}`.padEnd(28);
  const cites = node.citeCount === 1 ? '1 cite' : `${node.citeCount} cites`;
  return `${name}${stateWord(node.state)} · ${cites}`;
}

function el(tag: string, className: string | null, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== null) node.className = className;
  node.textContent = text;
  return node;
}

/**
 * Renders the territory response into `container`, replacing its previous
 * contents. An instrument the archive has never touched shows one quiet
 * invitation line; a vault with no instruments shows the same at the top.
 */
export function renderTerritory(container: HTMLElement, data: TerritoryResponse): void {
  container.replaceChildren();
  if (data.instruments.length === 0) {
    container.append(
      el(
        'p',
        'territory-hint',
        'nothing in the archive touches any mapped territory yet — a sitting would start to.',
      ),
    );
    return;
  }
  for (const instrument of data.instruments) {
    container.append(el('h3', 'territory-instrument', instrument.name));
    const totalCites = instrument.nodes.reduce((n, node) => n + node.citeCount, 0);
    if (totalCites === 0) {
      container.append(
        el(
          'p',
          'territory-hint',
          `nothing in the archive touches ${instrument.name} yet — a sitting would start to.`,
        ),
      );
      continue;
    }
    for (const node of instrument.nodes) {
      const className = node.role === 'cluster' ? 'territory-cluster' : 'territory-node';
      container.append(el('div', className, nodeLine(node)));
    }
  }
}
