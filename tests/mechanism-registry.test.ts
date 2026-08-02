/**
 * The mechanism exposure registry, enforced — ticket 077, generalizing
 * the emitted-kinds sweep (063) from event kinds to exported mechanisms.
 *
 * `src/registry.ts` declares live | shadow | unwired per exported
 * mechanism. This file DERIVES the mechanism set from the source the same
 * way `tests/emitted-kinds.ts` derives the event-kind set, then
 * cross-checks the declaration against actual call sites:
 *
 * - every exported mechanism the sweep can enumerate MUST be declared
 *   (a new mechanism with no declaration is the drift case 063 deleted);
 * - `live`   with no caller outside its own tests FAILS;
 * - `unwired` with a caller FAILS — the declaration is stale;
 * - `shadow` must be reached AND write its named Q-35 shadow record, so
 *   a shadow mechanism that records nothing is indistinguishable from
 *   inert.
 *
 * ## What counts as a caller
 *
 * Production callers are identifier uses in `src/` (other modules, or
 * inside the declaring module past the declaration itself) and in `web/`
 * — the client imports `formatEvent`/`relativeTime` and renders the
 * surface the person meets. Tests and `scripts/` measurement tools do
 * not count: `scripts/eval-053-semantic-resonance.ts` calls the semantic
 * channel, and ticket 068 still owns the honest "unwired" declaration.
 * Import statements are wiring, not use, and are skipped; an alias
 * (`recomputeStatus as opsRecomputeStatus`) is followed; `${…}` template
 * interpolations are followed too, because `blank()` erases them wholesale.
 *
 * ## The blind-spot guards from 063, carried over
 *
 * `blank()` erases comments, strings, templates and regex bodies before
 * anything is matched, so the apostrophe-class failure cannot silently
 * empty a file. Two guards stand behind it, as in 063: every src file's
 * blanked code must be bracket-balanced (a mis-parse shows up as
 * unbalanced brackets), and a file whose raw text declares mechanisms
 * but whose blanked text declares none FAILS loudly.
 *
 * ## Known limits (see the registry docstring)
 *
 * - Exported primitives, arrays and prompt strings are data, not
 *   mechanisms, and are not enumerated (`starterBank`, `FACETS`,
 *   `SYSTEM_PROMPT`, ...). A mechanism hiding in an array export would
 *   be invisible here.
 * - A typed const whose annotation contains `=>` (`export const f: (x) =>
 *   y = ...`) is not enumerated. None exists today.
 * - Same-named private symbols in other modules read as callers
 *   (`userTurn`, `nameSimilarity`, `quotedSpans`). Harmless while the
 *   real status is live.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { blank, sweepEmitters, type EmittedKind } from './emitted-kinds.js';
import { MECHANISM_REGISTRY, type MechanismEntry } from '../src/registry.js';

const ROOT = join(import.meta.dirname, '..');
const SWEEP_DIRS = ['src', 'web'];

type LoadedFile = { file: string; text: string; code: string };
type Mechanism = { module: string; name: string; line: number };
type Span = [number, number];

/** Every `.ts` file under the swept dirs, repo-relative, sorted. */
function sweptFiles(): LoadedFile[] {
 const out: LoadedFile[] = [];
 for (const dir of SWEEP_DIRS) {
  const abs = join(ROOT, dir);
  const walk = (d: string): void => {
   for (const entry of readdirSync(d).sort()) {
    const full = join(d, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (entry.endsWith('.ts')) {
     const text = readFileSync(full, 'utf-8');
     out.push({ file: full.slice(ROOT.length + 1), text, code: blank(text) });
    }
   }
  };
  walk(abs);
 }
 return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** A named function export: `export function name(` / `export async function name(`. */
const FN_RE = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
/**
 * An object- or function-valued const export: `export const name = {` /
 * `export const name = (` — the shapes a capability can hide in
 * (`lexicalChannel` is an object, not a factory). Arrays and primitives
 * are data and are not enumerated.
 */
const CONST_RE = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(\{|\()/g;

function lineOf(code: string, offset: number): number {
 return code.slice(0, offset).split('\n').length;
}

/** Every mechanism the swept src/ actually exports, with its declaration line. */
function enumerateMechanisms(files: LoadedFile[]): Mechanism[] {
 const out: Mechanism[] = [];
 for (const f of files) {
  if (!f.file.startsWith('src/')) continue;
  for (const m of f.code.matchAll(FN_RE)) {
   out.push({ module: f.file.replace(/\.ts$/, ''), name: m[1]!, line: lineOf(f.code, m.index) });
  }
  for (const m of f.code.matchAll(CONST_RE)) {
   out.push({ module: f.file.replace(/\.ts$/, ''), name: m[1]!, line: lineOf(f.code, m.index) });
  }
 }
 return out;
}

/** Semicolon-terminated import statements, as spans of the ORIGINAL text. */
function importSpansOf(text: string): Span[] {
 const spans: Span[] = [];
 const re = /import\s+(?:type\s+)?[\s\S]*?;/g;
 for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
 return spans;
}

/** `import { x as y }` pairs across a file's import statements. */
function aliasesOf(text: string, spans: Span[]): Map<string, string> {
 const out = new Map<string, string>();
 for (const [s, e] of spans) {
  for (const m of text.slice(s, e).matchAll(/([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
   out.set(m[2]!, m[1]!);
  }
 }
 return out;
}

/**
 * `${…}` expression bodies inside template literals, as spans of the
 * ORIGINAL text. `blank()` erases template contents wholesale, so a
 * mechanism called only inside an interpolation — `formatDistribution` in
 * the draw's shadow record, `sourceLabel` on the web surface — would
 * otherwise read as caller-less. Comments, strings and nested templates
 * inside the expression are skipped, so a `}` inside one cannot close the
 * expression early.
 */
function templateExprSpans(text: string): Span[] {
 const spans: Span[] = [];
 const n = text.length;
 let i = 0;
 while (i < n) {
  const c = text[i]!;
  const next = text[i + 1];
  if (c === '/' && next === '/') {
   while (i < n && text[i] !== '\n') i++;
   continue;
  }
  if (c === '/' && next === '*') {
   i += 2;
   while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
   i += 2;
   continue;
  }
  if (c === "'" || c === '"') {
   i++;
   while (i < n && text[i] !== '\\' && text[i] !== c) i++;
   i++;
   continue;
  }
  if (c !== '`') {
   i++;
   continue;
  }
  // A template literal: skip to its close, collecting ${ … } bodies.
  i++;
  while (i < n) {
   const d = text[i]!;
   if (d === '\\') {
    i += 2;
    continue;
   }
   if (d === '`') {
    i++;
    break;
   }
   if (d === '$' && text[i + 1] === '{') {
    const open = i + 2;
    let depth = 1;
    let j = open;
    while (j < n && depth > 0) {
     const e = text[j]!;
     if (e === '\\') {
      j += 2;
      continue;
     }
     if (e === "'" || e === '"') {
      j++;
      while (j < n && text[j] !== '\\' && text[j] !== e) j++;
      j++;
      continue;
     }
     if (e === '`') {
      // A nested template inside the expression: skip to its close.
      j++;
      while (j < n && text[j] !== '\\' && text[j] !== '`') j++;
      j++;
      continue;
     }
     if (e === '{') depth++;
     else if (e === '}') {
      depth--;
      if (depth === 0) break;
     }
     j++;
    }
    spans.push([open, j]);
    i = j + 1;
    continue;
   }
   i++;
  }
 }
 return spans;
}

/**
 * Production call sites of one mechanism: identifier uses in src/ or web/
 * outside import statements, plus uses of any local alias bound to it,
 * plus uses inside `${…}` template interpolations (which `blank()` hides).
 * Uses inside the declaring module count only past the declaration line.
 */
function callerEvidence(module: string, name: string, files: LoadedFile[], declarations: Map<string, number>): { file: string; line: number }[] {
 const evidence: { file: string; line: number }[] = [];
 const declLine = declarations.get(`${module}:${name}`);
 for (const f of files) {
  const spans = importSpansOf(f.text);
  const aliases = aliasesOf(f.text, spans);
  const inSpan = (off: number): boolean => spans.some(([s, e]) => s <= off && off < e);
  const targets = [name];
  for (const [local, imported] of aliases) {
   if (imported === name) targets.push(local);
  }
  const scan = (re: RegExp, source: string, offsetBase: number): void => {
   for (const m of source.matchAll(re)) {
    const off = offsetBase + m.index!;
    if (inSpan(off)) continue;
    const line = lineOf(f.code, off);
    if (f.file === `${module}.ts` && line === declLine) continue;
    evidence.push({ file: f.file, line });
   }
  };
  for (const t of targets) scan(new RegExp(`\\b${t}\\b`, 'g'), f.code, 0);
  // Template interpolation is code, but `blank()` erases it wholesale.
  for (const [s, e] of templateExprSpans(f.text)) {
   const expr = blank(f.text.slice(s, e));
   for (const t of targets) scan(new RegExp(`\\b${t}\\b`, 'g'), expr, s);
  }
 }
 return evidence;
}

/** Whether `fromFile` imports `targetModule` (relative specifiers resolved). */
function fileImports(fromFile: string, targetModule: string, files: LoadedFile[]): boolean {
 const f = files.find((x) => x.file === fromFile);
 if (!f) return false;
 const target = targetModule.replace(/\.(js|ts)$/, '');
 for (const [s, e] of importSpansOf(f.text)) {
  const m = /from\s+'([^']+)'/.exec(f.text.slice(s, e));
  if (!m) continue;
  const spec = m[1]!;
  if (!spec.startsWith('.')) continue;
  const resolved = join(dirname(fromFile), spec).replace(/\.(js|ts)$/, '');
  if (resolved === target) return true;
 }
 return false;
}

/**
 * The cross-check itself. Parameterised so the acceptance fixtures can
 * forge entries and prove each rule fires.
 */
export function checkExposures(entries: MechanismEntry[], files: LoadedFile[], emittedKinds: EmittedKind[]): string[] {
 const violations: string[] = [];
 const enumerated = enumerateMechanisms(files);
 const actual = new Set(enumerated.map((m) => `${m.module}:${m.name}`));
 const declLine = new Map(enumerated.map((m) => [`${m.module}:${m.name}`, m.line]));

 for (const e of entries) {
  if (!actual.has(`${e.module}:${e.name}`)) {
   violations.push(`declared symbol is not an exported mechanism: ${e.module}:${e.name}`);
   continue;
  }
  const callers = callerEvidence(e.module, e.name, files, declLine);
  if (e.status === 'live') {
   if (callers.length === 0) violations.push(`live with no caller: ${e.module}:${e.name}`);
  } else if (e.status === 'unwired') {
   if (callers.length > 0) {
    const at = callers.slice(0, 3).map((c) => `${c.file}:${c.line}`).join(', ');
    violations.push(`declared unwired but called: ${e.module}:${e.name} (${at})`);
   }
  } else if (e.status === 'shadow') {
   if (!e.shadowKind) {
    violations.push(`shadow without a record kind: ${e.module}:${e.name} (shadowKind is required)`);
   } else {
    const emitted = emittedKinds.filter((k) => k.kind === e.shadowKind);
    if (emitted.length === 0) {
     violations.push(`shadow without a record: ${e.module}:${e.name} ('${e.shadowKind}' is not emitted anywhere in src/)`);
    } else if (!emitted.some((k) => k.file === `${e.module}.ts` || fileImports(k.file, e.module, files) || fileImports(`${e.module}.ts`, k.file, files))) {
     violations.push(`shadow record disconnected: ${e.module}:${e.name} ('${e.shadowKind}' is emitted only by files with no import link to ${e.module})`);
    }
   }
   if (callers.length === 0) violations.push(`shadow with no caller: ${e.module}:${e.name} (a shadow mechanism must be reached to record)`);
  }
 }

 const declared = new Set(entries.map((e) => `${e.module}:${e.name}`));
 for (const m of enumerated) {
  if (!declared.has(`${m.module}:${m.name}`)) {
   violations.push(`not declared: ${m.module}:${m.name}`);
  }
 }
 return violations;
}

/** 063 guard 1: a file whose blanking collapsed cannot silently report zero. */
function collapsedFiles(files: LoadedFile[]): string[] {
 const out: string[] = [];
 for (const f of files) {
  if (!f.file.startsWith('src/')) continue;
  const raw = [...f.text.matchAll(FN_RE)].length + [...f.text.matchAll(CONST_RE)].length;
  if (raw === 0) continue;
  const blanked = [...f.code.matchAll(FN_RE)].length + [...f.code.matchAll(CONST_RE)].length;
  if (blanked === 0) out.push(f.file);
 }
 return out;
}

/** 063 guard 2: a mis-parse almost always shows up as unbalanced brackets. */
function isBalanced(code: string): boolean {
 const stack: string[] = [];
 const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
 for (const ch of code) {
  if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
  else if (ch === ')' || ch === ']' || ch === '}') {
   if (stack.pop() !== pairs[ch]) return false;
  }
 }
 return stack.length === 0;
}

const FILES = sweptFiles();
const EMITTED = sweepEmitters();
const ENUMERATED = enumerateMechanisms(FILES);

describe('mechanism exposure registry (ticket 077)', () => {
 it('declares every exported mechanism the sweep can enumerate', () => {
  const declared = new Set(MECHANISM_REGISTRY.map((e) => `${e.module}:${e.name}`));
  const missing = ENUMERATED.filter((m) => !declared.has(`${m.module}:${m.name}`));
  expect(missing.map((m) => `${m.module}:${m.name}`)).toEqual([]);
 });

 it('declares no symbol that is not an exported mechanism', () => {
  const actual = new Set(ENUMERATED.map((m) => `${m.module}:${m.name}`));
  const ghosts = MECHANISM_REGISTRY.filter((e) => !actual.has(`${e.module}:${e.name}`));
  expect(ghosts.map((e) => `${e.module}:${e.name}`)).toEqual([]);
 });

 it('matches actual call sites: live, unwired and shadow all hold', () => {
  const violations = checkExposures(MECHANISM_REGISTRY, FILES, EMITTED.kinds);
  expect(violations).toEqual([]);
 });

 it('carries 063\u2019s blind-spot guards: nothing collapsed, nothing mis-parsed', () => {
  expect(EMITTED.broken).toEqual([]); // the emitted-kinds sweep's own bracket guard
  expect(collapsedFiles(FILES)).toEqual([]);
  const unbalanced = FILES.filter((f) => f.file.startsWith('src/') && !isBalanced(f.code)).map((f) => f.file);
  expect(unbalanced).toEqual([]);
 });

 // ── The acceptance fixtures: each rule fires on a forged entry ──

 it('fails on a synthetic live mechanism with no caller', () => {
  // `resonateHybrid` used to be the example; 068 wired it, so it now HAS
  // callers and the forged entry would pass. PROTOCOLS has none — the
  // file-based registry replaced it — so the rule still fires on it.
  const forged: MechanismEntry[] = [
   { module: 'src/elicitor/protocol', name: 'PROTOCOLS', status: 'live' },
  ];
  const violations = checkExposures(forged, FILES, EMITTED.kinds);
  expect(violations.join('\n')).toContain('live with no caller');
 });

 it('fails on a synthetic unwired mechanism with a caller (stale declaration)', () => {
  const forged: MechanismEntry[] = [
   { module: 'src/queue/bank-filter', name: 'isWeakForm', status: 'unwired' },
  ];
  const violations = checkExposures(forged, FILES, EMITTED.kinds);
  expect(violations.join('\n')).toContain('declared unwired but called');
 });

 it('fails on a synthetic shadow mechanism without its record kind', () => {
  const noKind: MechanismEntry[] = [
   { module: 'src/queue/facet-balance', name: 'applyFacetBalance', status: 'shadow' },
  ];
  expect(checkExposures(noKind, FILES, EMITTED.kinds).join('\n')).toContain('shadow without a record kind');

  const bogusKind: MechanismEntry[] = [
   { module: 'src/queue/facet-balance', name: 'applyFacetBalance', status: 'shadow', shadowKind: 'no-such-kind' },
  ];
  expect(checkExposures(bogusKind, FILES, EMITTED.kinds).join('\n')).toContain("'no-such-kind' is not emitted");
 });

 it('fails on a synthetic undeclared mechanism', () => {
  const violations = checkExposures([], FILES, EMITTED.kinds);
  expect(violations).toContain('not declared: src/server:createApp');
 });
});
