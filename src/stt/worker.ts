/**
 * Child-process STT worker. Loads the sherpa-onnx native addon lazily,
 * keeps the recognizer warm, and transcribes audio sent over stdio.
 *
 * Protocol (newline-delimited JSON over stdin/stdout):
 *   Parent → child: {"type":"transcribe","id":"<string>","samples":"<base64>","sampleRate":16000}
 *   Child → parent: {"type":"transcription","id":"<string>","text":"..."}
 *                 | {"type":"error","id":"<string>","error":"<message>"}
 *   Parent → child: {"type":"stream-open","id":"<string>"}
 *   Child → parent: {"type":"stream-ready","id":"<string>"}
 *   Parent → child: {"type":"audio","id":"<string>","samples":"<base64>","sampleRate":16000}
 *   Child → parent: {"type":"partial","id":"<string>","text":"...","final":false}
 *   Parent → child: {"type":"stream-end","id":"<string>"}
 *   Child → parent: {"type":"partial","id":"<string>","text":"...","final":true}
 *                 | {"type":"stream-error","id":"<string>","error":"<message>"}
 *   Parent → child: {"type":"shutdown"}
 *   (child exits 0 after shutdown)
 *
 * Streaming engine (decided + documented, wave 4 R4): the installed NeMo
 * Parakeet TDT transducer is an OFFLINE model — sherpa-onnx has no online
 * (chunked-state) support for it (k2-fsa/sherpa-onnx#2918; the maintainer's
 * own recommendation for this model is simulated streaming, e.g. the
 * apk-simulate-streaming-asr build). So the stream protocol rides the
 * offline recognizer pseudo-streaming: one OfflineStream per stream id,
 * acceptWaveform APPENDS (the native stream keeps the accumulated audio),
 * and each audio message re-decodes the whole buffer. The result text is
 * the cumulative hypothesis — emitted as a partial only when it changed.
 * sherpa's online isEndpoint/reset do not exist on this engine, so the
 * stream is one segment: stream-end does the final decode and the final
 * partial, then the native stream is released. This is why the one-shot
 * `transcribe` path (same engine, one fresh stream, full result with
 * token timings) stays exactly as it was — the fallback never changes.
 *
 * The model directory is resolved by the model.ts module (runs in the parent);
 * the parent sets ELICIT_STT_MODEL_DIR before spawning so the worker can
 * just read the env var directly without re-resolving.
 */

import { createRequire } from 'node:module';
import { decodeInbound, encodeOutbound, type Inbound, type Outbound } from './protocol.js';
import { createInterface } from 'node:readline';
import { resolveModelDir } from './model.js';

// --- sherpa-onnx types (CJS addon, no separate .d.ts) ---

interface SherpaOfflineStream {
 acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
}

interface SherpaOfflineRecognizer {
 createStream(): SherpaOfflineStream;
 decodeAsync(
  stream: SherpaOfflineStream,
 ): Promise<{
  text: string;
  tokens: string[];
  timestamps: number[];
  durations: number[];
 }>;
}

interface SherpaModule {
 OfflineRecognizer: {
  createAsync(config: {
   modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string };
    tokens: string;
    modelType: string;
    numThreads: number;
    provider: string;
    debug: number;
   };
   decodingMethod: string;
  }): Promise<SherpaOfflineRecognizer>;
 };
}

// --- protocol: one shared contract (src/stt/protocol.ts) ---

function send(msg: Outbound): void {
 process.stdout.write(encodeOutbound(msg));
}

// --- recognizer (lazy, cached) ---

let recognizer: SherpaOfflineRecognizer | null = null;

async function getRecognizer(): Promise<SherpaOfflineRecognizer> {
 if (recognizer) return recognizer;

 const modelDir = resolveModelDir();
 const require_ = createRequire(import.meta.url);
 const sherpa = require_('sherpa-onnx-node') as SherpaModule;

 recognizer = await sherpa.OfflineRecognizer.createAsync({
  modelConfig: {
   transducer: {
    encoder: `${modelDir}/encoder.int8.onnx`,
    decoder: `${modelDir}/decoder.int8.onnx`,
    joiner: `${modelDir}/joiner.int8.onnx`,
   },
   tokens: `${modelDir}/tokens.txt`,
   modelType: 'nemo_transducer',
   numThreads: 4,
   provider: 'cpu',
   debug: 0,
  },
  decodingMethod: 'greedy_search',
 });

 return recognizer;
}

async function transcribe(
 samples: Float32Array,
 sampleRate: number,
): Promise<{
 text: string;
 tokens: string[];
 timestamps: number[];
 durations: number[];
}> {
 const rec = await getRecognizer();
 const stream = rec.createStream();
 stream.acceptWaveform({ samples, sampleRate });
 const result = await rec.decodeAsync(stream);
 return {
  text: result.text,
  tokens: result.tokens,
  timestamps: result.timestamps,
  durations: result.durations,
 };
}

function base64ToFloat32(b64: string): Float32Array {
 const buf = Buffer.from(b64, 'base64');
 return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// --- streaming state (pseudo-streaming on the offline engine, see header) ---

interface WorkerStream {
 stream: SherpaOfflineStream;
 lastPartial: string;
}

const streams = new Map<string, WorkerStream>();

async function openStream(id: string): Promise<void> {
 try {
  const rec = await getRecognizer();
  const stream = rec.createStream();
  streams.set(id, { stream, lastPartial: '' });
  send({ type: 'stream-ready', id });
 } catch (err) {
  send({
   type: 'stream-error',
   id,
   error: err instanceof Error ? err.message : String(err),
  });
 }
}

async function pushAudio(id: string, samples: Float32Array, sampleRate: number): Promise<void> {
 const ws = streams.get(id);
 if (!ws) {
  send({ type: 'stream-error', id, error: `unknown stream: ${id}` });
  return;
 }
 try {
  const rec = await getRecognizer();
  ws.stream.acceptWaveform({ samples, sampleRate });
  const result = await rec.decodeAsync(ws.stream);
  if (result.text !== ws.lastPartial) {
   ws.lastPartial = result.text;
   send({ type: 'partial', id, text: result.text, final: false });
  }
 } catch (err) {
  streams.delete(id);
  send({
   type: 'stream-error',
   id,
   error: err instanceof Error ? err.message : String(err),
  });
 }
}

async function endStream(id: string): Promise<void> {
 const ws = streams.get(id);
 if (!ws) {
  send({ type: 'stream-error', id, error: `unknown stream: ${id}` });
  return;
 }
 streams.delete(id);
 try {
  const rec = await getRecognizer();
  // The final decode covers everything accepted so far — the authoritative
  // transcript for the hold.
  const result = await rec.decodeAsync(ws.stream);
  send({ type: 'partial', id, text: result.text, final: true });
 } catch (err) {
  send({
   type: 'stream-error',
   id,
   error: err instanceof Error ? err.message : String(err),
  });
 }
}

// --- main loop ---

async function handle(msg: Inbound): Promise<boolean> {
 if (msg.type === 'shutdown') {
  return false;
 }

 if (msg.type === 'stream-open') {
  await openStream(msg.id);
  return true;
 }

 if (msg.type === 'audio') {
  const samples = base64ToFloat32(msg.samples);
  await pushAudio(msg.id, samples, msg.sampleRate);
  return true;
 }

 if (msg.type === 'stream-end') {
  await endStream(msg.id);
  return true;
 }

 try {
  const samples = base64ToFloat32(msg.samples);
  const result = await transcribe(samples, msg.sampleRate);
  send({
   type: 'transcription',
   id: msg.id,
   text: result.text,
   tokens: result.tokens,
   timestamps: result.timestamps,
   durations: result.durations,
  });
 } catch (err) {
  send({
   type: 'error',
   id: msg.id,
   error: err instanceof Error ? err.message : String(err),
  });
 }

 return true;
}

const rl = createInterface({ input: process.stdin });

// Messages run through a serial promise chain: the readline 'line' handler
// is async but readline never awaits it, so naive handlers interleave —
// harmless for one-shot transcribes in practice (the parent awaits each),
// but streaming REQUIRES in-order processing (chunks of one stream must be
// accepted in arrival order, and the final decode must see them all).
let queue: Promise<void> = Promise.resolve();

rl.on('line', (line: string) => {
 const trimmed = line.trim();
 if (!trimmed) return;

 queue = queue
  .then(async () => {
   let msg: Inbound;
   try {
    msg = decodeInbound(trimmed);
   } catch {
    send({ type: 'error', id: '', error: `Invalid message: ${trimmed}` });
    return;
   }

   const keepGoing = await handle(msg);
   if (!keepGoing) {
    rl.close();
    process.exit(0);
   }
  })
  .catch((err: unknown) => {
   // A per-message handler already reports its own failures; this is the
   // safety net for anything that escapes it (e.g. a decode crash).
   console.error('[stt-worker] unhandled:', err);
  });
});
