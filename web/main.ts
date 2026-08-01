import type {
  CutProposal,
  HarvestDecision,
  Mode,
  QuestionForm,
} from '../src/types.ts';

/* ─── API types ─── */

interface SessionResponse {
  sessionId: string;
  question: string;
}

type TurnResponse =
  | { kind: 'probe'; text: string; questionForm: QuestionForm }
  | { kind: 'saturated'; proposals: CutProposal[] };

interface EndResponse {
  proposals: CutProposal[];
}

interface HarvestResponse {
  snippets: unknown[];
  buds: unknown[];
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

type Screen = 'mode' | 'exchange' | 'harvest' | 'done';

interface AppState {
  screen: Screen;
  sessionId: string | null;
  question: string | null;
  proposals: CutProposal[];
  decisions: HarvestDecision[];
}

const state: AppState = {
  screen: 'mode',
  sessionId: null,
  question: null,
  proposals: [],
  decisions: [],
};

const main = $('main')!;

/* ─── API ─── */

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: body !== undefined ? 'POST' : 'GET' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as T;
}

/* ─── Render ─── */

function clear() {
  main.innerHTML = '';
}

function showError(msg: string) {
  const err = el('p', { class: 'error-msg' }, msg);
  main.append(err);
}

/* ── Mode screen ── */

function renderMode() {
  clear();
  state.screen = 'mode';

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

  const topicInput = el('input', {
    class: 'topic-input',
    type: 'text',
    placeholder: 'what would you like to talk about? (optional)',
  });

  const submit = el('button', { class: 'submit-btn' }, 'begin');
  const errorSlot = el('div', { class: 'error-slot' });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    errorSlot.innerHTML = '';
    try {
      const mode: Mode = {
        minutes: Number(minSelect.value),
        energy: enSelect.value as Mode['energy'],
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

  div.append(minutesRow, energyRow, topicInput, submit, errorSlot);
  main.append(div);
}

/* ── Exchange screen ── */

let exchangeTurnCount = 0;

function renderExchange() {
  clear();
  state.screen = 'exchange';
  exchangeTurnCount = 0;

  const div = el('div', { class: 'screen active' });

  const header = el('div', { class: 'exchange-header' });
  const questionBlock = el('div', { class: 'question-block' }, state.question!);
  header.append(questionBlock);

  const transcript = el('div', { class: 'transcript' });

  const answerArea = el('div', { class: 'answer-area' });
  const textarea = el('textarea', {
    class: 'answer-textarea',
    placeholder: '…',
    rows: '2',
  });
  const harvestBtn = el('button', { class: 'harvest-now' }, 'harvest now');

  answerArea.append(textarea, harvestBtn);

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

    // append user turn to transcript
    appendTurn('user', text);

    try {
      const res = await api<TurnResponse>(
        `/api/session/${state.sessionId}/turn`,
        { text },
      );

      if (res.kind === 'probe') {
        appendTurn('agent', res.text);
        state.question = res.text;
        questionBlock.textContent = res.text;
      } else {
        // saturated
        state.proposals = res.proposals;
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
    textarea.focus();
    // scroll to textarea
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

  // initial focus + typewriter position
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

  const heading = el(
    'div',
    { class: 'question-block' },
    'review what you said',
  );
  div.append(heading);

  const list = el('div', { class: 'harvest-list' });
  div.append(list);

  const submitRow = el('div', { style: 'margin-top: 1.5rem' });
  const submitBtn = el('button', { class: 'submit-btn' }, 'save');
  submitRow.append(submitBtn);
  div.append(submitRow);

  const errorSlot = el('div', { class: 'error-slot' });
  div.append(errorSlot);

  main.append(div);

  // render each proposal
  for (let i = 0; i < state.proposals.length; i++) {
    renderProposal(i, list);
  }

  submitBtn.addEventListener('click', async () => {
    // verify all proposals have a decision
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

  // trim state: editor or restate area (mutually exclusive)
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
    // remove prior decision for this proposal
    state.decisions = state.decisions.filter((d) => d.proposal !== idx);
    const d: HarvestDecision = { proposal: idx, action };
    if (text !== undefined) d.text = text;
    state.decisions.push(d);
    // update button states
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
      // re-enable if no decision
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
    // auto-grow
    editorEl.style.height = 'auto';
    editorEl.style.height = editorEl.scrollHeight + 'px';
    editorEl.addEventListener('input', () => {
      editorEl!.style.height = 'auto';
      editorEl!.style.height = editorEl!.scrollHeight + 'px';
    });
    confirmEl.addEventListener('click', () => {
      const v = editorEl!.value;
      // client-side substring check
      if (!p.text.includes(v) && v !== p.text) {
        // reject: restore original
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
      placeholder: 'say it in your own words…',
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
  div.append(
    el(
      'p',
      { class: 'done-message' },
      'your answers are saved. close this tab when you are ready.',
    ),
  );
  main.append(div);
}

/* ─── Bootstrap ─── */

renderMode();
