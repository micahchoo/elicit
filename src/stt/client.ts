/**
 * Parent-side STT client. Spawns a child process running the sherpa-onnx
 * worker, sends audio over stdio, and returns transcriptions.
 *
 * Lazy spawn — the process starts on the first `transcribe()` call.
 * `dispose()` hard-kills the child so the native addon's destructor never
 * runs in a shared address space (sherpa-onnx-node's NAPI finalizer can
 * segfault on shutdown).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolveModelDir } from './model.js';

// --- protocol types matching worker.ts ---

interface TranscriptionResp {
 type: 'transcription';
 id: string;
 text: string;
}

interface ErrorResp {
 type: 'error';
 id: string;
 error: string;
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


type WorkerMsg = TranscriptionResp | ErrorResp;
// --- client ---

export interface SttClient {
 /**
  * Transcribe 16 kHz mono audio. Spawns the worker on first call.
  * Rejects on worker error or spawn failure.
  */
 transcribe(samples: Float32Array, sampleRate: number): Promise<string>;

 /** Kill the worker process. Safe to call multiple times. */
 dispose(): void;
}

export interface SttClientOptions {
 /** Override the tsx path used to spawn the worker. */
 tsxPath?: string;
 /** Override the worker script path. */
 workerPath?: string;
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
 const pending = new Map<string, Deferred<string>>();
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

    const dfd = pending.get(msg.id);
    if (!dfd) continue;

    pending.delete(msg.id);

    if (msg.type === 'transcription') {
     dfd.resolve(msg.text);
    } else if (msg.type === 'error') {
     dfd.reject(new Error(msg.error));
    }
   }
  });

  child.on('exit', (code, signal) => {
   const reason = signal
    ? `worker killed by signal ${signal}`
    : `worker exited with code ${code}`;
   // Reject all outstanding promises.
   for (const [id, dfd] of pending) {
    dfd.reject(new Error(reason));
    pending.delete(id);
   }
   child = null;
  });

  child.on('error', (err) => {
   for (const [id, dfd] of pending) {
    dfd.reject(err);
    pending.delete(id);
   }
   child = null;
  });

  return child;
 }

 function float32ToBase64(samples: Float32Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
 }

 return {
  async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
   const proc = ensureSpawned();
   const id = String(nextId++);
   const dfd = deferred<string>();
   pending.set(id, dfd);

   const msg = JSON.stringify({
    type: 'transcribe',
    id,
    samples: float32ToBase64(samples),
    sampleRate,
   });

   proc.stdin!.write(`${msg}\n`);

   return dfd.promise;
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
