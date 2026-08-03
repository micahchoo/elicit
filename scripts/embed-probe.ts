// Endpoint diagnostics for ticket 007. Local Ollama only (ADR-0001, Q-2).
const BASE = 'http://127.0.0.1:11434';

async function tryCall(label: string, path: string, body: unknown, ms = 600000) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
    });
    const text = await r.text();
    let dim: unknown = 'n/a';
    try {
      const j = JSON.parse(text);
      dim = j.data?.[0]?.embedding?.length ?? j.embeddings?.[0]?.length ?? j.embedding?.length ?? 'none';
    } catch { /* not json */ }
    console.log(`[${label}] HTTP ${r.status} ${Date.now() - t0}ms dim=${dim}`);
    if (!r.ok) console.log(`  body: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`[${label}] THREW ${Date.now() - t0}ms ${String(e)}`);
  }
}

async function main() {
  await tryCall('nomic /v1', '/v1/embeddings', { model: 'nomic-embed-text', input: 'hello world' });
  await tryCall('qwen /v1 short', '/v1/embeddings', { model: 'qwen3-embedding', input: 'hello' });
  await tryCall('qwen /v1 :latest', '/v1/embeddings', { model: 'qwen3-embedding:latest', input: 'hello' });
  await tryCall('qwen /api/embed', '/api/embed', { model: 'qwen3-embedding', input: 'hello' });
  await tryCall('qwen /api/embeddings', '/api/embeddings', { model: 'qwen3-embedding', prompt: 'hello' });
  const ps = await fetch(`${BASE}/api/ps`).then(r => r.json() as any).catch(e => String(e));
  console.log('LOADED:', JSON.stringify(ps));
}
main();
