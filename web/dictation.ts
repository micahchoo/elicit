/**
 * The shared dictation surface: the mic toggle and the long-press spacebar,
 * wired onto any writing surface (unprompted, exchange, DRM, piece). The mic
 * stream is module state, so a surface re-paint or a navigation never strands
 * a live recording behind a stale closure.
 *
 * Injection, not import: `api`, `showQuietError` and the STT-availability
 * state are main.ts module-private (the import-review pattern). The STT
 * status read is the one JSON call; the transcribe POST rides the shared
 * api() with a rawBody (Float32Array buffer, never JSON-encoded), so the
 * one 401 land-on-login rule has one home — web/client.ts (the F5 debt
 * closure, wave C).
 */

import { ApiError } from './deps.js';
import type { WebDepsCore } from './deps.js';

/** The dictation surface's deps: the STT status read, the raw transcribe
 *  POST, and the shared STT-availability state. */
export interface DictationDeps {
 /** The shared HTTP verb — the STT status read, and the raw transcribe
  *  POST riding api()'s rawBody (Float32Array buffer, never JSON-encoded),
  *  401 land-on-login included (web/client.ts, the one home of that rule). */
 api: WebDepsCore['api'];
 showQuietError: (container: HTMLElement, message: string) => void;
 /** The STT-availability state, shared with the exchange surface. */
 sttAvailable: () => boolean;
 setSttAvailable: (available: boolean) => void;
 /** The long-press timer's home — the seam keeps window out of the module. */
 window: Window;
}

/** One writing surface's dictation wiring: the mic toggle and its status,
 *  the error slot for the quiet failure lines, and the speech hook. */
export interface DictationOpts {
 textarea: HTMLTextAreaElement;
 micBtn: HTMLButtonElement;
 micStatus: HTMLSpanElement;
 errorSlot: HTMLElement;
 onSpeech?: () => void;
}

// ── STT recording ──

let _micStream: MediaStream | null = null;
let _audioCtx: AudioContext | null = null;
let _workletNode: AudioWorkletNode | null = null;
let _samples: Float32Array[] = [];
/** One recording at a time, shared across every writing surface: the mic
 * stream is module state, so a surface re-paint or a navigation never
 * strands a live recording behind a stale closure. */
let dictationActive = false;
let dictationBusy = false;

export async function startRecording(): Promise<void> {
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

export async function stopAndTranscribe(deps: DictationDeps): Promise<string> {
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

 // POST raw Float32 to server — through the shared api() (rawBody: sent
// as-is, never JSON-encoded), so the one 401 land-on-login rule has one
// home (web/client.ts) and a handled failure skips the quiet line.
 const data = await deps.api<{ text: string }>(
  '/api/transcribe?rate=16000',
  undefined,
  { method: 'POST', rawBody: combined.buffer },
 );
 return data.text;
}

/* ── Shared dictation wiring ── */

/**
 * How long a spacebar hold must last before it counts as a long press.
 * A tap releases well before this; the OS key-repeat delay is typically
 * longer, so a held key never types repeated spaces either way.
 */
const LONG_PRESS_MS = 400;

/**
 * Wire dictation onto one writing surface: the mic button and a long
 * press on the spacebar both toggle recording, and the transcript lands
 * at the cursor. The spacebar press is intercepted so a hold never types
 * spaces — a release before the deadline inserts the one space the press
 * owed, and a hold past it spends the press on the toggle instead.
 */
export function wireDictation(deps: DictationDeps, opts: DictationOpts) {
 const { textarea, micBtn, micStatus, errorSlot } = opts;

 // A re-painted surface picks up a recording that is already live.
 if (dictationActive) {
  micBtn.classList.add('active');
  micStatus.textContent = 'listening\u2026';
 }

 const insertAtCursor = (text: string) => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start ?? textarea.value.length);
  const after = textarea.value.slice(end ?? textarea.value.length);
  textarea.value = before + text + after;
  textarea.dispatchEvent(new Event('input'));
  const pos = (start ?? textarea.value.length) + text.length;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
 };

 const toggle = async () => {
  if (dictationBusy) return;
  if (!dictationActive) {
   // Start recording
   try {
    await startRecording();
    dictationActive = true;
    micBtn.classList.add('active');
    micStatus.textContent = 'listening\u2026';
   } catch (e) {
    console.error(e);
    deps.showQuietError(errorSlot, 'the microphone did not open — check permission');
   }
  } else {
   // Stop and transcribe
   dictationActive = false;
   dictationBusy = true;
   micBtn.classList.remove('active');
   micBtn.disabled = true;
   micStatus.textContent = 'transcribing\u2026';
   try {
    const text = await stopAndTranscribe(deps);
    if (text) {
     opts.onSpeech?.();
     insertAtCursor(text);
    }
   } catch (e) {
    console.error(e);
    // A handled failure (the 401 land-on-login) already navigated; leave
    // without adding a quiet line to the page it replaced.
    if (!(e instanceof ApiError && e.handled)) {
     deps.showQuietError(errorSlot, 'that did not come through — say it again');
    }
   }
   dictationBusy = false;
   micBtn.disabled = false;
   micStatus.textContent = '';
  }
 };

 micBtn.addEventListener('click', () => void toggle());

 // Long-press spacebar: every space keydown is prevented, so holding the
 // key never auto-repeats; the space is inserted by hand on keyup unless
 // the hold outlived LONG_PRESS_MS, which spends the press on the toggle.
 let pressTimer: number | null = null;
 let pressConsumed = false;
 let spaceDown = false;

 textarea.addEventListener('keydown', (e) => {
  if (e.key !== ' ') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // let shortcuts through
  e.preventDefault();
  if (e.repeat) return;
  spaceDown = true;
  pressConsumed = false;
  pressTimer = deps.window.setTimeout(() => {
   pressTimer = null;
   if (!spaceDown) return;
   pressConsumed = true;
   void toggle();
  }, LONG_PRESS_MS);
 });

 const endPress = (insertSpace: boolean) => {
  const consumed = pressConsumed;
  spaceDown = false;
  if (pressTimer !== null) {
   clearTimeout(pressTimer);
   pressTimer = null;
  }
  pressConsumed = false;
  if (insertSpace && !consumed) insertAtCursor(' ');
 };

 textarea.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  endPress(true);
 });

 textarea.addEventListener('blur', () => {
  // A press that leaves the field mid-hold still owes its space.
  endPress(true);
 });

 // Check STT availability and hide the toggle if unavailable.
 (async () => {
  try {
   const status = await deps.api<{ available: boolean }>('/api/stt/status');
   deps.setSttAvailable(status.available);
  } catch {
   deps.setSttAvailable(false);
  }
  if (!deps.sttAvailable()) {
   micBtn.style.display = 'none';
   micStatus.style.display = 'none';
  }
 })();
}
