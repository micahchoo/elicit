/**
 * Curate the Randomizer decks from the curated question bank, WITH facet intent.
 *
 * Usage:
 *   tsx scripts/curate-deck.ts [--in <bank.jsonl>] [--out-dir <dir>] [--dry-run]
 *                              [--cap <n>] [--samples]
 *
 * Emits two decks:
 *   episodes.jsonl        — every question that asks for a dateable scene.
 *   transformative.jsonl  — the reflective remainder, ROUND-ROBIN across its
 *                           intents so no single facet can dominate the deck.
 *
 * Why this script exists (ticket 042): the previous curation required the
 * literal word "you" in every question. That is a second-person-grammar
 * filter, not a quality filter — it kept 250 self-reflection prompts and
 * produced a vault of 25 constructs to 0 episodes. Selection here is by what
 * a question ELICITS (src/elicitor/facet-intent.ts), and the deck balance is
 * enforced at curation time, not hoped for at draw time.
 *
 * Quality gates are unchanged from the previous curation: one question per
 * entry, no yes/no auxiliary opener, no leading junk, 5-28 words, one entry
 * per are.na blockId.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { classifyFacetIntent } from "../src/elicitor/facet-intent.js";
import { isWeakForm } from "../src/language/weak-form.js";
import type { DeckEntry, Facet } from "../src/types.js";

// ── quality gates ──────────────────────────────────────────────────────────

const MIN_WORDS = 5;
const MAX_WORDS = 28;

/** Why an entry was rejected, or `null` when it passes. */
export function deckQualityFailure(question: string): string | null {
	const text = question.trim();
	if (!text.endsWith("?")) return "not a question";
	if ((text.match(/\?/g) ?? []).length !== 1) return "multiple questions";
	if (isWeakForm(text)) return "weak form (yes/no opener or leading junk)";
	const words = text.split(/\s+/).filter(Boolean).length;
	if (words < MIN_WORDS) return "too short";
	if (words > MAX_WORDS) return "too long";
	return null;
}

/** Case- and punctuation-insensitive key for duplicate detection. */
function normalize(question: string): string {
	return question.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// ── input ──────────────────────────────────────────────────────────────────

interface BankEntry {
	question: string;
	channel: string;
	channelTitle?: string;
	blockId: number;
}

function readBank(filepath: string): BankEntry[] {
	const content = fs.readFileSync(filepath, "utf-8");
	const entries: BankEntry[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]!.trim();
		if (!trimmed) continue;
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(trimmed);
		} catch (e) {
			console.error(`Parse error at ${filepath}:${i + 1}:`, String(e));
			process.exit(1);
		}
		const question = typeof raw.question === "string" ? raw.question : "";
		if (!question.trim()) continue;
		entries.push({
			question,
			channel: typeof raw.channel === "string" ? raw.channel : "",
			...(typeof raw.channelTitle === "string" ? { channelTitle: raw.channelTitle } : {}),
			blockId: typeof raw.blockId === "number" ? raw.blockId : 0,
		});
	}
	return entries;
}

// ── selection ──────────────────────────────────────────────────────────────

/**
 * Take up to `cap` entries, cycling through the intents in turn. The deck's
 * facet shape is therefore flat until an intent runs dry, and the largest
 * intent can only dominate what the smaller ones leave behind.
 */
export function roundRobinByFacet(
	entries: { targetFacet: Facet }[],
	cap: number,
): number[] {
	const byFacet = new Map<Facet, number[]>();
	for (let i = 0; i < entries.length; i++) {
		const f = entries[i]!.targetFacet;
		const bucket = byFacet.get(f);
		if (bucket) bucket.push(i);
		else byFacet.set(f, [i]);
	}
	// Smallest bucket first, so scarce intents are never crowded out.
	const buckets = [...byFacet.values()].sort((a, b) => a.length - b.length);
	const picked: number[] = [];
	let cursor = 0;
	while (picked.length < cap) {
		let took = false;
		for (const bucket of buckets) {
			const idx = bucket[cursor];
			if (idx === undefined) continue;
			picked.push(idx);
			took = true;
			if (picked.length >= cap) break;
		}
		if (!took) break;
		cursor++;
	}
	return picked.sort((a, b) => a - b);
}

// ── main ───────────────────────────────────────────────────────────────────

interface Options {
	input: string;
	outDir: string;
	dryRun: boolean;
	cap: number;
	samples: boolean;
}

function parseArgs(argv: string[]): Options {
	const opts: Options = {
		input: "data/question-bank.curated.jsonl",
		outDir: "data/decks",
		dryRun: false,
		cap: 250,
		samples: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--in") opts.input = argv[++i] ?? opts.input;
		else if (arg === "--out-dir") opts.outDir = argv[++i] ?? opts.outDir;
		else if (arg === "--dry-run") opts.dryRun = true;
		else if (arg === "--samples") opts.samples = true;
		else if (arg === "--cap") opts.cap = Number(argv[++i] ?? opts.cap);
		else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(1);
		}
	}
	return opts;
}

function histogram(label: string, counts: Map<string, number>, total: number): void {
	console.log(`\n=== ${label} ===`);
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	for (const [key, count] of sorted) {
		const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
		console.log(`  ${key.padEnd(22)} ${String(count).padStart(5)} (${pct}%)`);
	}
}

function main(): void {
	const opts = parseArgs(process.argv.slice(2));
	const curatedBy = `curate-deck.ts facet-intent (${new Date().toISOString().slice(0, 10)})`;

	const bank = readBank(opts.input);

	// ── quality gate ──
	const rejects = new Map<string, number>();
	const seenBlocks = new Set<number>();
	const seenText = new Set<string>();
	const passed: BankEntry[] = [];

	for (const entry of bank) {
		const failure = deckQualityFailure(entry.question);
		if (failure) {
			rejects.set(failure, (rejects.get(failure) ?? 0) + 1);
			continue;
		}
		if (seenBlocks.has(entry.blockId)) {
			rejects.set("duplicate blockId", (rejects.get("duplicate blockId") ?? 0) + 1);
			continue;
		}
		const key = normalize(entry.question);
		if (seenText.has(key)) {
			rejects.set("duplicate text", (rejects.get("duplicate text") ?? 0) + 1);
			continue;
		}
		seenBlocks.add(entry.blockId);
		seenText.add(key);
		passed.push(entry);
	}

	// ── classify by intent ──
	const classified: (BankEntry & { targetFacet: Facet })[] = [];
	const intents = new Map<string, number>();
	let unclassified = 0;
	const samples = new Map<Facet, string[]>();

	for (const entry of passed) {
		const targetFacet = classifyFacetIntent(entry.question);
		if (!targetFacet) {
			unclassified++;
			continue;
		}
		intents.set(targetFacet, (intents.get(targetFacet) ?? 0) + 1);
		const bucket = samples.get(targetFacet) ?? [];
		if (bucket.length < 5) bucket.push(entry.question);
		samples.set(targetFacet, bucket);
		classified.push({ ...entry, targetFacet });
	}

	// ── decks ──
	const episodeSource = classified.filter((e) => e.targetFacet === "episode");
	const reflectiveSource = classified.filter((e) => e.targetFacet !== "episode");
	const reflective = roundRobinByFacet(reflectiveSource, opts.cap).map(
		(i) => reflectiveSource[i]!,
	);

	const toDeckEntry = (
		e: BankEntry & { targetFacet: Facet },
		deck: string,
	): DeckEntry => ({
		question: e.question,
		channel: e.channel,
		...(e.channelTitle ? { channelTitle: e.channelTitle } : {}),
		blockId: e.blockId,
		deck,
		targetFacet: e.targetFacet,
		curatedBy,
	});

	const decks: { name: string; entries: DeckEntry[] }[] = [
		{ name: "episodes", entries: episodeSource.map((e) => toDeckEntry(e, "episodes")) },
		{
			name: "transformative",
			entries: reflective.map((e) => toDeckEntry(e, "transformative")),
		},
	];

	// ── report ──
	console.log(`Input:            ${bank.length}`);
	console.log(`Passed quality:   ${passed.length}`);
	console.log(`Classified:       ${classified.length}`);
	console.log(`Unclassified:     ${unclassified}  (dropped — no facet claim)`);
	histogram("Rejected by gate", rejects, bank.length);
	histogram("Facet intent (classified pool)", intents, classified.length);

	for (const deck of decks) {
		const counts = new Map<string, number>();
		for (const e of deck.entries) {
			// `DeckEntry.targetFacet` is optional since ticket 026 (a hand-written
			// vault deck may carry no facet claim). This script only ever emits
			// classified entries, so the skip is unreachable here by construction.
			if (!e.targetFacet) continue;
			counts.set(e.targetFacet, (counts.get(e.targetFacet) ?? 0) + 1);
		}
		histogram(`Deck: ${deck.name} (${deck.entries.length})`, counts, deck.entries.length);
	}

	if (opts.samples) {
		console.log("\n=== Samples per intent ===");
		for (const [facet, texts] of samples) {
			console.log(`\n  ${facet}:`);
			for (const t of texts) console.log(`    - ${t}`);
		}
	}

	if (opts.dryRun) {
		console.log("\n--dry-run: no files written.");
		return;
	}

	fs.mkdirSync(opts.outDir, { recursive: true });
	for (const deck of decks) {
		const file = path.join(opts.outDir, `${deck.name}.jsonl`);
		const body = deck.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
		fs.writeFileSync(file, body, "utf-8");
		console.log(`\nWrote ${deck.entries.length} entries → ${file}`);
	}
}

// Import-safe: the pure helpers above are unit-tested, so only a direct
// invocation runs the curation.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
	main();
}
