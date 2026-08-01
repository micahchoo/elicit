import { readFileSync } from 'node:fs';
import type { QuestionForm, QuestionSource } from '../types.js';
import { starterBank, type StarterQuestion } from './protocol.js';

interface RawEntry {
 question?: unknown;
 channel?: unknown;
 channelTitle?: unknown;
 blockId?: unknown;
}

/** Deterministic classification: regex on question text, never model-classified. */
function classify(text: string): QuestionForm {
 if (/^why\b/i.test(text)) return 'why';
 return 'deliberative';
}

/**
 * Load the curated question bank from a JSONL file.
 *
 * Each line: {question, channel, channelTitle, blockId}.
 * Malformed lines are skipped. Duplicates (by lowercased trimmed text) are
 * dropped — first occurrence wins.
 *
 * Returns the hardcoded `starterBank` fallback if the file is missing or empty.
 */
export function loadQuestionBank(
 path = 'data/question-bank.jsonl',
): StarterQuestion[] {
 let raw: string;
 try {
  raw = readFileSync(path, 'utf-8');
 } catch {
  return starterBank;
 }

 if (!raw.trim()) return starterBank;

 const seen = new Set<string>();
 const questions: StarterQuestion[] = [];

 for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  let entry: RawEntry;
  try {
   entry = JSON.parse(trimmed);
  } catch {
   // Skip malformed lines
   continue;
  }

  const question = typeof entry.question === 'string' ? entry.question.trim() : '';
  if (!question) continue;

  const key = question.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);

  const channel = typeof entry.channel === 'string' ? entry.channel : '';
  const channelTitle =
   typeof entry.channelTitle === 'string' ? entry.channelTitle : undefined;
  const blockId =
   typeof entry.blockId === 'number' ? entry.blockId : 0;

  const source: QuestionSource = { channel, blockId };
  if (channelTitle) source.channelTitle = channelTitle;

  questions.push({
   text: question,
   questionForm: classify(question),
   source,
  });
 }

 return questions.length > 0 ? questions : starterBank;
}
