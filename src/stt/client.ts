/**
 * Parent-side STT client. Spawns a child process running the sherpa-onnx
 * worker, sends audio over stdio, and returns transcriptions.
 *
 * Lazy spawn — the process starts on the first `transcribe()` or
 * `openStream()` call. `dispose()` hard-kills the child so the native
 * addon's destructor never runs in a shared address space
 * (sherpa-onnx-node's NAPI finalizer can segfault on shutdown).
 *
 * Streaming (redesign wave 4): `openStream()` opens a transcription
 * session whose id is correlated over the same stdio pipe. `pushAudio`
 * is fire-and-forget (the worker processes messages in order and answers
 * partials asynchronously); `end()` resolves when the final partial lands.
 * The one-shot `transcribe()` path is unchanged.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Outbound } from './protocol.js';
import { resolveModelDir } from './model.js';

// --- protocol: one shared contract (src/stt/protocol.ts) ---

/** Result of a transcription: transcript plus per-token timing from the worker. */
export interface SttTranscriptionResult {
 text: string;
 tokens: string[];
 timestamps: number[];
 durations: number[];
}

/** One streaming hypothesis: the cumulative text, final on stream-end. */
export interface SttStreamPartial {
 text: string;
 final: boolean;
}

/** A live streaming transcription session, correlated by `streamId`. */
export interface SttStream {
 streamId: string;
 /** Push one chunk of audio; fire-and-forget (partials arrive via onPartial). */
 pushAudio(samples: Float32Array, sampleRate: number): void;
 /** Finalize the stream; resolves with the final transcript. */
 end(): Promise<SttTranscriptionResult>;
 /** Subscribe to partial hypotheses. Returns an unsubscribe function. */
 onPartial(cb: (partial: SttStreamPartial) => void): () => void;
 /** Subscribe to stream-scoped failures. Returns an unsubscribe function. */
 onError(cb: (err: Error) => void): () => void;
}

interface Deferred<T> {
 resolve: (value: T) => void;
 reject: (err: Error) => void;
 promise: Promise<T>;
}

function deferred<T>(): Deferred<T> {
 let resolve!: (value: T) => void;
 let reject!: (err: Error) => void;
 const promise = new Promise<T>((res, rej) => {
  resolve = res;
  reject = rej;
 });
 return { resolve, reject, promise };
}


type WorkerMsg = Outbound;
// --- client ---

export interface SttClient {
 /**
  * Transcribe 16 kHz mono audio. Spawns the worker on first call.
  * Rejects on worker error or spawn failure.
  */
 transcribe(
  samples: Float32Array,
  sampleRate: number,
 ): Promise<SttTranscriptionResult>;

 /**
  * Open a streaming transcription session. Resolves once the worker has
  * loaded the recognizer and created the stream; rejects on worker error
  * or spawn failure. Absent on a client that does not support streaming.
  */
 openStream?(): Promise<SttStream>;

 /** Kill the worker process. Safe to call multiple times. */
 dispose(): void;
}

export interface SttClientOptions {
 /** Override the tsx path used to spawn the worker. */
 tsxPath?: string;
 /** Override the worker script path. */
 workerPath?: string;
}

interface StreamState {
 id: string;
 ready: Deferred<void>;
 pendingEnd: Deferred<SttTranscriptionResult> | null;
 partialCbs: Set<(partial: SttStreamPartial) => void>;
 errorCbs: Set<(err: Error) => void>;
}

export function createSttClient(opts?: SttClientOptions): SttClient {
 const tsxPath = opts?.tsxPath ?? 'npx';
 const workerPath = opts?.workerPath
  ?? new URL('./worker.ts', import.meta.url).pathname;

 // When using npx, prepend 'tsx' as the subcommand argument.
 const spawnCmd = tsxPath;
 const spawnArgs = tsxPath === 'npx' ? ['tsx', workerPath] : [workerPath];

 let child: ChildProcess | null = null;
 let nextId = 0;
 const pending = new Map<string, Deferred<SttTranscriptionResult>>();
 const streams = new Map<string, StreamState>();
 let leftover = '';

 function ensureSpawned(): ChildProcess {
  if (child && !child.killed) return child;

  const modelDir = resolveModelDir();

  child = spawn(spawnCmd, spawnArgs, {
   env: { ...process.env, ELICIT_STT_MODEL_DIR: modelDir },
   stdio: ['pipe', 'pipe', 'inherit'],
  });

  child.stdout!.on('data', (chunk: Buffer) => {
   leftover += chunk.toString('utf-8');
   const lines = leftover.split('\n');
   // The last element may be incomplete — keep it for the next chunk.
   leftover = lines.pop() ?? '';

   for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: WorkerMsg;
    try {
     msg = JSON.parse(trimmed) as WorkerMsg;
    } catch {
     // Malformed line — log and skip. The pending promise
     // will eventually be rejected by the 'exit' handler.
     console.error('[stt-client] invalid worker message:', trimmed);
     continue;
    }

    if (msg.type === 'stream-ready') {
     const st = streams.get(msg.id);
     if (st) st.ready.resolve();
     continue;
    }

    if (msg.type === 'partial') {
     const st = streams.get(msg.id);
     if (!st) continue;
     const partial: SttStreamPartial = { text: msg.text, final: msg.final === true };
     for (const cb of st.partialCbs) cb(partial);
     if (partial.final && st.pendingEnd) {
      st.pendingEnd.resolve({
       text: msg.text,
       tokens: [],
       timestamps: [],
       durations: [],
      });
      st.pendingEnd = null;
      streams.delete(msg.id);
     }
     continue;
    }

    if (msg.type === 'stream-error') {
     const st = streams.get(msg.id);
     if (!st) continue;
     const err = new Error(msg.error);
     st.ready.reject(err);
     for (const cb of st.errorCbs) cb(err);
     if (st.pendingEnd) {
      st.pendingEnd.reject(err);
      st.pendingEnd = null;
     }
     streams.delete(msg.id);
     continue;
    }

    const dfd = pending.get(msg.id);
    if (!dfd) continue;

    pending.delete(msg.id);

    if (msg.type === 'transcription') {
     dfd.resolve({
      text: msg.text,
      tokens: msg.tokens,
      timestamps: msg.timestamps,
      durations: msg.durations,
     });
    } else if (msg.type === 'error') {
     dfd.reject(new Error(msg.error));
    }
   }
  });

  child.on('exit', (code, signal) => {
   const reason = signal
    ? `worker killed by signal ${signal}`
    : `worker exited with code ${code}`;
   // Reject all outstanding one-shot promises.
   for (const [id, dfd] of pending) {
    dfd.reject(new Error(reason));
    pending.delete(id);
   }
   // Fail every live stream.
   for (const [id, st] of streams) {
    const err = new Error(reason);
    st.ready.reject(err);
    for (const cb of st.errorCbs) cb(err);
    if (st.pendingEnd) {
     st.pendingEnd.reject(err);
     st.pendingEnd = null;
    }
    streams.delete(id);
   }
   child = null;
  });

  child.on('error', (err) => {
   for (const [id, dfd] of pending) {
    dfd.reject(err);
    pending.delete(id);
   }
   for (const [id, st] of streams) {
    st.ready.reject(err);
    for (const cb of st.errorCbs) cb(err);
    if (st.pendingEnd) {
     st.pendingEnd.reject(err);
     st.pendingEnd = null;
    }
    streams.delete(id);
   }
   child = null;
  });

  return child;
 }

 function float32ToBase64(samples: Float32Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
 }

 function sendInbound(msg: string): void {
  const proc = ensureSpawned();
  proc.stdin!.write(`${msg}\n`);
 }

 return {
  async transcribe(
   samples: Float32Array,
   sampleRate: number,
  ): Promise<SttTranscriptionResult> {
   const id = String(nextId++);
   const dfd = deferred<SttTranscriptionResult>();
   pending.set(id, dfd);

   sendInbound(JSON.stringify({
    type: 'transcribe',
    id,
    samples: float32ToBase64(samples),
    sampleRate,
   }));

   return dfd.promise;
  },

  async openStream(): Promise<SttStream> {
   const id = `s-${nextId++}`;
   const ready = deferred<void>();
   const state: StreamState = {
    id,
    ready,
    pendingEnd: null,
    partialCbs: new Set(),
    errorCbs: new Set(),
   };
   streams.set(id, state);

   sendInbound(JSON.stringify({ type: 'stream-open', id }));

   await ready.promise;

   return {
    streamId: id,
    pushAudio(samples: Float32Array, sampleRate: number): void {
     sendInbound(JSON.stringify({
      type: 'audio',
      id,
      samples: float32ToBase64(samples),
      sampleRate,
     }));
    },
    end(): Promise<SttTranscriptionResult> {
     if (state.pendingEnd) return state.pendingEnd.promise;
     state.pendingEnd = deferred<SttTranscriptionResult>();
     sendInbound(JSON.stringify({ type: 'stream-end', id }));
     return state.pendingEnd.promise;
    },
    onPartial(cb: (partial: SttStreamPartial) => void): () => void {
     state.partialCbs.add(cb);
     return () => { state.partialCbs.delete(cb); };
    },
    onError(cb: (err: Error) => void): () => void {
     state.errorCbs.add(cb);
     return () => { state.errorCbs.delete(cb); };
    },
   };
  },

  dispose(): void {
   if (child && !child.killed) {
    // Try graceful shutdown first, then hard-kill.
    try {
     child.stdin!.write('{"type":"shutdown"}\n');
    } catch {
     // stdin may already be closed.
    }
    setTimeout(() => {
     if (child && !child.killed) {
      child.kill('SIGKILL');
     }
    }, 1000).unref();
   }
  },
 };
}
