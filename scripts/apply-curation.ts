/**
 * Applies curation decisions to question-bank.jsonl.
 *
 * Usage: tsx scripts/apply-curation.ts <input.jsonl> <decisions.jsonl> <curated-out.jsonl> <rejects-out.jsonl>
 *
 * Decision format (JSONL):
 *   {"line": N, "verdict": "keep", "register": "value"}
 *   {"line": N, "verdict": "drop", "reason": "quiz/trivia"}
 *   {"line": N, "verdict": "split", "register": "construct",
 *     "splits": ["exact substring 1", "exact substring 2"]}
 *
 * Line numbers are 1-indexed absolute positions in the input file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── types ──────────────────────────────────────────────────────────────────

interface InputLine {
 line: number;
 question: string;
 channel: string;
 channelTitle: string;
 blockId: number;
}

interface Decision {
 line: number;
 verdict: "keep" | "drop" | "split";
 register?: string;
 reason?: string;
 splits?: string[];
}

interface CuratedEntry {
 question: string;
 channel: string;
 channelTitle: string;
 blockId: number;
 register: string;
}

interface RejectedEntry {
 question: string;
 channel: string;
 channelTitle: string;
 blockId: number;
 reason: string;
}

// ── I/O ────────────────────────────────────────────────────────────────────

function readJsonl<T>(filepath: string, map: (raw: Record<string, unknown>, line: number) => T): T[] {
 const content = fs.readFileSync(filepath, "utf-8");
 const lines = content.split("\n");
 const results: T[] = [];
 for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i]!.trim();
  if (!trimmed) continue;
  try {
   results.push(map(JSON.parse(trimmed), i + 1));
  } catch (e) {
   console.error(`Parse error at ${filepath}:${i + 1}:`, String(e));
   process.exit(1);
  }
 }
 return results;
}

function appendJsonl(filepath: string, obj: Record<string, unknown>): void {
 fs.appendFileSync(filepath, JSON.stringify(obj) + "\n");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
 const args = process.argv.slice(2);
 if (args.length !== 4) {
  console.error("Usage: tsx scripts/apply-curation.ts <input.jsonl> <decisions.jsonl> <curated-out.jsonl> <rejects-out.jsonl>");
  process.exit(1);
 }

 const [inputPath, decisionsPath, curatedPath, rejectsPath] = args as [string, string, string, string];

 // Read input, indexed by line number
 const inputByLine = new Map<number, InputLine>();
 readJsonl<InputLine>(inputPath, (raw, line) => {
  const entry: InputLine = {
   line,
   question: String(raw.question ?? ""),
   channel: String(raw.channel ?? ""),
   channelTitle: String(raw.channelTitle ?? ""),
   blockId: Number(raw.blockId ?? 0),
  };
  inputByLine.set(line, entry);
  return entry;
 });

 // Read decisions
 const decisions = readJsonl<Decision>(decisionsPath, (raw, line) => {
  const verdict = raw.verdict as string;
  if (!["keep", "drop", "split"].includes(verdict)) {
   throw new Error(`Invalid verdict "${verdict}" at decisions line ${line}`);
  }
  return {
   line: Number(raw.line),
   verdict: verdict as Decision["verdict"],
   ...(raw.register !== undefined ? { register: raw.register as string } : {}),
   ...(raw.reason !== undefined ? { reason: raw.reason as string } : {}),
   ...(raw.splits !== undefined ? { splits: raw.splits as string[] } : {}),
  };
 });

 // Truncate/create output files
 fs.writeFileSync(curatedPath, "");
 fs.writeFileSync(rejectsPath, "");

 let kept = 0;
 let rejected = 0;
 let splitsPerformed = 0;

 for (const d of decisions) {
  const input = inputByLine.get(d.line);
  if (!input) {
   console.error(`Decision references unknown input line ${d.line}`);
   process.exit(1);
  }

  const provenance = {
   channel: input.channel,
   channelTitle: input.channelTitle,
   blockId: input.blockId,
  };

  if (d.verdict === "keep") {
   if (!d.register) {
    console.error(`Decision line ${d.line}: keep requires register`);
    process.exit(1);
   }
   const entry: CuratedEntry = {
    question: input.question,
    ...provenance,
    register: d.register,
   };
   appendJsonl(curatedPath, entry as unknown as Record<string, unknown>);
   kept++;
  } else if (d.verdict === "drop") {
   const entry: RejectedEntry = {
    question: input.question,
    ...provenance,
    reason: d.reason ?? "unspecified",
   };
   appendJsonl(rejectsPath, entry as unknown as Record<string, unknown>);
   rejected++;
  } else if (d.verdict === "split") {
   if (!d.register) {
    console.error(`Decision line ${d.line}: split requires register`);
    process.exit(1);
   }
   if (!d.splits || d.splits.length < 2) {
    console.error(`Decision line ${d.line}: split requires at least 2 split strings`);
    process.exit(1);
   }
   // Verify each split is an exact substring of the original
   for (const s of d.splits) {
    if (!input.question.includes(s)) {
     console.error(
      `Decision line ${d.line}: split "${s}" is not a substring of "${input.question}"`
     );
     process.exit(1);
    }
   }
   // Also verify splits cover the whole question (concatenated with some delimiter)
   // We don't enforce this strictly since separators vary, but warn
   const joined = d.splits.join("");
   if (joined.length < input.question.length * 0.7) {
    console.warn(
     `Decision line ${d.line}: splits join to ${joined.length} chars but question is ${input.question.length} — may miss content`
    );
   }

   for (const question of d.splits) {
    const entry: CuratedEntry = {
     question,
     ...provenance,
     register: d.register,
    };
    appendJsonl(curatedPath, entry as unknown as Record<string, unknown>);
    kept++;
   }
   splitsPerformed++;
  }
 }

 // Check for uncovered input lines
 const covered = new Set(decisions.map(d => d.line));
 let uncovered = 0;
 for (const line of inputByLine.keys()) {
  if (!covered.has(line)) {
   uncovered++;
  }
 }
 if (uncovered > 0) {
  console.warn(`WARNING: ${uncovered} input lines have no decision — they will be silently dropped`);
 }

 // ── Verification ──────────────────────────────────────────────────────

 console.log("\n=== Verification ===");

 // 1. Every output line is valid JSON with required fields
 const curatedLines = fs.readFileSync(curatedPath, "utf-8").split("\n").filter(l => l.trim());
 console.log(`Curated lines: ${curatedLines.length}`);

 for (const line of curatedLines) {
  let obj: Record<string, unknown>;
  try {
   obj = JSON.parse(line);
  } catch {
   console.error("VERIFICATION FAILED: invalid JSON in curated output");
   process.exit(1);
  }
  if (!("question" in obj) || !("channel" in obj) || !("channelTitle" in obj) ||
   !("blockId" in obj) || !("register" in obj)) {
   console.error("VERIFICATION FAILED: curated entry missing required field", obj);
   process.exit(1);
  }
 }

 const rejectLines = fs.readFileSync(rejectsPath, "utf-8").split("\n").filter(l => l.trim());
 console.log(`Rejected lines: ${rejectLines.length}`);

 for (const line of rejectLines) {
  let obj: Record<string, unknown>;
  try {
   obj = JSON.parse(line);
  } catch {
   console.error("VERIFICATION FAILED: invalid JSON in rejects output");
   process.exit(1);
  }
  if (!("question" in obj) || !("reason" in obj)) {
   console.error("VERIFICATION FAILED: reject entry missing required field", obj);
   process.exit(1);
  }
 }

 // 2. Every curated question is an exact substring of its source entry's question (byte-level)
 // We check this by looking up the source. Since splits inherit provenance,
 // we verify each curated question exists as substring in some input's question.
 // For non-split entries this is trivial (they ARE the input question).
 const inputQuestions = new Set<string>();
 for (const inp of inputByLine.values()) {
  inputQuestions.add(inp.question);
 }

 for (const line of curatedLines) {
  const obj = JSON.parse(line) as CuratedEntry;
  let found = false;
  for (const srcQ of inputQuestions) {
   if (srcQ.includes(obj.question)) {
    found = true;
    break;
   }
  }
  if (!found) {
   console.error(`VERIFICATION FAILED: curated question not a substring of any input: "${obj.question}"`);
   process.exit(1);
  }
 }

 // 3. Count check: kept + rejected >= input count (splits can exceed)
 const inputCount = inputByLine.size;
 console.log(`Input lines:  ${inputCount}`);
 console.log(`Kept:         ${kept}`);
 console.log(`Rejected:     ${rejected}`);
 console.log(`Splits:       ${splitsPerformed}`);

 if (kept + rejected < inputCount) {
  console.error(`VERIFICATION FAILED: kept(${kept}) + rejected(${rejected}) < input(${inputCount})`);
  process.exit(1);
 }

 // 4. No duplicate questions in curated (case/punctuation-insensitive)
 const normalize = (q: string): string =>
  q.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").trim();

 const seen = new Map<string, string>(); // normalized → original
 for (const line of curatedLines) {
  const obj = JSON.parse(line) as CuratedEntry;
  const norm = normalize(obj.question);
  if (seen.has(norm)) {
   const prev = seen.get(norm)!;
   console.error(`VERIFICATION FAILED: duplicate question (normalized):`);
   console.error(`  "${prev}"`);
   console.error(`  "${obj.question}"`);
   process.exit(1);
  }
  seen.set(norm, obj.question);
 }

 // 5. Register histogram
 const registerCounts = new Map<string, number>();
 for (const line of curatedLines) {
  const obj = JSON.parse(line) as CuratedEntry;
  registerCounts.set(obj.register, (registerCounts.get(obj.register) ?? 0) + 1);
 }

 console.log("\n=== Register histogram ===");
 const sorted = [...registerCounts.entries()].sort((a, b) => b[1] - a[1]);
 for (const [reg, count] of sorted) {
  const pct = ((count / kept) * 100).toFixed(1);
  console.log(`  ${reg.padEnd(20)} ${String(count).padStart(4)} (${pct}%)`);
 }

 console.log("\n=== Report ===");
 console.log(`Input:    ${inputCount}`);
 console.log(`Kept:     ${kept}`);
 console.log(`Rejected: ${rejected}`);
 console.log(`Splits:   ${splitsPerformed}`);
 console.log(`Uncovered: ${uncovered}`);
 console.log("\nAll verifications passed.");
}

main();
