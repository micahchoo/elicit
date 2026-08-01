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

    const reading: Reading = { id, ...r };
    const fm = {
      id,
      facet: r.facet,
      stance: r.stance,
      cites: r.cites,
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
    meta: { mode: Mode; protocol: string; started: string },
  ): void {
    const dir = join(this.#root, 'transcripts');
    mkdirSync(dir, { recursive: true });

    const path = join(dir, `${session}.md`);
    const fm = {
      session,
      mode: meta.mode,
      protocol: meta.protocol,
      started: meta.started,
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
        };
        readings[data.id] = {
          id: data.id,
          facet: data.facet,
          stance: data.stance,
          cites: data.cites,
          reading: parsed.content.trimEnd(),
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
