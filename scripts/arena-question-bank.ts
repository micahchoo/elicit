// Build a question bank from Are.na channels whose text blocks are questions.
// Usage: npx tsx scripts/arena-question-bank.ts "query1,query2" [maxChannelsPerQuery]
// Merges into data/question-bank.jsonl (one question per line, with provenance).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const queries = (process.argv[2] ?? 'questions').split(',').map((q) => q.trim());
const maxChannels = Number(process.argv[3] ?? 25);
const outPath = 'data/question-bank.jsonl';
const API = 'https://api.are.na/v2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'elicit-question-bank' } }).catch(() => null);
    if (res?.ok) return res.json();
    const status = res ? res.status : 'network';
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt > 6) throw new Error(`${status} ${url}`);
    const wait = Number(res?.headers.get('retry-after')) * 1000 || attempt * 15_000;
    console.log(`  ${status}, waiting ${wait / 1000}s`);
    await sleep(wait);
  }
}

type Entry = { question: string; channel: string; channelTitle: string; blockId: number };

// A candidate line counts as a question when, stripped of list markers and
// trailing quotes/parens, it ends in '?'. Blocks that are lists of questions
// yield one candidate per line.
const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ',
};
const decodeEntities = (s: string) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m]!);

function questionLines(content: string | null): string[] {
  if (!content) return [];
  const out: string[] = [];
  for (const raw of decodeEntities(content).split('\n')) {
    const line = raw
      .trim()
      .replace(/^(?:[-*•–—]|\d+[.)])\s+/, '')
      .replace(/["'”’)\]]+$/, '');
    if (line.length < 8 || line.length > 300) continue;
    if (!line.endsWith('?')) continue;
    out.push(line);
  }
  return out;
}

const normalize = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ');

const seen = new Set<string>();
const entries: Entry[] = [];
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e: Entry = JSON.parse(line);
    seen.add(normalize(e.question));
    entries.push(e);
  }
  console.log(`loaded ${entries.length} existing questions`);
}

const visitedChannels = new Set<string>();
for (const query of queries) {
  const search = await getJson(`${API}/search/channels?q=${encodeURIComponent(query)}&per=${maxChannels}`);
  const channels: any[] = (search.channels ?? []).filter(
    (c: any) => c.length > 0 && !visitedChannels.has(c.slug),
  );
  console.log(`query "${query}": ${channels.length} unvisited channels`);
  for (const ch of channels) {
    visitedChannels.add(ch.slug);
    let kept = 0;
    const pages = Math.min(Math.ceil(ch.length / 100), 10);
    try {
    for (let page = 1; page <= pages; page++) {
      const body = await getJson(`${API}/channels/${ch.slug}/contents?per=100&page=${page}`);
      for (const block of body.contents ?? []) {
        if (block.class !== 'Text') continue;
        for (const question of questionLines(block.content)) {
          const key = normalize(question);
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ question, channel: ch.slug, channelTitle: ch.title, blockId: block.id });
          kept++;
        }
      }
      await sleep(600);
    }
    } catch (err) {
      console.log(`  ${ch.slug}: SKIPPED after ${kept} new (${err instanceof Error ? err.message : err})`);
    }
    console.log(`  ${ch.slug}: ${kept} new / ${ch.length} blocks`);
    // Write after every channel so a crash or rate-limit kill loses nothing.
    mkdirSync('data', { recursive: true });
    writeFileSync(outPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

console.log(`${entries.length} unique questions -> ${outPath}`);
