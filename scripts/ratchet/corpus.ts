// Corpus loader for the protocol ratchet harness.
// Reads vault/transcripts/*.md (gray-matter frontmatter + `## agent`/`## user`
// body blocks), selects the 3 exchanges with the most user-turn characters,
// and snapshots them as parsed Turn[] to scripts/ratchet/corpus.json.
//
// Usage:
//   npx tsx scripts/ratchet/corpus.ts            # print stats for existing corpus.json
//   npx tsx scripts/ratchet/corpus.ts --refresh  # re-read vault/transcripts, overwrite corpus.json
//
// When vault/transcripts has no files, corpus.json is generated from the
// built-in synthetic fallback (SYNTHETIC_CORPUS) and a note is printed to stderr.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import type { Turn } from '../../src/types.js';

export type CorpusEntry = { session: string; turns: Turn[] };

export type ParsedTranscript = {
  session: string;
  started: string;
  turns: Turn[];
};

const CORPUS_SIZE = 3;
/** Synthetic per-turn timestamp offset when transcripts lack real timing (30s per turn). */
const TURN_MS = 30_000;

// ── Parsing ──

/**
 * Parse one transcript file: gray-matter frontmatter plus `## agent`/`## user`
 * body sections. `at` is derived from the frontmatter `started` timestamp plus
 * a fixed per-turn offset (transcripts do not record per-turn timestamps).
 * Returns null when the file has no session, no started time, or no turns.
 */
export function parseTranscript(raw: string, fallbackSession?: string): ParsedTranscript | null {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const session = typeof data.session === 'string' ? data.session : fallbackSession;
  const started = typeof data.started === 'string' ? data.started : '';
  if (!session || !started || !parsed.content.trim()) return null;

  const base = Number.isNaN(Date.parse(started)) ? 0 : Date.parse(started);
  // tokens = ["", "agent", "<text>", "user", "<text>", ...]
  const tokens = parsed.content.split(/^## (agent|user)\s*$/m);
  const turns: Turn[] = [];
  let index = 0;
  for (let i = 1; i + 1 < tokens.length; i += 2) {
    const role = tokens[i];
    const text = tokens[i + 1]?.trim();
    if ((role !== 'agent' && role !== 'user') || !text) continue;
    turns.push({ role, text, at: new Date(base + index * TURN_MS).toISOString() });
    index += 1;
  }
  if (turns.length === 0) return null;
  return { session, started, turns };
}

/** All transcript files under `transcriptsDir`, parsed; skips unparseable files. */
export function scanVaultTranscripts(transcriptsDir: string): ParsedTranscript[] {
  if (!existsSync(transcriptsDir)) return [];
  const out: ParsedTranscript[] = [];
  for (const f of readdirSync(transcriptsDir)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(join(transcriptsDir, f), 'utf-8');
    const parsed = parseTranscript(raw, f.replace(/\.md$/, ''));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function userChars(entry: { turns: Turn[] }): number {
  return entry.turns.reduce((sum, t) => sum + (t.role === 'user' ? t.text.length : 0), 0);
}

/** The `n` exchanges with the most user-turn characters, most first. */
export function selectTopByUserChars<T extends { session: string; turns: Turn[] }>(
  entries: T[],
  n: number,
): T[] {
  return [...entries].sort((a, b) => userChars(b) - userChars(a)).slice(0, n);
}

// ── Built-in synthetic fallback (used when vault/transcripts is empty) ──

export const SYNTHETIC_CORPUS: CorpusEntry[] = [
  {
    session: 'eval-001-language-learning',
    turns: [
      {
        role: 'agent',
        text: 'What draws you to learning new languages — is there a pattern to when you start one?',
        at: '2026-07-15T10:00:00.000Z',
        questionForm: 'deliberative',
        questionSource: { channel: 'transformative', blockId: 42 },
      },
      {
        role: 'user',
        text: "It's never a practical reason. Every language I've seriously studied — Japanese, Arabic, now Welsh — started with a single encounter. A song I couldn't get out of my head, a poem someone read aloud, a street sign in a place I happened to be. The sound of it gets under my skin before I know what any of the words mean. By the time I open a textbook I'm already committed, I'm just making it official.",
        at: '2026-07-15T10:00:45.000Z',
      },
      {
        role: 'agent',
        text: 'That moment when the sound gets under your skin before meaning — can you walk me through the most recent time that happened, step by step?',
        at: '2026-07-15T10:01:30.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "Welsh. February this year. I was driving through mid-Wales near Devil's Bridge, the radio was on Radio Cymru and I couldn't understand a single word. But there was this interview — two people laughing, and the cadence of it was completely unlike English. The rhythm lands differently. Vowels stretched, consonants softened in places English hardens them. I pulled over and just listened for maybe twenty minutes. Didn't understand anything. Didn't need to. Some part of my brain had already decided.",
        at: '2026-07-15T10:02:15.000Z',
      },
      {
        role: 'agent',
        text: "You said 'some part of my brain had already decided' — what is that part? What does deciding feel like before you can name it?",
        at: '2026-07-15T10:03:00.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "It feels like curiosity but heavier. Curiosity says 'I wonder what that is.' This says 'I'm going to find out, and it's not a question of whether, only when.' There's a weight to it — almost a physical sensation, like something slotting into place. I've learned to trust it because every time I've ignored it I've regretted it, and every time I've followed it the thing turned out to matter.",
        at: '2026-07-15T10:03:45.000Z',
      },
    ],
  },
  {
    session: 'eval-002-teaching-practice',
    turns: [
      {
        role: 'agent',
        text: "You teach programming. What's the moment in a course when you know whether it's working?",
        at: '2026-07-20T14:00:00.000Z',
        questionForm: 'deliberative',
        questionSource: { channel: 'transformative', blockId: 17 },
      },
      {
        role: 'user',
        text: "Week three. Always week three. Week one everyone's excited, week two they're frustrated because the syntax won't cooperate, and by week three they either break through or they don't. The ones who break through stop asking 'is this right' and start asking 'what happens if I try this.' It's a shift from permission-seeking to exploration, and once that switch flips, everything else follows. The ones who don't break through are still trying to memorize rules without building a mental model of what the machine actually does.",
        at: '2026-07-20T14:01:00.000Z',
      },
      {
        role: 'agent',
        text: "That shift from permission-seeking to exploration — what's happening inside the switch when it flips?",
        at: '2026-07-20T14:02:00.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "I think they stop seeing the computer as an authority and start seeing it as a tool. An authority you ask permission from — 'is this correct?' A tool you experiment with — 'what does this do?' The difference is who's in charge. When you see the computer as an authority, every error message is a judgment. When you see it as a tool, every error message is information. Same red text on the screen, completely different emotional experience.",
        at: '2026-07-20T14:02:45.000Z',
      },
      {
        role: 'agent',
        text: "You've drawn a sharp line between authority and tool. Is there a moment in your own learning where you were on the wrong side of that line?",
        at: '2026-07-20T14:03:30.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "For years with mathematics. I treated every problem set as a test I was failing in slow motion. The textbook was the authority, the answer key was the authority, and I was just trying to guess what the authority wanted. I got good at guessing — I could pattern-match problem types to solution templates — but I never understood what I was doing. Years later I had to re-teach myself linear algebra from scratch, and this time I approached it as exploration. Night and day. The math hadn't changed; my relationship to not-knowing had.",
        at: '2026-07-20T14:04:15.000Z',
      },
    ],
  },
  {
    session: 'eval-003-writing-habit',
    turns: [
      {
        role: 'agent',
        text: 'You write regularly. What does a good writing day actually feel like, versus a productive one?',
        at: '2026-07-25T08:00:00.000Z',
        questionForm: 'deliberative',
        questionSource: { channel: 'transformative', blockId: 55 },
      },
      {
        role: 'user',
        text: "They're almost never the same thing. A productive day is measurable — I shipped 800 words, I closed three open loops in a draft, I crossed things off a list. A good writing day is one where I surprised myself. Where I wrote something I didn't know I thought until I saw it on the page. Those days are rarely productive in the word-count sense — sometimes they produce fifty words and a lot of staring at the ceiling. But they're the days that make the productive days possible, because they're the days where the actual thinking happens.",
        at: '2026-07-25T08:01:00.000Z',
      },
      {
        role: 'agent',
        text: 'You said the thinking happens on the good days, not the productive ones. What does the thinking feel like while it\'s happening?',
        at: '2026-07-25T08:02:00.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "It doesn't feel like thinking. It feels like waiting. I stare at the sentence I just wrote, or the ceiling, and something is turning over below the surface. I can't direct it — if I try to force a conclusion I get something shallow and obvious. The trick is to stay in the chair long enough for the deeper connection to surface on its own. It usually does, but never on schedule. That's why I can't bill for it, can't promise it, can't explain it to anyone who thinks writing is just typing.",
        at: '2026-07-25T08:02:45.000Z',
      },
      {
        role: 'agent',
        text: "What's the longest you've sat waiting for that deeper connection to surface, and was it worth it?",
        at: '2026-07-25T08:03:30.000Z',
        questionForm: 'deliberative',
      },
      {
        role: 'user',
        text: "Three hours, give or take, for a single transition paragraph. The piece was about how systems absorb failure — why some organizations get better after things go wrong and others just get more brittle. I had the argument mapped but the bridge between the technical explanation and the human consequence refused to land. Every version I wrote sounded like a TED talk. I sat there from two in the afternoon until five, wrote and deleted the same four sentences maybe thirty times. Then the right thing arrived fully formed — 'A system that cannot fail safely will fail dangerously, and the difference is whether someone was allowed to say I don't know.' That sentence has been cited more than anything else in the piece. Was it worth three hours? Absolutely. Could I have predicted it would take three hours? Not remotely.",
        at: '2026-07-25T08:04:30.000Z',
      },
    ],
  },
];

// ── CLI ──

const here = import.meta.dirname;
const VAULT_ROOT = join(here, '..', '..', 'vault');
const TRANSCRIPTS_DIR = join(VAULT_ROOT, 'transcripts');
const CORPUS_PATH = join(here, 'corpus.json');

function printStats(entries: CorpusEntry[]): void {
  const totalTurns = entries.reduce((n, e) => n + e.turns.length, 0);
  const totalUserChars = entries.reduce((n, e) => n + userChars(e), 0);
  console.log(`corpus: scripts/ratchet/corpus.json`);
  console.log(`sessions: ${entries.length}`);
  console.log(`totalTurns: ${totalTurns}`);
  console.log(`totalUserChars: ${totalUserChars}`);
  for (const e of entries) {
    console.log(`  ${e.session}  turns=${e.turns.length}  userChars=${userChars(e)}`);
  }
}

export function main(): void {
  const refresh = process.argv.includes('--refresh');
  const exists = existsSync(CORPUS_PATH);

  if (refresh || !exists) {
    const transcripts = scanVaultTranscripts(TRANSCRIPTS_DIR);
    if (transcripts.length === 0) {
      console.error('No vault transcripts found — using built-in synthetic corpus.');
      writeFileSync(CORPUS_PATH, JSON.stringify(SYNTHETIC_CORPUS, null, 2) + '\n', 'utf-8');
      printStats(SYNTHETIC_CORPUS);
    } else {
      const entries = selectTopByUserChars(transcripts, CORPUS_SIZE).map(
        ({ session, turns }) => ({ session, turns }),
      );
      writeFileSync(CORPUS_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
      console.error(
        `Regenerated corpus.json from ${transcripts.length} vault transcripts (kept top ${CORPUS_SIZE} by user chars).`,
      );
      printStats(entries);
    }
    return;
  }

  const data = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
  if (
    !Array.isArray(data) ||
    !data.every(
      (e) =>
        typeof (e as CorpusEntry)?.session === 'string' &&
        Array.isArray((e as CorpusEntry)?.turns),
    )
  ) {
    console.error(
      'corpus.json exists but is not an array of { session, turns } — run with --refresh to rebuild.',
    );
    process.exit(1);
  }
  printStats(data as CorpusEntry[]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
