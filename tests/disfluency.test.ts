/**
 * QR-5 — mechanical disfluency elision for quotes INTO questions.
 *
 * STT disfluencies ("uh", "um", false starts) are quoted verbatim into
 * question text as the `quotedFragment`. A quotation INTO a question may
 * elide them by a mechanical, marked rule (ellipsis), never by paraphrase;
 * the kept Snippet stays verbatim (Q-12).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elideDisfluencies } from '../src/language/disfluency.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { QueueDraft } from '../src/types.js';

describe('elideDisfluencies', () => {
 it('replaces a standalone filled pause with an ellipsis marker', () => {
  expect(elideDisfluencies('Co designing and co writing, uh metaphors')).toBe(
   'Co designing and co writing, … metaphors',
  );
 });

 it('elides several filled pauses in one fragment', () => {
  expect(elideDisfluencies('I was, um, thinking about, uh, the project')).toBe(
   'I was, … thinking about, … the project',
  );
 });

 it('keeps a disfluency-shaped string inside a word untouched', () => {
  expect(elideDisfluencies('The human condition')).toBe('The human condition');
 });

 it('replaces a leading "I mean, " false start', () => {
  expect(elideDisfluencies('I mean, it\'s about trust')).toBe('… it\'s about trust');
 });

 it('replaces a leading "you know, " false start', () => {
  expect(elideDisfluencies('you know, the thing is')).toBe('… the thing is');
 });

 it('keeps an empty string empty', () => {
  expect(elideDisfluencies('')).toBe('');
 });

 it('keeps text with no disfluencies unchanged', () => {
  expect(elideDisfluencies('What changed your mind about the plan?')).toBe(
   'What changed your mind about the plan?',
  );
 });

 it('collapses adjacent filled pauses into one marker', () => {
  expect(elideDisfluencies('uh um er')).toBe('…');
 });

 it('elides a trailing filled pause', () => {
  expect(elideDisfluencies('the end um')).toBe('the end …');
 });

 it('keeps already clean text unchanged', () => {
  expect(elideDisfluencies('The project is on track.')).toBe('The project is on track.');
 });

 // The rule is mechanical, not semantic: the comma is what marks the
 // discourse marker as a particle rather than a real verb phrase.
 it('keeps verb phrases that only look like false starts', () => {
  expect(elideDisfluencies('you know the answer')).toBe('you know the answer');
  expect(elideDisfluencies('I mean the blue one')).toBe('I mean the blue one');
 });
});

describe('queue store elision (QR-5 gate)', () => {
 let root: string;

 beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-disfluency-'));
 });

 afterEach(() => {
  rmSync(root, { recursive: true, force: true });
 });

 it('elides disfluencies from quotedFragment on add', () => {
  const queue = createQueueStore(root);
  const draft: QueueDraft = {
   source: 'composed',
   license: 'user',
   question: 'Co designing and co writing, uh metaphors — what did that feel like?',
   questionForm: 'deliberative',
   horizon: 'now',
   quotedFragment: 'Co designing and co writing, uh metaphors',
   snippet: 'Co designing and co writing, uh metaphors',
  };
  const entry = queue.add(draft);
  expect(entry.quotedFragment).toBe('Co designing and co writing, … metaphors');
  // The kept Snippet stays verbatim (Q-12).
  expect(entry.snippet).toBe('Co designing and co writing, uh metaphors');
  // The elided form survives a read-back through the store.
  const readBack = queue.list().find((e) => e.id === entry.id);
  expect(readBack?.quotedFragment).toBe('Co designing and co writing, … metaphors');
 });

 it('leaves a clean quotedFragment untouched', () => {
  const queue = createQueueStore(root);
  const draft: QueueDraft = {
   source: 'still-true',
   license: 'user',
   question: 'Is the human condition still the human condition?',
   questionForm: 'theoretical',
   horizon: 'session',
   quotedFragment: 'The human condition',
  };
  const entry = queue.add(draft);
  expect(entry.quotedFragment).toBe('The human condition');
 });

 it('keeps an absent quotedFragment absent', () => {
  const queue = createQueueStore(root);
  const draft: QueueDraft = {
   source: 'user-declared',
   license: 'user',
   question: 'What do I want to work on next?',
   questionForm: 'deliberative',
   horizon: 'session',
  };
  const entry = queue.add(draft);
  expect(entry.quotedFragment).toBeUndefined();
 });
});
