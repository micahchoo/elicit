import type {
  CutProposal,
  HarvestDecision,
  Mode,
  QuestionForm,
  Target,
  QueueEntry,
} from '../src/types.ts';
import { formatEvent, relativeTime } from '../src/log/format.js';

/* ─── API types ─── */

interface SessionResponse {
  sessionId: string;
  question: string;
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

type Screen = 'mode' | 'exchange' | 'harvest' | 'done' | 'waiting' | 'login' | 'setup' | 'unprompted';

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
    case 'unprompted': renderUnprompted(); break;
    case 'login': renderLogin(); break;
    case 'setup': renderSetup(); break;
  }
}


async function api<T>(path: string, body?: unknown): Promise<T> {
  const method = path.startsWith('/api/queue') || path.startsWith('/api/activity') || path.startsWith('/api/stt/status') ? 'GET' : 'POST';
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    if (res.status === 401) { navTo('login'); throw new Error('Unauthorized'); }
    if (res.status === 403) {
      try {
        const data = await res.json();
        if (data.error === 'setup required') {
          // Server wants setup from host machine — this client is remote
          showError('finish setup from the host machine');
          throw new Error('Setup required');
        }
      } catch { /* not JSON — fall through */ }
    }
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as T;
}

async function apiRaw(path: string): Promise<Response> {
  const res = await fetch(path, { method: 'GET' });
  if (!res.ok) {
    if (res.status === 401) { navTo('login'); throw new Error('Unauthorized'); }
    throw new Error(`${res.status}`);
  }
  return res;
}

/* ─── Render ─── */

function clear() {
  main.innerHTML = '';
}

function showError(msg: string) {
  const err = el('p', { class: 'error-msg' }, msg);
  main.append(err);
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
    try {
      await api('/api/login', { password: input.value });
      navTo('mode');
    } catch {
      errorSlot.innerHTML = '';
      errorSlot.append('wrong password');
      submit.disabled = false;
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
    try {
      await api('/api/setup', { password: pw });
      navTo('mode');
    } catch (e) {
      errorSlot.innerHTML = '';
      errorSlot.append(String(e));
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
  navRow.append(waitingLink, writeLink);

  if (showSetupHint) {
    const setupLink = el('button', { class: 'nav-link' }, 'set a password');
    setupLink.addEventListener('click', () => navTo('setup'));
    navRow.append(setupLink);
  }

  const submit = el('button', { class: 'submit-btn' }, 'begin');
  const errorSlot = el('div', { class: 'error-slot' });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    errorSlot.innerHTML = '';
    try {
      const mode: Mode = {
        minutes: Number(minSelect.value),
        energy: enSelect.value as Mode['energy'],
        target: tgtSelect.value as Target,
      };
      const t = topicInput.value.trim();
      if (t) mode.topic = t;

      const res = await api<SessionResponse>('/api/session', { mode });
      state.sessionId = res.sessionId;
      state.question = res.question;
      renderExchange();
    } catch (e) {
      errorSlot.innerHTML = '';
      errorSlot.append(String(e));
      submit.disabled = false;
    }
  });

  topicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  div.append(minutesRow, energyRow, targetRow, topicInput, navRow, submit, errorSlot);
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
    try {
      const res = await api<{ sessionId: string; proposals: CutProposal[] }>(
        '/api/unprompted',
        { text },
      );
      state.sessionId = res.sessionId;
      state.proposals = res.proposals;
      renderHarvest();
    } catch (e) {
      errorSlot.append(String(e));
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

    appendTurn('user', text);

    const body: Record<string, unknown> = { text };
    if (state.turnHadSpeech) body.spoken = true;

    try {
      const res = await api<TurnData>(
        `/api/session/${state.sessionId}/turn`,
        body,
      );

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
      showError(String(e));
    }

    textarea.value = '';
    textarea.style.height = 'auto';
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

  harvestBtn.addEventListener('click', async () => {
    try {
      const res = await api<EndResponse>(
        `/api/session/${state.sessionId}/end`,
      );
      state.proposals = res.proposals;
      renderHarvest();
    } catch (e) {
      showError(String(e));
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
    try {
      const res = await api<{ kind: string; text?: string }>(
        `/api/session/${state.sessionId}/skip`,
      );
      takeNextQuestion(res);
    } catch (e) {
      showError(String(e));
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
    try {
      const res = await api<{ kind: string; text?: string }>(
        `/api/session/${state.sessionId}/defer`,
        need ? { need } : undefined,
      );
      deferRow.classList.remove('active');
      takeNextQuestion(res);
    } catch (e) {
      showError(String(e));
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
        showError('microphone unavailable');
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
        showError(String(e));
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

  function appendTurn(role: 'agent' | 'user', text: string) {
    exchangeTurnCount++;
    const turn = el('div', { class: `turn ${role}` }, text);
    transcript.append(turn);
    turn.scrollIntoView({ block: 'nearest' });
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
      try {
        await api<HarvestResponse>(
          `/api/session/${state.sessionId}/harvest`,
          { decisions: state.decisions },
        );
        renderDone();
      } catch (e) {
        errorSlot.innerHTML = '';
        errorSlot.append(String(e));
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

  // Append in order: expeditions, questions, activity
  // Activity appended last so the layout flows correctly
  div.append(backRow, expSection, queueSection, activitySection);
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
    try {
      const data = await api<QueueData>('/api/queue');
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
          const meta = el('span', { class: 'queue-meta' }, `${entry.source} \u00b7 ${entry.horizon}`);
          row.append(question, meta);
          queueList.append(row);
        }
      }
    } catch {
      queueList.append(el('p', { class: 'empty-msg' }, 'could not load queue'));
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

/* ─── Bootstrap ─── */

(async () => {
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
})();
