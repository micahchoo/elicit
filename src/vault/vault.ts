import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type {
  Vault,
  Snippet,
  Reading,
  Bud,
  Turn,
  Mode,
  Provenance,
  Index,
  Facet,
  Stance,
} from '../types.js';

export function createVault(root: string): Vault {
  return new VaultImpl(root);
}

/**
 * Which model wrote a reading (Q-34).
 *
 * Readings come from the harvester, which is clerk-role work (Q-48), so this
 * reads the clerk role's env var and default — the same pair `src/llm.ts`
 * resolves for that role, duplicated here rather than imported to keep the
 * vault free of the model layer. `tests/vault.test.ts` asserts the two agree.
 *
 * Read here rather than passed in: `decide()` is the only caller of
 * `saveReading` and has no model name in scope, and an optional parameter
 * nobody passes is how Q-34 stayed unmet.
 */
function clerkModel(): string {
  return process.env.ELICIT_CLERK_MODEL ?? 'qwen3.6:35b';
}

class VaultImpl implements Vault {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  // ── Snippets ──

  saveSnippet(prose: string, provenance: Provenance): Snippet {
    const id = ulid();
    const captured = new Date().toISOString();
    const dir = join(this.#root, 'snippets', id);
    mkdirSync(dir, { recursive: true });

    const snippet: Snippet = { id, version: 1, captured, provenance, prose };
    const fm = {
      id,
      version: 1,
      captured,
      provenance,
    };
    const content = matter.stringify(prose, fm);
    writeFileSync(join(dir, 'v1.md'), content, 'utf-8');
    return snippet;
  }

  saveVersion(snippetId: string, prose: string): Snippet {
    const dir = join(this.#root, 'snippets', snippetId);
    const existing = readdirSync(dir);
    const versionNums = existing
      .filter((f) => /^v\d+\.md$/.test(f))
      .map((f) => Number(f.match(/^v(\d+)\.md$/)![1]));
    const nextVersion = Math.max(...versionNums) + 1;

    // Read latest version to preserve id and provenance
    const latestFile = join(dir, `v${nextVersion - 1}.md`);
    const parsed = matter.read(latestFile);
    const prevData = parsed.data as {
      id: string;
      version: number;
      captured: string;
      provenance: Provenance;
    };

    const captured = new Date().toISOString();
    const snippet: Snippet = {
      id: snippetId,
      version: nextVersion,
      captured,
      provenance: prevData.provenance,
      prose,
    };
    const fm = {
      id: snippetId,
      version: nextVersion,
      captured,
      provenance: prevData.provenance,
    };
    const content = matter.stringify(prose, fm);
    writeFileSync(join(dir, `v${nextVersion}.md`), content, 'utf-8');
    return snippet;
  }

  // ── Readings ──

  saveReading(r: {
    facet: Facet;
    stance: Stance;
    reading: string;
    cites: string[];
  }): Reading {
    const id = ulid();
    const dir = join(this.#root, 'wiki', 'readings');
    mkdirSync(dir, { recursive: true });

    const at = new Date().toISOString();
    const model = clerkModel();
    // `modelAt` starts equal to `at` and parts from it on re-annotation: a
    // later model restamps who read the reading without moving when the
    // reading happened (Q-34).
    const reading: Reading = { id, ...r, at, model, modelAt: at };
    const fm = {
      id,
      facet: r.facet,
      stance: r.stance,
      cites: r.cites,
      // The stamp lives in the markdown, because the markdown is the truth
      // and the index is rebuilt from it (Q-3).
      at,
      model,
      modelAt: at,
    };
    const content = matter.stringify(r.reading, fm);
    writeFileSync(join(dir, `${id}.md`), content, 'utf-8');
    return reading;
  }

  // ── Buds ──

  saveBud(fragment: string, failures: string[], session: string): Bud {
    const id = ulid();
    const dir = join(this.#root, 'buds');
    mkdirSync(dir, { recursive: true });

    const captured = new Date().toISOString();
    const bud: Bud = { id, captured, session, failures, fragment };
    const fm = { id, captured, session, failures };
    const content = matter.stringify(fragment, fm);
    writeFileSync(join(dir, `${id}.md`), content, 'utf-8');
    return bud;
  }

  // ── Transcripts ──

  startTranscript(
    session: string,
    meta: {
      mode: Mode;
      protocol: string;
      started: string;
      /** The quest this sitting returns to (Q-75). Absent on every ordinary sitting. */
      quest?: string;
      /** The coached Direction this capture belongs to. Absent means untagged. */
      direction?: string;
    },
  ): void {
    const dir = join(this.#root, 'transcripts');
    mkdirSync(dir, { recursive: true });

    const path = join(dir, `${session}.md`);
    const fm = {
      session,
      mode: meta.mode,
      protocol: meta.protocol,
      started: meta.started,
      ...(meta.quest !== undefined ? { quest: meta.quest } : {}),
      ...(meta.direction !== undefined ? { direction: meta.direction } : {}),
    };
    const content = matter.stringify('', fm);
    writeFileSync(path, content, 'utf-8');
  }

  appendTurn(session: string, turn: Turn): void {
    const path = join(this.#root, 'transcripts', `${session}.md`);
    let existing: string;
    try {
      existing = readFileSync(path, 'utf-8');
    } catch {
      throw new Error(
        `Transcript "${session}" does not exist. Call startTranscript first.`,
      );
    }

    const prevLen = Buffer.byteLength(existing);
    const role = turn.role === 'agent' ? 'agent' : 'user';
    const block = `## ${role}\n\n${turn.text}\n\n`;
    const updated = existing + block;

    if (Buffer.byteLength(updated) < prevLen) {
      throw new Error(
        `appendTurn would shrink transcript "${session}". It will not be applied.`,
      );
    }

    writeFileSync(path, updated, 'utf-8');
  }

  // ── Index ──

  rebuildIndex(): Index {
    const snippets: Record<string, Snippet> = {};
    const readings: Record<string, Reading> = {};
    const buds: Record<string, Bud> = {};

    // Scan snippets
    const snippetsDir = join(this.#root, 'snippets');
    try {
      for (const dirName of readdirSync(snippetsDir)) {
        const dir = join(snippetsDir, dirName);
        const files = readdirSync(dir)
          .filter((f) => /^v\d+\.md$/.test(f))
          .sort((a, b) => {
            const va = Number(a.match(/^v(\d+)\.md$/)![1]);
            const vb = Number(b.match(/^v(\d+)\.md$/)![1]);
            return vb - va; // newest first
          });
        const newest = files[0];
        if (!newest) continue;
        const latest = join(dir, newest);
        const parsed = matter.read(latest);
        const data = parsed.data as {
          id: string;
          version: number;
          captured: string;
          provenance: Provenance;
        };
        snippets[data.id] = {
          id: data.id,
          version: data.version,
          captured: data.captured,
          provenance: data.provenance,
          prose: parsed.content.trimEnd(),
        };
      }
    } catch {
      // No snippets directory yet — ok
    }

    // Scan readings
    const readingsDir = join(this.#root, 'wiki', 'readings');
    try {
      for (const file of readdirSync(readingsDir)) {
        if (!file.endsWith('.md')) continue;
        const parsed = matter.read(join(readingsDir, file));
        const data = parsed.data as {
          id: string;
          facet: Facet;
          stance: Stance;
          cites: string[];
          at?: string;
          model?: string;
          modelAt?: string;
        };
        readings[data.id] = {
          id: data.id,
          facet: data.facet,
          stance: data.stance,
          cites: data.cites,
          reading: parsed.content.trimEnd(),
          // Absent stays absent. Every reading written before the stamp
          // existed carries none of the three, and a key holding `undefined`
          // is a different thing from a missing key — it would read as a
          // reading claiming to have no model rather than one written before
          // models were recorded.
          ...(data.at ? { at: data.at } : {}),
          ...(data.model ? { model: data.model } : {}),
          ...(data.modelAt ? { modelAt: data.modelAt } : {}),
        };
      }
    } catch {
      // No readings directory yet — ok
    }

    // Scan buds
    const budsDir = join(this.#root, 'buds');
    try {
      for (const file of readdirSync(budsDir)) {
        if (!file.endsWith('.md')) continue;
        const parsed = matter.read(join(budsDir, file));
        const data = parsed.data as {
          id: string;
          captured: string;
          session: string;
          failures: string[];
        };
        buds[data.id] = {
          id: data.id,
          captured: data.captured,
          session: data.session,
          failures: data.failures,
          fragment: parsed.content.trimEnd(),
        };
      }
    } catch {
      // No buds directory yet — ok
    }

    return { snippets, readings, buds };
  }
}
