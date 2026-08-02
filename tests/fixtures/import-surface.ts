/**
 * A minimal DOM shim + surface-building helpers for the review surfaces of
 * the bulk-ingest pipeline. No browser, no jsdom — the plan says the DOM is
 * built by the same helpers, so the shim mirrors exactly the handful of DOM
 * APIs `web/import-review.ts` (and later `web/*.ts` surfaces) exercise, and
 * the helpers build the surface through the same injected `el`/`api` seam the
 * browser uses.
 *
 * T12 (and any later surface task) SHOULD reuse this file instead of growing
 * a second shim: `ShimElement` + `createElement` are generic (see the
 * selector support list), and `buildReviewSurface` is the only
 * import-review-specific piece.
 *
 * ## What the shim supports
 *
 * `ShimElement` (tag name, attributes, className, children, style, value,
 * disabled) implements the DOM surface the real surfaces rely on:
 * - `setAttribute` / `getAttribute`
 * - `classList.add / remove / contains` (backed by the className string)
 * - `append(...kids)` — strings become text nodes; an element already in the
 *   tree is detached from its old parent first (like the real DOM), which is
 *   how the single verb cluster is moved between paragraphs
 * - `replaceChildren`, `insertBefore`, `removeChild`, `remove`, `replaceWith`
 * - `textContent` getter (concatenation of every descendant text node) and
 *   setter (replaces all children with one text node)
 * - `addEventListener` (handlers stored per type) with `focus()` and
 *   `click()` dispatching the stored handlers synchronously
 * - `querySelector` / `querySelectorAll` over descendants, supporting:
 *   `.class`, `tag`, `tag.class`, `.a .b` descendant chains, and
 *   `[name=x]` / `[type=x]` attribute selectors, comma-separated groups
 *   (e.g. `[name=target], .target-control`) — enough for every selector the
 *   review surfaces use.
 *
 * ## Helpers
 *
 * - `createElement(tag, attrs?, ...kids)` — mirrors `web/main.ts`'s `el()`.
 * - `buildReviewSurface(item)` — renders the review surface for `item` (or
 *   the waiting state for `null`) through `renderImportReview`, returning
 *   `{ surface, sent, deps, nav }`. `sent` records every POST body (the
 *   initial GET is not recorded — the plan's exclusion test asserts `sent`
 *   starts empty); `nav` records every `navTo` screen.
 * - `verbLabels(surface)` — text of all `.import-verb` buttons (all three,
 *   hidden or not).
 * - `visibleVerbs(surface)` — text of the verbs inside an active cluster.
 * - `clickVerb(surface, label)` — clicks the verb button with that label.
 * - `focusCut(surface, i)` — focuses the first marked span of cut `i`.
 * - `paragraphsOf(el)` — textContent of every `.import-para` (the verbatim
 *   source paragraphs, in order).
 * - `clickExclude(surface)` / `confirmExclude(surface, reason)` — open the
 *   piece-level refusal and submit a reason.
 */

import { renderImportReview, type ImportReviewDeps, type ImportReviewItem } from '../../web/import-review.js';

/* ─── the element shim ─── */

export interface ShimEvent {
  type: string;
  target: ShimElement;
}

type Listener = (ev: ShimEvent) => void;

export class ShimText {
  parent: ShimElement | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
  get textContent(): string {
    return this.text;
  }
}

export class ShimElement {
  tagName: string;
  className = '';
  style: Record<string, string> = {};
  value = '';
  disabled = false;
  parent: ShimElement | ShimText | null = null;
  children: (ShimElement | ShimText)[] = [];
  private attrs = new Map<string, string>();
  private handlers = new Map<string, Listener[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(k: string, v: string): void {
    // In the DOM the class attribute and className are one thing.
    if (k === 'class') {
      this.className = v;
      return;
    }
    this.attrs.set(k, v);
  }

  getAttribute(k: string): string | null {
    if (k === 'class') return this.className.length > 0 ? this.className : null;
    return this.attrs.get(k) ?? null;
  }

  get classList(): {
    add(...c: string[]): void;
    remove(...c: string[]): void;
    contains(c: string): boolean;
  } {
    const el = this;
    return {
      add(...c: string[]) {
        const cur = el.className.split(/\s+/).filter(Boolean);
        for (const cl of c) if (!cur.includes(cl)) cur.push(cl);
        el.className = cur.join(' ');
      },
      remove(...c: string[]) {
        el.className = el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' ');
      },
      contains(c: string) {
        return el.className.split(/\s+/).includes(c);
      },
    };
  }

  get textContent(): string {
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    const t = new ShimText(v);
    t.parent = this;
    this.children = [t];
  }

  get parentElement(): ShimElement | null {
    return this.parent instanceof ShimElement ? this.parent : null;
  }

  append(...kids: (string | ShimElement | ShimText)[]): void {
    for (const k of kids) {
      const node = typeof k === 'string' ? new ShimText(k) : k;
      if (node instanceof ShimElement && node.parent instanceof ShimElement) {
        node.parent.removeChild(node);
      }
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...kids: (string | ShimElement | ShimText)[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...kids);
  }

  insertBefore(node: ShimElement, ref: ShimElement): void {
    if (node.parent instanceof ShimElement) node.parent.removeChild(node);
    const i = this.children.indexOf(ref);
    if (i === -1) this.children.push(node);
    else this.children.splice(i, 0, node);
    node.parent = this;
  }

  removeChild(child: ShimElement | ShimText): void {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parent = null;
    }
  }

  remove(): void {
    if (this.parent instanceof ShimElement) this.parent.removeChild(this);
  }

  replaceWith(...nodes: ShimElement[]): void {
    if (!(this.parent instanceof ShimElement)) return;
    const parent = this.parent;
    for (const n of nodes) parent.insertBefore(n, this);
    parent.removeChild(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  dispatch(type: string): void {
    const ev: ShimEvent = { type, target: this };
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }

  /** No-op that dispatches the stored 'focus' handlers (browser focus does). */
  focus(): void {
    this.dispatch('focus');
  }

  click(): void {
    this.dispatch('click');
  }

  querySelectorAll(sel: string): ShimElement[] {
    const chains = parseSelector(sel);
    const out: ShimElement[] = [];
    const seen = new Set<ShimElement>();
    const walk = (node: ShimElement): void => {
      for (const child of node.children) {
        if (!(child instanceof ShimElement)) continue;
        for (const chain of chains) {
          if (matchesChain(child, chain)) {
            if (!seen.has(child)) {
              seen.add(child);
              out.push(child);
            }
          }
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel: string): ShimElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

/* ─── the tiny selector engine ─── */

interface Compound {
  tag?: string;
  classes: string[];
  attrs: [string, string][];
}

function parseCompound(token: string): Compound {
  const comp: Compound = { classes: [], attrs: [] };
  let i = 0;
  if (/^[a-zA-Z]/.test(token)) {
    const m = /^[a-zA-Z][\w-]*/.exec(token)!;
    comp.tag = m[0];
    i = m[0].length;
  }
  while (i < token.length) {
    const ch = token[i];
    if (ch === '.') {
      const m = /^\.([\w-]+)/.exec(token.slice(i))!;
      comp.classes.push(m[1]!);
      i += m[0].length;
    } else if (ch === '[') {
      const m = /^\[([\w-]+)(?:=([^\]]*))?\]/.exec(token.slice(i))!;
      let value = m[2] ?? '';
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
        value = value.slice(1, -1);
      }
      comp.attrs.push([m[1]!, value]);
      i += m[0].length;
    } else {
      throw new Error(`unsupported selector token: ${token}`);
    }
  }
  return comp;
}

function parseSelector(sel: string): Compound[][] {
  return sel
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/).map(parseCompound));
}

function matchesCompound(el: ShimElement, comp: Compound): boolean {
  if (comp.tag && el.tagName.toLowerCase() !== comp.tag) return false;
  for (const c of comp.classes) if (!el.classList.contains(c)) return false;
  for (const [k, v] of comp.attrs) if (el.getAttribute(k) !== v) return false;
  return true;
}

/** `el` matches the last compound and has an ancestor chain for the rest. */
function matchesChain(el: ShimElement, chain: Compound[]): boolean {
  if (!matchesCompound(el, chain[chain.length - 1]!)) return false;
  let node = el.parent instanceof ShimElement ? el.parent : null;
  for (let i = chain.length - 2; i >= 0; i--) {
    while (node && !matchesCompound(node, chain[i]!)) node = node.parentElement;
    if (!node) return false;
    node = node.parentElement;
  }
  return true;
}

/* ─── el(), mirroring web/main.ts ─── */

export function createElement(
  tag: string,
  attrs?: Record<string, string>,
  ...kids: (string | ShimElement | ShimText)[]
): ShimElement {
  const e = new ShimElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
}

/* ─── the surface builder and its helpers ─── */

export interface ApiCall {
  path: string;
  body: unknown;
}

export interface ReviewSurface {
  /** The `main` element the surface was rendered into. */
  surface: ShimElement;
  /** Every POST the surface made, in order. The initial GET is not recorded. */
  sent: ApiCall[];
  deps: ImportReviewDeps;
  /** Every screen passed to `navTo`, in order. */
  nav: string[];
}

/** Flush the microtask queue so async work (renders, POST chains) lands. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Render the review surface for `item` (or the waiting state for `null`)
 * through the same injected seam the browser uses, and return the built DOM
 * plus capture arrays. `sent` records only calls WITH a body — the plan's
 * exclusion test asserts `sent` starts empty after a refused reason.
 */
export async function buildReviewSurface(item: ImportReviewItem | null): Promise<ReviewSurface> {
  const main = new ShimElement('div');
  const sent: ApiCall[] = [];
  const nav: string[] = [];
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    if (body !== undefined) sent.push({ path, body });
    if (path === '/api/import/next') {
      return (item === null
        ? { item: null, waiting: 'the docket has not run — no piece is ready to review' }
        : { item, remaining: 2 }) as T;
    }
    return {} as T;
  };
  const deps: ImportReviewDeps = {
    main: main as unknown as HTMLElement,
    el: createElement as unknown as ImportReviewDeps['el'],
    api,
    beginWait: () => ({ done() {}, failed() {} }),
    navTo: (screen: string) => {
      nav.push(screen);
    },
  };
  renderImportReview(deps);
  await flush();
  return { surface: main, sent, deps, nav };
}

/** Text of every `.import-verb` button — all three, hidden or not. */
export function verbLabels(surface: ShimElement): string[] {
  return surface.querySelectorAll('.import-verb').map((b) => b.textContent);
}

/** Text of the verbs inside the one active (revealed) cluster. */
export function visibleVerbs(surface: ShimElement): string[] {
  return surface.querySelectorAll('.import-verbs.active .import-verb').map((b) => b.textContent);
}

/** Click the `.import-verb` button carrying `label`. */
export function clickVerb(surface: ShimElement, label: string): void {
  const b = surface.querySelectorAll('.import-verb').find((v) => v.textContent === label);
  if (b) b.click();
}

/** Focus the first marked span of cut `i` (as a browser focus would). */
export function focusCut(surface: ShimElement, i: number): void {
  const spans = surface.querySelectorAll(`.import-cut[data-cut="${i}"]`);
  const first = spans[0];
  if (first) first.focus();
}

/** The verbatim source paragraphs, in order. */
export function paragraphsOf(el: ShimElement): string[] {
  return el.querySelectorAll('.import-para').map((p) => p.textContent);
}

/** Reveal the piece-level refusal control. */
export function clickExclude(surface: ShimElement): void {
  surface.querySelector('.import-exclude-toggle')?.click();
}

/** Fill the reason field and press confirm; resolves after the POST lands. */
export async function confirmExclude(surface: ShimElement, reason: string): Promise<void> {
  const input = surface.querySelector('.import-exclude-reason');
  if (input) input.value = reason;
  surface.querySelector('.import-exclude-confirm')?.click();
  await flush();
}
