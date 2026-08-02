import type {
  CutProposal,
  HarvestDecision,
  Mode,
  QuestionForm,
  Snippet,
  Target,
  QueueEntry,
} from '../src/types.ts';
import type { Claim, Contradiction } from '../src/wiki/contract.ts';
import { formatEvent, relativeTime } from '../src/log/format.js';
import { sourceLabel } from '../src/queue/source-label.js';

/* ─── API types ─── */

interface SessionResponse {
  sessionId: string;
  question: string;
  /** Present when the Randomizer dealt the opener (Q-18). */
  source?: 'deck' | 'resurfacing';
}

interface TurnData {
  kind: 'probe' | 'saturated';
  text?: string;
  questionForm?: QuestionForm;
  phase?: string;
  juxtaposition?: { snippetText: string; snippetDate: string };
}

interface EndResponse {
  proposals: CutProposal[];
}

interface HarvestResponse {
  snippets: unknown[];
  buds: unknown[];
}

interface QueueData {
  pending: QueueEntry[];
  open: QueueEntry[];
}

interface ActivityEvent {
  at: string;
  actor: string;
  kind: string;
  detail: string;
}

/**
 * `GET /api/wiki` — already shaped for reading (src/server.ts). Headings and
 * lint notes arrive as words, claims arrive in the order they are meant to be
 * read, and `lintedAt: null` means the Clerk has not read the wiki yet, which
 * is a different thing from having read it and found nothing.
 */
interface WikiFacetGroup {
  facet: string;
  heading: string;
  claims: Claim[];
}

interface WikiLintNote {
  kind: string;
  /** A claim id, a facet name, or a referent slug. NEVER printed (ticket 038). */
  subject: string;
  note: string;
}

interface WikiResponse {
  facets: WikiFacetGroup[];
  contradictions: Contradiction[];
  lint: WikiLintNote[];
  lintedAt: string | null;
  all: boolean;
}

/* ─── DOM helpers ─── */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  }
  for (const c of children) {
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

/* ─── State ─── */

type Screen = 'mode' | 'exchange' | 'harvest' | 'done' | 'waiting' | 'login' | 'setup' | 'unprompted' | 'wiki';

interface AppState {
  screen: Screen;
  sessionId: string | null;
  question: string | null;
  proposals: CutProposal[];
  decisions: HarvestDecision[];
  turnPhase: string | null;
  juxtaposition: { snippetText: string; snippetDate: string } | null;
  sttAvailable: boolean;
  dictating: boolean;
  turnHadSpeech: boolean;
}
const state: AppState = {
  screen: 'mode',
  sessionId: null,
  question: null,
  proposals: [],
  decisions: [],
  turnPhase: null,
  juxtaposition: null,
  sttAvailable: false,
  dictating: false,
  turnHadSpeech: false,
};

const main = $('main')!;

/* ─── Navigation ─── */

function navTo(screen: Screen) {
  state.screen = screen;
  switch (screen) {
    case 'mode': renderMode(); break;
    case 'exchange': renderExchange(); break;
    case 'harvest': renderHarvest(); break;
    case 'done': renderDone(); break;
    case 'waiting': renderWaiting(); break;
    case 'wiki': renderWiki(false); break;
    case 'unprompted': renderUnprompted(); break;
    case 'login': renderLogin(); break;
    case 'setup': renderSetup(); break;
  }
}


/**
 * A failed call. `handled` means api() already put the explanation on screen,
 * so the caller's waiting affordance leaves without adding a second line.
 */
class ApiError extends Error {
  readonly status: number;
  readonly handled: boolean;
  constructor(message: string, status: number, handled = false) {
    super(message);
    this.status = status;
    this.handled = handled;
  }
}

/**
 * Read routes, by prefix. `/api/wiki` is matched exactly (with its query
 * string) rather than by prefix, because `/api/wiki/claim/:id/read` sits under
 * the same path and is the one write the wiki surface makes.
 */
const GET_PREFIXES = ['/api/queue', '/api/activity', '/api/stt/status', '/api/cadence', '/api/snippets'];

function isReadPath(path: string): boolean {
  if (GET_PREFIXES.some((p) => path.startsWith(p))) return true;
  return path === '/api/wiki' || path.startsWith('/api/wiki?');
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const method = isReadPath(path) ? 'GET' : 'POST';
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    // A 401 from /api/login is a wrong password, not an expired session —
    // the login screen must stay put so it can say so.
    if (res.status === 401 && !path.startsWith('/api/login')) {
      navTo('login');
      throw new ApiError('unauthorized', 401, true);
    }
    if (res.status === 403) {
      let setupRequired = false;
      try {
        const data = await res.json() as { error?: string };
        setupRequired = data.error === 'setup required';
      } catch { /* not JSON */ }
      if (setupRequired) {
        // Server wants setup from host machine — this client is remote
        showError('finish setup from the host machine');
        throw new ApiError('setup required', 403, true);
      }
      throw new ApiError('403 Forbidden', 403);
    }
    const text = await res.text();
    throw new ApiError(`${res.status} ${res.statusText}: ${text}`, res.status);
  }
  return res.json() as T;
}

async function apiRaw(path: string): Promise<Response> {
  const res = await fetch(path, { method: 'GET' });
  if (!res.ok) {
    if (res.status === 401) { navTo('login'); throw new ApiError('unauthorized', 401, true); }
    throw new ApiError(`${res.status}`, res.status);
  }
  return res;
}

/* ─── Render ─── */

function clear() {
  releaseReadWatch();
  main.innerHTML = '';
}

function showError(msg: string) {
  const err = el('p', { class: 'error-msg' }, msg);
  main.append(err);
}

/* ── Waiting ── */

const WAIT_FAILED = 'that did not go through — try again';

interface Wait {
  /** The call returned. Take the affordance away. */
  done(): void;
  /** The call failed. Leave one dimmed line where the affordance was. */
  failed(cause: unknown, message?: string): void;
}

function showQuietError(container: HTMLElement, message: string) {
  container.append(el('p', { class: 'quiet-error' }, message));
}

/**
 * Say that something is happening, in the register of the page: a hairline
 * drawing across the measure plus one dimmed line. `delayMs` holds it back so
 * a fast call does not flash.
 *
 * Phase 2 (ticket 039) replaces the label of the /end wait with turn-by-turn
 * progress, once the chunked harvest reports which turn it is reading.
 */
function beginWait(container: HTMLElement, label: string, delayMs = 0): Wait {
  for (const stale of container.querySelectorAll(':scope > .wait, :scope > .quiet-error')) {
    stale.remove();
  }

  const block = el('div', { class: 'wait' });
  block.append(
    el('div', { class: 'wait-rule' }, el('span', { class: 'wait-sweep' })),
    el('p', { class: 'wait-label' }, label),
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (delayMs > 0) timer = setTimeout(() => container.append(block), delayMs);
  else container.append(block);

  let live = true;
  /** Ends the wait once; reports whether this call is the one that ended it. */
  function stop(): boolean {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const wasLive = live;
    live = false;
    return wasLive;
  }

  return {
    done() {
      if (stop()) block.remove();
    },
    failed(cause: unknown, message = WAIT_FAILED) {
      if (!stop()) return;
      console.error(cause);
      block.remove();
      if (cause instanceof ApiError && cause.handled) return;
      showQuietError(container, message);
    },
  };
}

/* ── Login screen ── */

function renderLogin() {
  clear();
  state.screen = 'login';

  const div = el('div', { class: 'screen active login-form' });
  const heading = el('h1', { class: 'login-heading' }, 'elicit');
  const input = el('input', {
    class: 'login-input',
    type: 'password',
    placeholder: 'password',
  });
  const submit = el('button', { class: 'submit-btn' }, 'enter');
  const errorSlot = el('div', { class: 'error-slot' });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    errorSlot.innerHTML = '';
    const wait = beginWait(errorSlot, 'checking…');
    try {
      await api('/api/login', { password: input.value });
      wait.done();
      navTo('mode');
    } catch (e) {
      const rejected = e instanceof ApiError && e.status === 401;
      wait.failed(e, rejected ? 'wrong password' : undefined);
      submit.disabled = false;
      input.focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  div.append(heading, input, submit, errorSlot);
  main.append(div);
  input.focus();
}

/* ── Setup screen ── */

function renderSetup() {
  clear();
  state.screen = 'setup';

  const div = el('div', { class: 'screen active login-form' });
  const heading = el('h1', { class: 'login-heading' }, 'set a password');
  const hint = el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin-bottom: 0.5rem' }, 'choose a password to gate LAN access');
  const input = el('input', {
    class: 'login-input',
    type: 'password',
    placeholder: 'password',
  });
  const confirm = el('input', {
    class: 'login-input',
    type: 'password',
    placeholder: 'confirm password',
  });
  const submit = el('button', { class: 'submit-btn' }, 'set password');
  const errorSlot = el('div', { class: 'error-slot' });
  const backLink = el('button', { class: 'nav-link' }, '\u2190 back');
  backLink.addEventListener('click', () => navTo('mode'));

  submit.addEventListener('click', async () => {
    const pw = input.value;
    if (!pw) {
      errorSlot.innerHTML = '';
      errorSlot.append('password cannot be empty');
      return;
    }
    if (pw !== confirm.value) {
      errorSlot.innerHTML = '';
      errorSlot.append('passwords do not match');
      return;
    }
    submit.disabled = true;
    errorSlot.innerHTML = '';
    const wait = beginWait(errorSlot, 'saving the password…');
    try {
      await api('/api/setup', { password: pw });
      wait.done();
      navTo('mode');
    } catch (e) {
      wait.failed(e);
      submit.disabled = false;
    }
  });

  confirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  div.append(backLink, heading, hint, input, confirm, submit, errorSlot);
  main.append(div);
  input.focus();
}

/* ── Mode screen ── */

function renderMode(showSetupHint?: boolean) {
  clear();
  state.screen = 'mode';
  state.turnPhase = null;
  state.juxtaposition = null;

  const div = el('div', { class: 'screen active mode-form' });

  const minutesRow = el('div', { class: 'mode-row' });
  const minLabel = el('label', {}, 'how long?');
  const minSelect = el('select', { class: 'mode-select' });
  for (const m of [10, 25, 45]) {
    minSelect.append(el('option', { value: String(m) }, `${m} minutes`));
  }
  minutesRow.append(minLabel, minSelect);

  const energyRow = el('div', { class: 'mode-row' });
  const enLabel = el('label', {}, 'energy?');
  const enSelect = el('select', { class: 'mode-select' });
  for (const e of ['low', 'medium', 'high'] as const) {
    enSelect.append(el('option', { value: e }, e));
  }
  energyRow.append(enLabel, enSelect);

  const targetRow = el('div', { class: 'mode-row' });
  const tgtLabel = el('label', {}, 'about?');
  const tgtSelect = el('select', { class: 'mode-select' });
  tgtSelect.append(el('option', { value: 'self' }, 'myself'));
  tgtSelect.append(el('option', { value: 'domain' }, 'something I know'));
  targetRow.append(tgtLabel, tgtSelect);

  const topicInput = el('input', {
    class: 'topic-input',
    type: 'text',
    placeholder: 'what would you like to talk about? (optional)',
  });

  const navRow = el('div', { class: 'mode-nav' });
  const waitingLink = el('button', { class: 'nav-link' }, 'waiting surface');
  waitingLink.addEventListener('click', () => navTo('waiting'));
  const writeLink = el('button', { class: 'nav-link' }, 'just write');
  writeLink.addEventListener('click', () => navTo('unprompted'));
  const wikiLink = el('button', { class: 'nav-link' }, 'what the clerk has written');
  wikiLink.addEventListener('click', () => navTo('wiki'));
  navRow.append(waitingLink, writeLink, wikiLink);

  if (showSetupHint) {
    const setupLink = el('button', { class: 'nav-link' }, 'set a password');
    setupLink.addEventListener('click', () => navTo('setup'));
    navRow.append(setupLink);
  }

  const submit = el('button', { class: 'submit-btn' }, 'begin');
  const errorSlot = el('div', { class: 'error-slot' });

  async function begin(shuffle: boolean) {
    submit.disabled = true;
    shuffleLink.disabled = true;
    errorSlot.innerHTML = '';
    const wait = beginWait(
      errorSlot,
      shuffle ? 'shuffling…' : 'finding a question…',
    );
    try {
      const mode: Mode = {
        minutes: Number(minSelect.value),
        energy: enSelect.value as Mode['energy'],
        target: tgtSelect.value as Target,
      };
      const t = topicInput.value.trim();
      if (t) mode.topic = t;

      const res = await api<SessionResponse>(
        '/api/session',
        shuffle ? { mode, shuffle: true } : { mode },
      );
      state.sessionId = res.sessionId;
      state.question = res.question;
      wait.done();
      renderExchange();
    } catch (e) {
      wait.failed(e);
      submit.disabled = false;
      shuffleLink.disabled = false;
    }
  }

  // The Randomizer, as a sentence rather than a button row (the document rule
  // in docs/interface-references.md): the control is the two words that name
  // what happens, sitting at the point of attention just under "begin".
  const shuffleRow = el('div', { class: 'mode-aside' });
  const shuffleLink = el('button', { class: 'nav-link' }, 'shuffle a deck');
  shuffleRow.append(document.createTextNode('or '), shuffleLink, document.createTextNode('.'));

  submit.addEventListener('click', () => void begin(false));
  shuffleLink.addEventListener('click', () => void begin(true));

  topicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  div.append(minutesRow, energyRow, targetRow, topicInput, navRow, submit, shuffleRow, errorSlot);
  main.append(div);
}

/* ── Unprompted entry: a blank page, no question ── */

function renderUnprompted() {
  clear();
  state.screen = 'unprompted';
  state.sessionId = null;
  state.question = null;
  state.proposals = [];
  state.decisions = [];

  const div = el('div', { class: 'screen active' });

  const backRow = el('div', { class: 'blank-page-nav' });
  const backBtn = el('button', { class: 'nav-link' }, '← back');
  backBtn.addEventListener('click', () => navTo('mode'));
  backRow.append(backBtn);

  const page = el('textarea', {
    class: 'blank-page',
    rows: '1',
  }) as HTMLTextAreaElement;

  const doneBtn = el('button', { class: 'harvest-now' }, 'done');
  const errorSlot = el('div', { class: 'error-slot' });

  function grow() {
    page.style.height = 'auto';
    page.style.height = page.scrollHeight + 'px';
  }
  page.addEventListener('input', grow);

  doneBtn.addEventListener('click', async () => {
    const text = page.value.trim();
    if (!text) return;
    doneBtn.disabled = true;
    page.disabled = true;
    errorSlot.innerHTML = '';
    const wait = beginWait(errorSlot, 'reading what you wrote…');
    try {
      const res = await api<{ sessionId: string; proposals: CutProposal[] }>(
        '/api/unprompted',
        { text },
      );
      state.sessionId = res.sessionId;
      state.proposals = res.proposals;
      wait.done();
      renderHarvest();
    } catch (e) {
      wait.failed(e);
      doneBtn.disabled = false;
      page.disabled = false;
    }
  });

  div.append(backRow, page, doneBtn, errorSlot);
  main.append(div);

  requestAnimationFrame(() => {
    page.focus();
    grow();
  });
}

/* ── Exchange screen ── */

let exchangeTurnCount = 0;

// ── STT recording ──

let _micStream: MediaStream | null = null;
let _audioCtx: AudioContext | null = null;
let _workletNode: AudioWorkletNode | null = null;
let _samples: Float32Array[] = [];

async function startRecording(): Promise<void> {
  _samples = [];
  _audioCtx = new AudioContext({ sampleRate: 16000 });
  _micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
  });

  // Inline AudioWorklet processor — downsamples to mono Float32
  const workletCode = `
    class RecorderProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input.length > 0) {
          const ch = input[0];
          if (ch) {
            const copy = new Float32Array(ch.length);
            copy.set(ch);
            this.port.postMessage(copy, [copy.buffer]);
          }
        }
        return true;
      }
    }
    registerProcessor('recorder-processor', RecorderProcessor);
  `;
  const blob = new Blob([workletCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await _audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  _workletNode = new AudioWorkletNode(_audioCtx, 'recorder-processor');
  _workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
    _samples.push(e.data);
  };

  const source = _audioCtx.createMediaStreamSource(_micStream);
  source.connect(_workletNode);
}

async function stopAndTranscribe(): Promise<string> {
  // Stop media
  _workletNode?.port.close();
  _workletNode?.disconnect();
  _workletNode = null;
  _micStream?.getTracks().forEach((t) => t.stop());
  _micStream = null;
  await _audioCtx?.close();
  _audioCtx = null;

  if (_samples.length === 0) return '';

  // Concatenate all chunks
  let totalLen = 0;
  for (const chunk of _samples) totalLen += chunk.length;
  const combined = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of _samples) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  _samples = [];

  // POST raw Float32 to server
  const res = await fetch('/api/transcribe?rate=16000', {
    method: 'POST',
    body: combined.buffer,
  });
  if (!res.ok) {
    if (res.status === 401) { navTo('login'); throw new Error('Unauthorized'); }
    const errText = await res.text();
    throw new Error(`transcribe failed: ${res.status} ${errText}`);
  }
  const data = await res.json() as { text: string };
  return data.text;
}

function renderExchange() {
  clear();
  state.screen = 'exchange';
  exchangeTurnCount = 0;
  state.turnHadSpeech = false;
  state.dictating = false;

  const div = el('div', { class: 'screen active' });

  const header = el('div', { class: 'exchange-header' });
  const questionBlock = el('div', { class: 'question-block' }, state.question!);
  header.append(questionBlock);

  // Juxtaposition snippet display
  const juxDiv = el('div', { class: 'juxtaposition' });
  if (state.juxtaposition) {
    juxDiv.classList.add('active');
    juxDiv.append(
      el('span', { class: 'jux-date' }, state.juxtaposition.snippetDate),
      el('blockquote', { class: 'jux-quote' }, state.juxtaposition.snippetText),
    );
  }
  header.append(juxDiv);

  const transcript = el('div', { class: 'transcript' });

  const answerArea = el('div', { class: 'answer-area' });
  const answerRow = el('div', { class: 'answer-row' });
  const textarea = el('textarea', {
    class: 'answer-textarea',
    placeholder: '\u2026',
    rows: '2',
  });
  const micBtn = el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
  const micStatus = el('span', { class: 'mic-status' });
  const harvestBtn = el('button', { class: 'harvest-now' }, 'harvest now');
  const skipBtn = el('button', { class: 'harvest-now' }, 'skip');
  const laterBtn = el('button', { class: 'harvest-now' }, 'later');

  // Margin follow-up: what the question needs before it can be answered.
  const deferRow = el('div', { class: 'defer-row' });
  const deferPrompt = el('span', { class: 'defer-prompt' }, 'when I have more');
  const timeWord = el('button', { class: 'defer-need' }, 'time');
  const energyWord = el('button', { class: 'defer-need' }, 'energy');
  const plainWord = el('button', { class: 'defer-need' }, 'just later');
  deferRow.append(deferPrompt, timeWord, energyWord, plainWord);

  answerRow.append(textarea, micBtn, micStatus);
  answerArea.append(answerRow, harvestBtn, skipBtn, laterBtn, deferRow);


  div.append(header, transcript, answerArea);
  main.append(div);

  // typewriter auto-grow
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });

  // focus dimming
  textarea.addEventListener('focus', () => {
    document.body.classList.add('answering');
  });
  textarea.addEventListener('blur', () => {
    document.body.classList.remove('answering');
  });

  async function sendTurn() {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.disabled = true;
    harvestBtn.disabled = true;
    skipBtn.disabled = true;
    laterBtn.disabled = true;
    deferRow.classList.remove('active');
    if (state.sttAvailable) micBtn.disabled = true;

    // The answer moves into the transcript now, so it is not on screen twice
    // while the probe is out. A failure puts it back in the field.
    const userTurn = appendTurn('user', text);
    textarea.value = '';
    textarea.style.height = 'auto';

    const body: Record<string, unknown> = { text };
    if (state.turnHadSpeech) body.spoken = true;

    const wait = beginWait(answerArea, 'thinking…');

    try {
      const res = await api<TurnData>(
        `/api/session/${state.sessionId}/turn`,
        body,
      );

      wait.done();
      state.turnHadSpeech = false;

      if (res.kind === 'probe') {
        state.question = res.text!;
        state.turnPhase = res.phase ?? null;
        state.juxtaposition = res.juxtaposition ?? null;

        // Update question + juxtaposition display
        questionBlock.textContent = res.text!;
        juxDiv.innerHTML = '';
        if (state.juxtaposition) {
          juxDiv.classList.add('active');
          juxDiv.append(
            el('span', { class: 'jux-date' }, state.juxtaposition.snippetDate),
            el('blockquote', { class: 'jux-quote' }, state.juxtaposition.snippetText),
          );
        } else {
          juxDiv.classList.remove('active');
        }

        appendTurn('agent', res.text!);
      } else {
        // saturated
        renderHarvest();
        return;
      }
    } catch (e) {
      // Their words go back to the field, or "try again" means nothing.
      wait.failed(e);
      userTurn.remove();
      exchangeTurnCount--;
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
    }

    textarea.disabled = false;
    harvestBtn.disabled = false;
    skipBtn.disabled = false;
    laterBtn.disabled = false;
    if (state.sttAvailable) micBtn.disabled = false;
    textarea.focus();
    textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTurn();
    }
  });

  /** Enable or disable everything that would race the call in flight. */
  function setControlsBusy(busy: boolean) {
    textarea.disabled = busy;
    harvestBtn.disabled = busy;
    skipBtn.disabled = busy;
    laterBtn.disabled = busy;
    if (state.sttAvailable) micBtn.disabled = busy;
  }

  harvestBtn.addEventListener('click', async () => {
    setControlsBusy(true);
    // The longest wait in the app — around twenty seconds. Phase 2 turns this
    // label into "reading turn 3 of 6" once the harvest reports its progress.
    const wait = beginWait(answerArea, 'reading back what you said…');
    try {
      const res = await api<EndResponse>(
        `/api/session/${state.sessionId}/end`,
      );
      state.proposals = res.proposals;
      wait.done();
      renderHarvest();
    } catch (e) {
      wait.failed(e);
      setControlsBusy(false);
    }
  });

  /** Show the replacement question skip and defer both return, or close the exchange. */
  function takeNextQuestion(res: { kind: string; text?: string }) {
    if (res.kind === 'question') {
      state.question = res.text!;
      state.juxtaposition = null;
      juxDiv.classList.remove('active');
      juxDiv.innerHTML = '';
      questionBlock.textContent = res.text!;
      textarea.value = '';
      textarea.style.height = 'auto';
      textarea.focus();
    } else {
      questionBlock.textContent = '';
      questionBlock.append(
        el('p', { class: 'skip-exhausted' }, 'No more starters. Consider harvesting.'),
      );
      skipBtn.disabled = true;
      laterBtn.disabled = true;
      harvestBtn.disabled = true;
      textarea.disabled = true;
    }
  }

  skipBtn.addEventListener('click', async () => {
    skipBtn.disabled = true;
    const wait = beginWait(answerArea, 'finding another…');
    try {
      const res = await api<{ kind: string; text?: string }>(
        `/api/session/${state.sessionId}/skip`,
      );
      wait.done();
      takeNextQuestion(res);
    } catch (e) {
      wait.failed(e);
      skipBtn.disabled = false;
    }
  });

  // ── Defer: the question goes back to the queue with what it needs ──

  laterBtn.addEventListener('click', () => {
    deferRow.classList.toggle('active');
  });

  async function defer(need?: 'time' | 'energy') {
    laterBtn.disabled = true;
    skipBtn.disabled = true;
    const wait = beginWait(answerArea, 'putting it back…');
    try {
      const res = await api<{ kind: string; text?: string }>(
        `/api/session/${state.sessionId}/defer`,
        need ? { need } : undefined,
      );
      wait.done();
      deferRow.classList.remove('active');
      takeNextQuestion(res);
    } catch (e) {
      wait.failed(e);
      laterBtn.disabled = false;
      skipBtn.disabled = false;
    }
  }

  timeWord.addEventListener('click', () => defer('time'));
  energyWord.addEventListener('click', () => defer('energy'));
  plainWord.addEventListener('click', () => defer());

  // ── Mic toggle ──

  let micActive = false;
  let micBusy = false;

  micBtn.addEventListener('click', async () => {
    if (micBusy) return;
    if (!micActive) {
      // Start recording
      try {
        await startRecording();
        micActive = true;
        micBtn.classList.add('active');
        micStatus.textContent = 'listening\u2026';
        state.dictating = true;
      } catch (e) {
        console.error(e);
        showQuietError(answerArea, 'the microphone did not open — check permission');
      }
    } else {
      // Stop and transcribe
      micActive = false;
      micBusy = true;
      micBtn.classList.remove('active');
      micBtn.disabled = true;
      micStatus.textContent = 'transcribing\u2026';
      try {
        const text = await stopAndTranscribe();
        if (text) {
          state.turnHadSpeech = true;
          // Append at cursor or end
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const before = textarea.value.slice(0, start ?? textarea.value.length);
          const after = textarea.value.slice(end ?? textarea.value.length);
          textarea.value = before + text + after;
          textarea.dispatchEvent(new Event('input'));
          textarea.focus();
        }
      } catch (e) {
        console.error(e);
        showQuietError(answerArea, 'that did not come through — say it again');
      }
      micBusy = false;
      micBtn.disabled = false;
      micStatus.textContent = '';
      state.dictating = false;
    }
  });

  // Check STT availability and hide toggle if unavailable
  (async () => {
    try {
      const status = await api<{ available: boolean }>('/api/stt/status');
      state.sttAvailable = status.available;
    } catch {
      state.sttAvailable = false;
    }
    if (!state.sttAvailable) {
      micBtn.style.display = 'none';
      micStatus.style.display = 'none';
    }
  })();

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.scrollIntoView({ block: 'center' });
  });

  function appendTurn(role: 'agent' | 'user', text: string): HTMLDivElement {
    exchangeTurnCount++;
    const turn = el('div', { class: `turn ${role}` }, text);
    transcript.append(turn);
    turn.scrollIntoView({ block: 'nearest' });
    return turn;
  }
}

/* ── Harvest screen ── */

function renderHarvest() {
  clear();
  state.screen = 'harvest';
  state.decisions = [];

  const div = el('div', { class: 'screen active' });

  const empty = state.proposals.length === 0;

  const heading = el(
    'div',
    { class: empty ? 'question-block empty-msg' : 'question-block' },
    empty
      ? 'nothing from this sitting stood on its own \u2014 that happens'
      : 'review what you said',
  );
  div.append(heading);

  const list = el('div', { class: 'harvest-list' });
  div.append(list);

  const errorSlot = el('div', { class: 'error-slot' });
  div.append(errorSlot);

  if (empty) {
    const closeBtn = el(
      'button',
      { class: 'submit-btn', style: 'margin-top: 1.5rem' },
      'close',
    );
    closeBtn.addEventListener('click', () => navTo('mode'));
    div.append(closeBtn);
  } else {
    const submitRow = el('div', { style: 'margin-top: 1.5rem' });
    const submitBtn = el('button', { class: 'submit-btn' }, 'save');
    submitRow.append(submitBtn);
    div.append(submitRow);

    submitBtn.addEventListener('click', async () => {
      if (state.decisions.length < state.proposals.length) {
        errorSlot.innerHTML = '';
        errorSlot.append(
          el('p', { class: 'error-msg' }, 'decide on each proposal first'),
        );
        return;
      }
      submitBtn.disabled = true;
      errorSlot.innerHTML = '';
      const wait = beginWait(errorSlot, 'writing them down…');
      try {
        await api<HarvestResponse>(
          `/api/session/${state.sessionId}/harvest`,
          { decisions: state.decisions },
        );
        wait.done();
        renderDone();
      } catch (e) {
        wait.failed(e);
        submitBtn.disabled = false;
      }
    });
  }

  main.append(div);

  for (let i = 0; i < state.proposals.length; i++) {
    renderProposal(i, list);
  }
}

function renderProposal(idx: number, container: HTMLElement) {
  const p = state.proposals[idx]!;

  const block = el('div', { class: 'proposal-block' });

  // Show the eliciting question and context window, dimmed — lineage, not corpus
  if (p.question || p.context) {
    const prov = el('div', { class: 'proposal-provenance' });
    if (p.question) {
      const q = el('div', { class: 'proposal-question' });
      q.textContent = '\u2191 ' + p.question;  // up-arrow: "this asked"
      prov.append(q);
    }
    if (p.context) {
      const ctx = el('div', { class: 'proposal-context' });
      // Show context then the cut's boundary marked with a hairline
      ctx.textContent = p.context + ' \u2500';  // em-dash marks boundary
      prov.append(ctx);
    }
    block.append(prov);
  }

  const textWrapper = el('div', { class: 'proposal-text' });
  textWrapper.textContent = p.text;

  const reading = el('span', { class: 'proposal-reading' });
  reading.innerHTML = `<strong>${p.facet}</strong> &middot; ${p.stance}<br>${p.reading}`;
  textWrapper.append(reading);

  const actions = el('div', { class: 'proposal-actions' });

  const approveBtn = el('button', { class: 'proposal-action' }, 'approve');
  const trimBtn = el('button', { class: 'proposal-action' }, 'trim');
  const discardBtn = el(
    'button',
    { class: 'proposal-action discard' },
    'discard',
  );
  const restateBtn = el('button', { class: 'proposal-action' }, 'restate');

  actions.append(approveBtn, trimBtn, discardBtn, restateBtn);

  let editorActive = false;
  let editorEl: HTMLTextAreaElement | null = null;
  let confirmEl: HTMLButtonElement | null = null;

  function clearEditor() {
    if (editorEl) {
      editorEl.remove();
      editorEl = null;
    }
    if (confirmEl) {
      confirmEl.remove();
      confirmEl = null;
    }
    editorActive = false;
  }

  function setDecision(action: HarvestDecision['action'], text?: string) {
    state.decisions = state.decisions.filter((d) => d.proposal !== idx);
    const d: HarvestDecision = { proposal: idx, action };
    if (text !== undefined) d.text = text;
    state.decisions.push(d);
    const all = [approveBtn, trimBtn, discardBtn, restateBtn];
    for (const b of all) b.style.opacity = '0.4';
    const active =
      action === 'approve'
        ? approveBtn
        : action === 'trim'
          ? trimBtn
          : action === 'discard'
            ? discardBtn
            : restateBtn;
    active.style.opacity = '1';
    active.style.fontWeight = '500';
  }

  approveBtn.addEventListener('click', () => {
    clearEditor();
    setDecision('approve');
  });

  trimBtn.addEventListener('click', () => {
    if (editorActive) {
      clearEditor();
      const has = state.decisions.some((d) => d.proposal === idx);
      if (!has) resetButtons();
      return;
    }
    clearEditor();
    editorActive = true;
    editorEl = el('textarea', { class: 'trim-editor' }, p.text) as HTMLTextAreaElement;
    confirmEl = el(
      'button',
      { class: 'proposal-action', style: 'margin-top: 0.3rem' },
      'confirm trim',
    );
    block.append(editorEl, confirmEl);
    editorEl.focus();
    editorEl.style.height = 'auto';
    editorEl.style.height = editorEl.scrollHeight + 'px';
    editorEl.addEventListener('input', () => {
      editorEl!.style.height = 'auto';
      editorEl!.style.height = editorEl!.scrollHeight + 'px';
    });
    confirmEl.addEventListener('click', () => {
      const v = editorEl!.value;
      if (!p.text.includes(v) && v !== p.text) {
        editorEl!.value = p.text;
        return;
      }
      setDecision('trim', v);
      clearEditor();
    });
  });

  discardBtn.addEventListener('click', () => {
    clearEditor();
    setDecision('discard');
  });

  restateBtn.addEventListener('click', () => {
    if (editorActive) {
      clearEditor();
      const has = state.decisions.some((d) => d.proposal === idx);
      if (!has) resetButtons();
      return;
    }
    clearEditor();
    editorActive = true;
    editorEl = el('textarea', {
      class: 'restate-editor',
      placeholder: 'say it in your own words\u2026',
    }) as HTMLTextAreaElement;
    confirmEl = el(
      'button',
      { class: 'confirm-restate' },
      'confirm',
    );
    block.append(editorEl, confirmEl);
    editorEl.focus();
    confirmEl.addEventListener('click', () => {
      const v = editorEl!.value.trim();
      if (!v) return;
      setDecision('restate', v);
      clearEditor();
    });
  });

  function resetButtons() {
    for (const b of [approveBtn, trimBtn, discardBtn, restateBtn]) {
      b.style.opacity = '';
      b.style.fontWeight = '';
    }
  }

  block.append(textWrapper, actions);
  container.append(block);
}

/* ── Done screen ── */

function renderDone() {
  clear();
  state.screen = 'done';
  const div = el('div', { class: 'screen active' });
  const msg = el(
    'p',
    { class: 'done-message' },
    'your answers are saved.',
  );
  const backBtn = el('button', { class: 'submit-btn', style: 'margin-top: 1rem' }, 'back');
  backBtn.addEventListener('click', () => navTo('mode'));
  div.append(msg, backBtn);
  main.append(div);
}

/* ── Waiting surface ── */

function renderWaiting() {
  clear();
  state.screen = 'waiting';

  const div = el('div', { class: 'screen active waiting-surface' });

  // Back link
  const backRow = el('div', { class: 'waiting-nav' });
  const backBtn = el('button', { class: 'nav-link' }, '\u2190 back');
  backBtn.addEventListener('click', () => navTo('mode'));
  backRow.append(backBtn);
  div.append(backRow);

  // Expedition section — entries with horizon 'days' waiting to go out
  const expSection = el('div', { class: 'waiting-section expedition-section' });
  const expHeading = el('h2', { class: 'waiting-heading' }, 'out in the world');
  const expList = el('div', { class: 'expedition-list' });
  expSection.append(expHeading, expList);

  // Queue section — entries with horizon 'session' waiting to be drawn
  const queueSection = el('div', { class: 'waiting-section' });
  const queueHeading = el('h2', { class: 'waiting-heading' }, 'open questions');
  const queueList = el('div', { class: 'queue-list' });
  queueSection.append(queueHeading, queueList);

  // Activity section
  const activitySection = el('div', { class: 'waiting-section' });
  const activityHeading = el('h2', { class: 'waiting-heading' }, 'activity');
  const activityList = el('div', { class: 'activity-list' });
  activitySection.append(activityHeading, activityList);

  // No initial events yet — show a quiet empty message until the SSE
  // snapshot arrives (removed below when real events show up).
  let emptyMsg: HTMLParagraphElement | null = el('p', { class: 'empty-msg' }, 'nothing yet');
  activityList.append(emptyMsg);

  function syncEmptyActivity() {
    const hasLines = activityList.querySelector('.activity-line') !== null;
    if (hasLines && emptyMsg) {
      emptyMsg.remove();
      emptyMsg = null;
    } else if (activityList.children.length === 0) {
      emptyMsg = el('p', { class: 'empty-msg' }, 'nothing yet');
      activityList.append(emptyMsg);
    }
  }

  // Cadence — one sentence, at the top, above the sections (ticket 056).
  // The document rule: a line of text on a page, not a widget. It carries no
  // control, no colour and no comparison; a long gap reads exactly like a
  // short one, because dormancy is signal and never debt (Q-24). The wording
  // is composed server-side so it is testable — see src/log/cadence.ts.
  const cadenceLine = el('p', { class: 'cadence-line' }, '');
  api<{ sentence: string }>('/api/cadence')
    .then((r) => { cadenceLine.textContent = r.sentence; })
    .catch(() => { /* the record is not load-bearing; a failed read shows nothing */ });

  // Append in order: cadence, expeditions, questions, activity
  // Activity appended last so the layout flows correctly
  div.append(backRow, cadenceLine, expSection, queueSection, activitySection);
  main.append(div);

  // Age helper: compact relative-time display (e.g. "2d ago", "just now")
  function ageString(created: string): string {
    const ms = Date.now() - new Date(created).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Load queue
  (async () => {
    const wait = beginWait(queueList, 'looking…', 400);
    try {
      const data = await api<QueueData>('/api/queue');
      wait.done();
      queueList.innerHTML = '';
      expList.innerHTML = '';

      const expeditions = data.open.filter((e) => e.horizon === 'days');
      const pending = data.open.filter((e) => e.horizon !== 'days');

      if (expeditions.length > 0) {
        for (const entry of expeditions) {
          const row = el('div', { class: 'expedition-entry' });
          const question = el('span', { class: 'expedition-question' }, entry.question);
          const age = el('span', { class: 'expedition-age' }, ageString(entry.created));
          row.append(question, age);
          expList.append(row);
        }
      }

      if (pending.length === 0) {
        queueList.append(el('p', { class: 'empty-msg' }, 'nothing waiting'));
      } else {
        for (const entry of pending) {
          const row = el('div', { class: 'queue-entry' });
          const question = el('span', { class: 'queue-question' }, entry.question);
          // Where the question came from, in words. No queue `source` literal
          // reaches the DOM \u2014 `contradiction-remeasure` announcing itself as a
          // re-measure is the verification Q-15 forbids.
          const meta = el('span', { class: 'queue-meta' }, `${sourceLabel(entry.source)} \u00b7 ${entry.horizon}`);
          row.append(question, meta);
          queueList.append(row);
        }
      }
    } catch (e) {
      wait.done();
      queueList.innerHTML = '';
      queueList.append(el('p', { class: 'empty-msg' }, 'could not load what is waiting'));
      console.error(e);
    }
  })();

  // Connect activity SSE
  (async () => {
    try {
      const resp = await fetch('/api/activity', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      if (!resp.body) return;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let currentData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line.startsWith(': heartbeat')) {
            // Historical batch flushed — settle the empty state.
            syncEmptyActivity();
          } else if (line === '' && currentData) {
            try {
              const ev: ActivityEvent = JSON.parse(currentData);
              const lineEl = el('div', { class: 'activity-line' });
              const actor = el('span', { class: 'activity-actor' }, ev.actor);
              const detail = el('span', { class: 'activity-detail' }, formatEvent(ev));
              lineEl.append(actor, ' ', detail);
              const age = relativeTime(ev.at);
              if (age) lineEl.append(' ', el('span', { class: 'activity-age' }, age));
              activityList.prepend(lineEl);
              syncEmptyActivity();
            } catch { /* skip malformed */ }
            currentData = '';
          }
        }
      }
    } catch { /* SSE connection failed silently */ }
  })();
}

/* ── The wiki: a reading surface ──
 *
 * A page of prose, not a list of claim cards (docs/interface-references.md).
 * Three rules govern everything below and each one is load-bearing:
 *
 * 1. **No status word ever reaches the DOM.** `unconfirmed`, `evidenced`,
 *    `user-attested` and `contested` are carried by ink alone. A claim whose
 *    evidence is contested is a fact about evidence, not a verdict on the
 *    person; printing the word turns the page into an accusation (Q-15). The
 *    ink scale runs one way — from the Clerk's own sentence in light ink to
 *    the person's quoted words in the darkest — so darkness reads as "more of
 *    your own words stand under this", and a page entirely in light ink reads
 *    as early evidence rather than as failure (Q-21, Q-27).
 * 2. **No verbs, no buttons on a claim.** The only two controls are a back
 *    link and one sentence at the foot that widens the reading.
 * 3. **No numbers.** No counts, no confidence, no progress (Q-21, Q-24).
 */

const WIKI_OPENING =
  'What the Clerk has made of your words so far. Every sentence here is the ' +
  'Clerk’s; the quotations beneath are yours. Ink darkens as more of your ' +
  'own words come to stand under a sentence — a page in light ink has only begun.';

const WIKI_EMPTY =
  'There is nothing on this page yet. The Clerk writes a sentence only where ' +
  'your own words can stand under it.';

/* ── The read-log (Q-21) ──
 *
 * DECISION: a read is recorded on DWELL, not on scroll-into-view and not on a
 * focus interaction.
 *
 * The read-log is what later discounts a claim's evidence: a snippet
 * volunteered after the person read the claim it supports carries less weight.
 * So a read recorded that the person did not perform makes their real evidence
 * count for less — over-recording is not the conservative direction, it is the
 * destructive one. Scroll-into-view over-records by construction: a flick past
 * a section logs every claim in it.
 *
 * Focus under-records to nothing. This surface has no verbs by contract, so
 * nothing on it can take focus; a focus rule would ship an instrument that
 * never fires.
 *
 * Dwell is the measurement that matches the event. The claim must hold half
 * the reader's view, without interruption, for long enough to have been read,
 * in a tab that is actually on screen. A fast scroll records nothing; sitting
 * with a sentence records once. Once per claim per page load: the log answers
 * "had they seen this before they wrote that", and a second entry adds no
 * answer.
 */
const READ_DWELL_MS = 2500;
/** Claims already logged this page load. Reset by a full reload, not by navigation. */
const readsRecorded = new Set<string>();

let readWatcher: IntersectionObserver | null = null;
let readTimers: Map<Element, ReturnType<typeof setTimeout>> | null = null;
let readVisibilityHandler: (() => void) | null = null;

function releaseReadWatch() {
  readWatcher?.disconnect();
  readWatcher = null;
  if (readTimers) {
    for (const t of readTimers.values()) clearTimeout(t);
    readTimers = null;
  }
  if (readVisibilityHandler) {
    document.removeEventListener('visibilitychange', readVisibilityHandler);
    readVisibilityHandler = null;
  }
}

function recordRead(id: string) {
  if (readsRecorded.has(id)) return;
  readsRecorded.add(id);
  // Fire and forget. This is a record of a reading, never an edit, and a
  // failed record must not put anything on a page the person is reading.
  api(`/api/wiki/claim/${encodeURIComponent(id)}/read`, { surface: 'wiki' })
    .catch((e: unknown) => { console.error(e); });
}

/** Watch every `[data-claim]` under `root` and log a read after the dwell. */
function watchReads(root: HTMLElement) {
  releaseReadWatch();
  const blocks = root.querySelectorAll<HTMLElement>('[data-claim]');
  if (blocks.length === 0) return;
  if (typeof IntersectionObserver === 'undefined') return;

  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  readTimers = timers;

  function cancel(target: Element) {
    const t = timers.get(target);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(target);
    }
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      const id = target.dataset.claim;
      if (!id) continue;

      // Half the block, or half the view for a block taller than the view —
      // a long quotation must not become unreadable-by-definition.
      const viewHeight = entry.rootBounds?.height ?? window.innerHeight;
      const held =
        entry.isIntersecting &&
        (entry.intersectionRatio >= 0.5 ||
          entry.intersectionRect.height >= viewHeight * 0.5);

      if (!held || document.hidden) {
        cancel(target);
        continue;
      }
      if (timers.has(target)) continue;
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        observer.unobserve(target);
        recordRead(id);
      }, READ_DWELL_MS));
    }
  }, { threshold: [0, 0.5, 1] });

  for (const block of blocks) observer.observe(block);
  readWatcher = observer;

  // A claim left on screen behind another window was not read. The observer
  // sees no intersection change when the tab hides, so the tab has to say so.
  readVisibilityHandler = () => {
    if (!document.hidden) return;
    for (const target of [...timers.keys()]) cancel(target);
  };
  document.addEventListener('visibilitychange', readVisibilityHandler);
}

/* ── Typesetting helpers ── */

/**
 * The claim as one sentence with its Range as an em-dash clause inside it
 * (the document rule), rather than as a second line of metadata. A trailing
 * full stop moves to the end so the clause reads as a clause.
 */
function claimSentence(body: string, range: string): string {
  const r = range.trim();
  if (!r) return body;
  const stripped = body.trim().replace(/[.]+$/, '');
  return `${stripped} — ${r}.`;
}

/** A date a person reads, from an ISO stamp. */
function readableDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A quotation in the person's own ink, dated. The cite IS the quote (Q-27). */
function quoteBlock(prose: string, iso?: string): HTMLElement {
  const q = el('blockquote', { class: 'claim-quote' }, prose);
  const when = iso ? readableDate(iso) : '';
  if (when) q.append(el('span', { class: 'claim-quote-date' }, when));
  return q;
}

/** A dimmed marginal remark. Never carries an id — `subject` stays unprinted. */
function marginNote(text: string): HTMLElement {
  return el('p', { class: 'wiki-note' }, text);
}

/**
 * Which ink a claim takes. The one place a `ClaimStatus` is read.
 *
 * The names on the right are the INK's names, not the status's. A status word
 * does not reach the DOM even as an attribute value: `contested` sitting in
 * the markup is one view-source away from being the verdict Q-15 forbids, and
 * the ink is what the reader is actually being told about anyway.
 */
function claimInk(cl: Claim): string {
  if (cl.archived === true || cl.supersededBy !== undefined) return 'aside';
  switch (cl.status) {
    case 'user-attested': return 'yours';
    case 'evidenced': return 'standing';
    case 'contested': return 'facing';
    default: return 'opening';
  }
}

/* ── Render ── */

function renderWiki(all = false) {
  clear();
  state.screen = 'wiki';

  const div = el('div', { class: 'screen active wiki-surface' });

  const nav = el('div', { class: 'wiki-nav' });
  const backBtn = el('button', { class: 'nav-link' }, '← back');
  backBtn.addEventListener('click', () => navTo('mode'));
  nav.append(backBtn);

  const page = el('div', { class: 'wiki-page' });
  div.append(nav, page);
  main.append(div);

  (async () => {
    const wait = beginWait(page, 'reading…', 400);
    try {
      const [wiki, snippets] = await Promise.all([
        api<WikiResponse>(all ? '/api/wiki?all=1' : '/api/wiki'),
        // The quotes. A failure here costs the page its evidence but not its
        // prose, so it degrades rather than throws.
        api<{ snippets: Snippet[] }>('/api/snippets').catch(() => ({ snippets: [] as Snippet[] })),
      ]);
      wait.done();
      paintWiki(page, wiki, snippets.snippets);
      watchReads(page);
    } catch (e) {
      wait.failed(e, 'the page did not come through — try again');
    }
  })();
}

function paintWiki(page: HTMLElement, wiki: WikiResponse, snippets: Snippet[]) {
  page.innerHTML = '';

  const byId = new Map<string, Snippet>();
  for (const s of snippets) byId.set(s.id, s);

  // Lint notes, filed by what they are about. `subject` itself never renders.
  const notesByClaim = new Map<string, string[]>();
  const notesByFacet = new Map<string, string[]>();
  const looseNotes: string[] = [];
  const claimIds = new Set<string>();
  for (const group of wiki.facets) for (const cl of group.claims) claimIds.add(cl.id);
  for (const note of wiki.lint) {
    if (claimIds.has(note.subject)) {
      const list = notesByClaim.get(note.subject);
      if (list) list.push(note.note);
      else notesByClaim.set(note.subject, [note.note]);
    } else if (wiki.facets.some((g) => g.facet === note.subject)) {
      const list = notesByFacet.get(note.subject);
      if (list) list.push(note.note);
      else notesByFacet.set(note.subject, [note.note]);
    } else {
      looseNotes.push(note.note);
    }
  }

  const hasClaims = wiki.facets.some((g) => g.claims.length > 0);

  page.append(el('p', { class: 'wiki-opening' }, hasClaims ? WIKI_OPENING : WIKI_EMPTY));

  // Eval finding #8: "has not been read" and "was read, nothing to remark"
  // are different states and must not render alike.
  page.append(el('p', { class: 'wiki-state' }, clerkStateSentence(wiki)));

  for (const group of wiki.facets) {
    if (group.claims.length === 0) continue;
    const section = el('section', { class: 'wiki-facet' });
    section.append(el('h2', { class: 'wiki-heading' }, group.heading));
    for (const note of notesByFacet.get(group.facet) ?? []) section.append(marginNote(note));

    // Already ordered by coreness within the facet. Not re-sorted here.
    for (const cl of group.claims) {
      const block = el('article', { class: 'wiki-claim' });
      block.dataset.claim = cl.id;
      block.dataset.ink = claimInk(cl);

      block.append(el('p', { class: 'claim-sentence' }, claimSentence(cl.body, cl.range)));
      for (const note of notesByClaim.get(cl.id) ?? []) block.append(marginNote(note));

      for (const cite of cl.cites) {
        // "snippetId@version". The index holds the newest version of each
        // snippet, so the quote and its date are always the same words — this
        // never dates old words with a new day. That a cite has since been
        // written again is the Clerk's remark to make, and it makes it in the
        // margin above when it has read the page.
        const snippetId = cite.split('@')[0] ?? '';
        const s = byId.get(snippetId);
        if (s) block.append(quoteBlock(s.prose, s.captured));
      }
      section.append(block);
    }
    page.append(section);
  }

  if (wiki.contradictions.length > 0) {
    const section = el('section', { class: 'wiki-facet' });
    section.append(el('h2', { class: 'wiki-heading' }, 'Two things held at once'));
    for (const x of wiki.contradictions) {
      const exhibit = el('div', { class: 'wiki-exhibit' });
      exhibit.dataset.ink = x.status === 'dissolved' ? 'aside' : 'facing';
      // The body is written as the two poles and then the verified quote,
      // separated by blank lines (src/clerk/wiki-jobs.ts#juxtaposition). Set
      // as an exhibit: facing sentences, then the person's own words.
      for (const chunk of x.body.split(/\n\s*\n/)) {
        const text = chunk.trim();
        if (!text) continue;
        if (text.startsWith('>')) exhibit.append(quoteBlock(text.replace(/^>\s*/, '')));
        else exhibit.append(el('p', { class: 'exhibit-pole' }, text));
      }
      section.append(exhibit);
    }
    page.append(section);
  }

  const foot = el('div', { class: 'wiki-foot' });
  for (const note of looseNotes) foot.append(marginNote(note));

  // The one control on the page, and it is a sentence: what is on screen, and
  // the words that widen it. Set-aside claims arrive in the lightest ink, and
  // this sentence is where that ink is named.
  const lens = el('p', { class: 'wiki-lens' });
  const toggle = el('button', { class: 'nav-link' },
    wiki.all ? 'read only what stands' : 'read what has been set aside as well');
  toggle.addEventListener('click', () => renderWiki(!wiki.all));
  lens.append(
    document.createTextNode(wiki.all
      ? 'This is the whole record, what has been set aside included. Or '
      : 'This is what stands today. Or '),
    toggle,
    document.createTextNode('.'),
  );
  foot.append(lens);
  page.append(foot);
}

/**
 * Where the Clerk stands with this page. Three states, and the first is NOT
 * the second: a Clerk that has not read the wiki has found nothing because it
 * has not looked, and saying "no remarks" for it would report silence as a
 * clean bill (eval finding #8).
 */
function clerkStateSentence(wiki: WikiResponse): string {
  if (wiki.lintedAt === null) return 'The Clerk has not read this page yet.';
  const when = relativeTime(wiki.lintedAt);
  const read = when ? `The Clerk read this page ${when}` : 'The Clerk has read this page';
  if (wiki.lint.length === 0) return `${read} and left no remarks.`;
  return `${read}. Its remarks sit beside the sentences they are about.`;
}

/* ─── Bootstrap ─── */

(async () => {
  // First paint waits on two calls. If they are quick the page just appears;
  // if they are not, the page says it is starting rather than sitting blank.
  const wait = beginWait(main, 'starting…', 400);
  try {
    // Check if password needs to be set (no auth file; we are on loopback)
    let needsSetup = false;
    try {
      const resp = await fetch('/api/auth/status');
      if (resp.ok) {
        const status = await resp.json() as { needsSetup: boolean };
        needsSetup = status.needsSetup;
      }
    } catch { /* server may return HTML on non-loopback */ }

    if (needsSetup) {
      renderMode(true);
      return;
    }

    // Auth file exists — check if we have a valid session
    try {
      await api<QueueData>('/api/queue');
      renderMode(false);
    } catch {
      renderLogin();
    }
  } finally {
    wait.done();
  }
})();
