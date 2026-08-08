/**
 * The set of Activity Log kinds `src/` actually emits, DERIVED from the source
 * rather than restated by hand.
 *
 * A hand-kept list is what ticket 063 exists to delete. `tests/log-format.test.ts`
 * called its list "every kind the codebase actually emits" and four kinds had
 * drifted past it, each reaching the reader as two context-free words on the
 * surface Q-23 makes the reason background autonomy is trustworthy at all.
 *
 * ## How a kind is found
 *
 * The sweep looks for the EVENT, not for the sink it is handed to, so it does
 * not care whether the event reaches `appendEvent` directly, through the
 * Docket's `log` dependency, through the wiki's `LogFn`, or through a private
 * wrapper. `ActivityEvent` requires `detail`, so every event written as an
 * object literal spells `kind` and `detail` together, and that pair is the
 * discriminator: a `kind` field with no `detail` beside it is a domain field —
 * a Provenance, a Referent, a memory tile — and never reaches the feed.
 *
 * One other shape in the tree carries both: `LintFinding` (`src/wiki/lint.ts`),
 * which also carries `subject`. An activity event never does, so `subject`
 * excludes it. Lint findings render as notes on a wiki page, not as feed lines.
 *
 * A `kind` that is not written at the sink is followed ONE hop. `serverEmit`
 * and the randomizer's `log` both take the kind as a parameter and hand it to
 * `appendEvent`; the sweep reads the parameter's position out of the function
 * head and then reads the literal out of every call. Neither wrapper is named
 * here — a third one is found the same way.
 *
 * ## Why this file blanks the source before reading it
 *
 * An earlier version tracked quotes without skipping comments, so it read
 * `src/server.ts` by apostrophe parity. A comment holding an odd apostrophe —
 * `the docket's log` — put the scanner inside a string for the rest of the
 * file, and every kind emitted from `server.ts` left the sweep silently. That
 * is this ticket's own failure in a new costume: a list that stopped being
 * complete while still claiming to be, and MORE trusted for looking derived.
 *
 * So `blank()` runs first, replacing the contents of every comment, string,
 * template literal and regular expression with spaces before anything is
 * matched. Offsets survive, so spans are computed on the blanked text and
 * values are read from the original.
 *
 * Two self-checks stand behind it, because a scanner that can see nothing and
 * call it clean is worth less than the comment it replaced:
 *
 * - `broken` reports any file whose blanked text is not bracket-balanced. A
 *   mis-parse almost always shows up as unmatched brackets, and this catches
 *   the class rather than the instance.
 * - `tests/log-format.test.ts` asserts a floor per emitting file. A file that
 *   drops to zero kinds is a red test, not a shorter list.
 *
 * ## What it still cannot see
 *
 * - A kind assembled at runtime — `kind: KINDS[i]`, or built by concatenation.
 *   These are REPORTED in `unreadable`, not skipped, and fail a test.
 * - A regular expression `blank()` mistakes for division, or the reverse. It
 *   decides from the preceding token, which is what the grammar itself uses,
 *   but the rule is a heuristic and `broken` is what catches it going wrong.
 * - Anything outside `src/`. An emitter added under `web/` or `scripts/` is
 *   invisible here.
 *
 * The stronger option — an exported `EventKind` union that every emitter must
 * import, so an unknown kind fails to COMPILE — is not available from here. It
 * requires editing every emitter, which lives in `src/clerk/`, `src/queue/`,
 * `src/wiki/`, `src/randomizer/` and `src/server.ts`. This sweep is what can be
 * built from the render layer alone.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One emitted kind, and the line that emits it. */
export type EmittedKind = { kind: string; file: string; line: number };

/** A sink whose kind cannot be read statically. Every one of these is a hole. */
export type UnreadableKind = { expr: string; file: string; line: number; why: string };

const SRC = join(import.meta.dirname, '..', 'src');

/** How far from a `kind` property the rest of its object literal may be. */
const WINDOW = 6;

/** A `kind` property: `kind: 'queue-rung',` or the shorthand `kind,`. */
const KIND_PROP = /(?<![.\w$])kind\s*(:|,|\}|\r?\n)/g;

/** A file-local `const NAME = 'value'`, so `kind: STATUS_CHANGED` still resolves. */
const STRING_CONST = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g;

/** A function head: `name(params) {`, `name(params): T {`, `function name(params) {`. */
const HEAD = /(?<![.\w$])(?:function\s+)?(#?[A-Za-z_$][\w$]*)\s*\(/g;

/** An arrow-function head: `const name = (params) => {`, `const name = async (params): T => {`. */
const ARROW_HEAD = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;

/** A span of the source, as `[start, end)`. */
type Span = [number, number];

/** A wrapper that takes its kind as a parameter: `serverEmit(root, actor, kind, …)`. */
type Wrapper = { name: string; index: number };

type Loaded = { file: string; text: string; code: string; consts: Map<string, string> };

/** Keywords a regular expression may follow. After anything else, `/` divides. */
const BEFORE_REGEX = new Set([
 'return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void',
 'yield', 'await', 'do', 'else', 'throw',
]);

/**
 * Whether the `/` at `i` opens a regular expression rather than dividing.
 * Decided by the token before it, which is the only thing that tells the two
 * apart. `.replace(/…/)` follows a bracket; `mins / 60` follows a value.
 */
function opensRegex(text: string, i: number): boolean {
 let j = i - 1;
 while (j >= 0 && /\s/.test(text[j]!)) j--;
 if (j < 0) return true;
 const prev = text[j]!;
 if (/[)\]]/.test(prev)) return false;
 if (!/[\w$]/.test(prev)) return true;
 let k = j;
 while (k >= 0 && /[\w$]/.test(text[k]!)) k--;
 return BEFORE_REGEX.has(text.slice(k + 1, j + 1));
}

/**
 * The source with the CONTENTS of every comment, string, template literal and
 * regular expression replaced by spaces. Length and line breaks survive, so an
 * offset in the result is the same offset in the original.
 *
 * This is what makes bracket matching mean anything. An apostrophe in a comment
 * is a quote to a naive scanner and nothing at all to a reader, and the
 * difference used to be a whole file leaving the sweep without a word.
 */
export function blank(text: string): string {
 const out = [...text];
 const n = text.length;
 const erase = (i: number): void => { if (text[i] !== '\n') out[i] = ' '; };
 let i = 0;

 while (i < n) {
  const c = text[i]!;
  const next = text[i + 1];

  if (c === '/' && next === '/') {
   while (i < n && text[i] !== '\n') { erase(i); i++; }
   continue;
  }

  if (c === '/' && next === '*') {
   erase(i); erase(i + 1); i += 2;
   while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { erase(i); i++; }
   if (i < n) { erase(i); erase(i + 1); i += 2; }
   continue;
  }

  if (c === "'" || c === '"' || c === '`') {
   i++;
   while (i < n) {
    const d = text[i]!;
    if (d === '\\') { erase(i); erase(i + 1); i += 2; continue; }
    if (d === c) break;
    erase(i);
    i++;
   }
   i++;
   continue;
  }

  // A regular expression body holds brackets and apostrophes that are neither
  // — `/[\s([]/u` and `/[’']/u` both broke this scanner before it read them.
  if (c === '/' && opensRegex(text, i)) {
   i++;
   let inClass = false;
   while (i < n && text[i] !== '\n') {
    const d = text[i]!;
    if (d === '\\') { erase(i); erase(i + 1); i += 2; continue; }
    if (d === '[') inClass = true;
    else if (d === ']') inClass = false;
    else if (d === '/' && !inClass) break;
    erase(i);
    i++;
   }
   i++;
   continue;
  }

  i++;
 }

 return out.join('');
}

/** Whether every bracket in blanked source closes. A mis-parse shows up here. */
function isBalanced(code: string): boolean {
 const open: string[] = [];
 const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
 for (const c of code) {
  if (c === '(' || c === '[' || c === '{') open.push(c);
  else if (c in pairs) {
   if (open.pop() !== pairs[c]) return false;
  }
 }
 return open.length === 0;
}

/** Every `.ts` file under `src/`, sorted so the sweep is stable. */
function sourceFiles(dir: string): string[] {
 const out: string[] = [];
 for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) out.push(...sourceFiles(path));
  else if (entry.name.endsWith('.ts')) out.push(path);
 }
 return out;
}

/**
 * Split a bracketed list at its top level, from the opening bracket to its
 * match, as spans. Runs on blanked source, so a comma inside a string or a
 * comment is not a separator. Returns undefined when the brackets do not close.
 */
function splitList(code: string, open: number): { items: Span[]; close: number } | undefined {
 const items: Span[] = [];
 let depth = 0;
 let start = open + 1;
 for (let i = open; i < code.length; i++) {
  const c = code[i]!;
  if (c === '(' || c === '[' || c === '{') { depth++; continue; }
  if (c === ')' || c === ']' || c === '}') {
   depth--;
   if (depth === 0) {
    if (i > start || items.length > 0) items.push([start, i]);
    return { items, close: i };
   }
   continue;
  }
  if (c === ',' && depth === 1) { items.push([start, i]); start = i + 1; }
 }
 return undefined;
}

/** The declared name of one parameter: `refs?: string[]` is `refs`. */
function paramName(param: string): string {
 return /^([A-Za-z_$][\w$]*)/.exec(param.trim())?.[1] ?? '';
}

type Head = { name: string; open: number; close: number; params: string[] };

/**
 * Every function head in a file — `name(params) {`, `name(params): T {`,
 * `const name = (params) => {`, `const name = async (params): T => {` — with
 * the span of its parameter list. A call expression has no body after its
 * bracket, which is what separates the two. `async` and the control-flow
 * keywords (`if`, `for`, `catch`, …) are not function names; `async` is
 * skipped so an arrow's real name wins, and the others are left alone — a
 * stray `catch (e)` that happens to consume a site is the scanner's
 * long-standing tolerance, not a resolution to rely on.
 */
function heads(code: string): Head[] {
 const out: Head[] = [];
 const scans: [string, string][] = [['HEAD', HEAD.source], ['ARROW_HEAD', ARROW_HEAD.source]];
 for (const [, source] of scans) {
  const re = new RegExp(source, 'g');
  for (const m of code.matchAll(re)) {
   const name = m[1]!;
   if (name === 'async') continue;
   const open = m.index + m[0].length - 1;
   const list = splitList(code, open);
   if (!list) continue;
   if (!/^\)\s*(?::[^{;=]*)?\s*(?:=>\s*)?\{/.test(code.slice(list.close))) continue;
   out.push({
    name,
    open,
    close: list.close,
    params: list.items.map(([a, b]) => code.slice(a, b)),
   });
  }
 }
 return out;
}

/**
 * Where `name` sits in the parameter list of the nearest enclosing function.
 * This is how a wrapper is recognised without being named: the sink writes
 * `kind`, and `kind` turns out to be the caller's third argument.
 */
function paramPosition(all: Head[], offset: number, name: string): Wrapper | undefined {
 for (let i = all.length - 1; i >= 0; i--) {
  const head = all[i]!;
  if (head.open > offset) continue;
  const index = head.params.findIndex((p) => paramName(p) === name);
  if (index !== -1) return { name: head.name, index };
 }
 return undefined;
}

/** Whether an offset falls inside a function's parameter list — a declaration, not a value. */
function isDeclaration(all: Head[], offset: number): boolean {
 return all.some((h) => h.open < offset && offset < h.close);
}

/**
 * Every string a `kind` value can evaluate to. Covers the three written forms:
 * a literal, a conditional with a literal on each arm
 * (`live ? 'facet-balance-applied' : 'facet-balance-shadow'`), and a file
 * constant. A value with no literal in it yields nothing.
 */
function literalsOf(value: string, consts: Map<string, string>): string[] {
 const quoted = [...value.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
 if (quoted.length > 0) return quoted;
 const name = /^([A-Za-z_$][\w$]*)\s*[,}]?\s*$/.exec(value.trim())?.[1];
 const resolved = name === undefined ? undefined : consts.get(name);
 return resolved === undefined ? [] : [resolved];
}

/**
 * The span of a `kind` value: everything after the colon up to the end of the
 * property. Measured on blanked source, so a comma inside a string does not end
 * it. A shorthand `kind,` has no value span and reports its own name.
 */
function kindSpan(code: string, punct: string | undefined, from: number): Span | undefined {
 if (punct !== ':') return undefined;
 const nl = code.indexOf('\n', from);
 const end = nl === -1 ? code.length : nl;
 const comma = code.slice(from, end).indexOf(',');
 return [from, comma === -1 ? end : from + comma];
}

/** Sweep `src/` for every Activity Log kind it emits, and for every hole. */
export function sweepEmitters(): {
 kinds: EmittedKind[];
 unreadable: UnreadableKind[];
 broken: string[];
} {
 const loaded: Loaded[] = sourceFiles(SRC).map((path) => {
  const text = readFileSync(path, 'utf-8');
  return {
   file: path.slice(path.indexOf('src/')),
   text,
   code: blank(text),
   consts: new Map([...text.matchAll(STRING_CONST)].map((m) => [m[1]!, m[2]!] as const)),
  };
 });

 const kinds: EmittedKind[] = [];
 const unreadable: UnreadableKind[] = [];
 const broken = loaded.filter((l) => !isBalanced(l.code)).map((l) => l.file);
 const wrappers: Wrapper[] = [];

 for (const { file, text, code, consts } of loaded) {
  const lines = code.split('\n');
  const all = heads(code);
  const lineOf = (offset: number): number => code.slice(0, offset).split('\n').length;

  for (const m of code.matchAll(KIND_PROP)) {
   const line = lineOf(m.index);
   const around = lines.slice(Math.max(0, line - 1 - WINDOW), line + WINDOW).join('\n');
   // No `detail` beside it: a domain field, not an event.
   if (!/(?<![.\w$])detail\s*[:,\n]/.test(around)) continue;
   // `subject` beside it: a LintFinding, which renders on a wiki page. The
   // shorthand form (`subject,`) counts, same as `detail` above.
   if (/(?<![.\w$])subject\s*[:,\n]/.test(around)) continue;
   // A parameter, not a property: `function serverEmit(…, kind: string, …)`
   // declares where a kind arrives and emits none itself.
   if (isDeclaration(all, m.index)) continue;

   const span = kindSpan(code, m[1], m.index + m[0].length);
   // The value is read from the ORIGINAL: the blanked copy exists to measure
   // spans, and every string it could report has had its contents removed.
   const expr = span === undefined ? 'kind' : text.slice(span[0], span[1]).trim();
   // A type member, not a value: `kind: string;` declares the shape an emitter
   // must fill, and fills nothing itself.
   if (expr === '' || expr.includes(';')) continue;

   const literals = literalsOf(expr, consts);
   if (literals.length > 0) {
    for (const kind of literals) kinds.push({ kind, file, line });
    continue;
   }

   // `kind` handed to this sink as a parameter: follow it to the callers.
   const bare = /^([A-Za-z_$][\w$]*)$/.exec(expr)?.[1];
   const wrapper = bare === undefined ? undefined : paramPosition(all, m.index, bare);
   if (wrapper) { wrappers.push(wrapper); continue; }

   // `e.kind`, where `e` is the event this sink was handed whole. Its callers
   // write the object literal, which this same sweep reads.
   const owner = /^([A-Za-z_$][\w$]*)\.kind$/.exec(expr)?.[1];
   if (owner !== undefined && paramPosition(all, m.index, owner)) continue;

   unreadable.push({
    expr,
    file,
    line,
    why: 'not a literal, a file constant, or a parameter this sweep can follow',
   });
  }
 }

 // One hop: every call of every wrapper, in every file, contributes the
 // literal at the wrapper's own parameter position.
 for (const wrapper of wrappers) {
  const call = new RegExp(`(?<![.\\w$])${wrapper.name.replace('$', '\\$')}\\s*\\(`, 'g');
  for (const { file, text, code } of loaded) {
   const lineOf = (offset: number): number => code.slice(0, offset).split('\n').length;
   for (const m of code.matchAll(call)) {
    const open = m.index + m[0].length - 1;
    const span = splitList(code, open)?.items[wrapper.index];
    if (span === undefined) continue;
    const arg = text.slice(span[0], span[1]).trim();
    // Not this wrapper: the declaration itself, whose parameter is a type.
    if (arg === '' || /^[A-Za-z_$][\w$]*\s*\??\s*:/.test(arg)) continue;
    // A wrapper's kinds are literals at the call site by construction; the
    // consts map belongs to the DECLARING file, so it is not consulted here.
    for (const kind of [...arg.matchAll(/'([^']*)'/g)].map((q) => q[1]!)) {
     kinds.push({ kind, file, line: lineOf(m.index) });
    }
   }
  }
 }

 return { kinds, unreadable, broken };
}
