// Headless persona driver for the depth eval (Run A continuation).
// Bash here cannot make HTTP calls, so every request lives in this file:
//   node scripts/drive-eval.mjs setup <password>
//   node scripts/drive-eval.mjs open <minutes> <energy> [target]
//   node scripts/drive-eval.mjs say <text…>
//   node scripts/drive-eval.mjs act <verbJson>          e.g. '{"v":"end"}'
//   node scripts/drive-eval.mjs harvest-list
//   node scripts/drive-eval.mjs harvest-approve-all
//   node scripts/drive-eval.mjs view [scope]
//   node scripts/drive-eval.mjs coach
// State (cookie + open sitting id) persists at /tmp/elicit-eval-state.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.ELICIT_EVAL_BASE ?? 'http://127.0.0.1:4519';
const STATE_PATH = '/tmp/elicit-eval-state.json';
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(state.cookie ? { cookie: state.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    state.cookie = setCookie.split(';')[0];
    save();
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

function showTurn(envelope) {
  const out = { status: envelope.status };
  const j = envelope.json;
  if (j.turn) {
    out.turn = { kind: j.turn.kind };
    for (const k of ['text', 'target', 'context', 'pulsePrompt', 'offer', 'source']) {
      if (j.turn[k] !== undefined) out.turn[k] = j.turn[k];
    }
    // Anything else on the turn we did not expect — show its keys.
    const known = new Set(['kind', 'text', 'target', 'context', 'pulsePrompt', 'offer', 'source']);
    const extra = Object.keys(j.turn).filter((k) => !known.has(k));
    if (extra.length) out.turnExtraKeys = extra, out.turnExtra = Object.fromEntries(extra.map((k) => [k, j.turn[k]]));
  }
  if (j.notices) out.notices = j.notices;
  if (j.view) out.view = j.view;
  if (j.error) out.error = j.error;
  if (j.fault) out.fault = j.fault;
  if (!j.turn && !j.notices && !j.view && !j.error && !j.fault) out.body = j;
  console.log(JSON.stringify(out, null, 1));
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'setup') {
  const password = args[0] ?? 'eval-tomas';
  let r = await call('POST', '/api/setup', { password });
  if (r.status !== 200) r = await call('POST', '/api/login', { password });
  console.log(JSON.stringify({ status: r.status, body: r.json }));
} else if (cmd === 'open') {
  const [minutes, energy, target] = args;
  const mode = { minutes: Number(minutes), energy, ...(target ? { target } : {}) };
  const r = await call('POST', '/v2/open', { re: { kind: 'sitting' }, mode });
  if (r.json.re?.id) { state.sittingId = r.json.re.id; save(); }
  showTurn(r);
} else if (cmd === 'say') {
  const text = args.join(' ');
  const r = await call('POST', '/v2/say', { re: { kind: 'sitting', id: state.sittingId }, text });
  showTurn(r);
} else if (cmd === 'say-file') {
  const text = readFileSync(args[0], 'utf8').trim();
  const r = await call('POST', '/v2/say', { re: { kind: 'sitting', id: state.sittingId }, text });
  showTurn(r);
} else if (cmd === 'act') {
  const verb = JSON.parse(args[0]);
  const r = await call('POST', '/v2/act', { re: { kind: 'sitting', id: state.sittingId }, verb });
  showTurn(r);
} else if (cmd === 'harvest-list') {
  const r = await call('POST', '/v2/open', { re: { kind: 'harvest', sessionId: state.sittingId } });
  showTurn(r);
} else if (cmd === 'harvest-approve-all') {
  const list = await call('POST', '/v2/open', { re: { kind: 'harvest', sessionId: state.sittingId } });
  const proposals = list.json.view?.proposals ?? list.json.view?.pending ?? [];
  console.log(`proposals: ${proposals.length}`);
  for (let i = 0; i < proposals.length; i++) {
    const r = await call('POST', '/v2/act', {
      re: { kind: 'harvest', sessionId: state.sittingId },
      verb: { v: 'approve', proposal: i },
    });
    console.log(` approve ${i}: ${r.status} ${JSON.stringify(r.json.view ?? r.json)}`);
  }
  const c = await call('POST', '/v2/act', {
    re: { kind: 'harvest', sessionId: state.sittingId },
    verb: { v: 'commit' },
  });
  console.log(`commit: ${c.status} ${JSON.stringify(c.json).slice(0, 600)}`);
} else if (cmd === 'view') {
  const scope = args[0] ? `?scope=${args[0]}` : '';
  const r = await call('GET', `/v2/view${scope}`);
  console.log(JSON.stringify(r.json, null, 1).slice(0, 3000));
} else if (cmd === 'coach') {
  const r = await call('GET', '/api/coach/waiting');
  console.log(JSON.stringify({ status: r.status, body: r.json }, null, 1));
} else if (cmd === 'queue') {
  const r = await call('GET', '/api/queue');
  const j = r.json;
  const brief = (e) => ({ source: e.source, text: (e.text ?? '').slice(0, 90) });
  console.log(JSON.stringify({
    pending: (j.pending ?? []).map(brief),
    open: (j.open ?? []).map(brief),
  }, null, 1));
} else {
  console.error('unknown command', cmd);
  process.exit(1);
}
