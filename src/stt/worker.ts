/**
 * Child-process STT worker. Loads the sherpa-onnx native addon lazily,
 * keeps the recognizer warm, and transcribes audio sent over stdio.
 *
 * Protocol (newline-delimited JSON over stdin/stdout):
 *   Parent → child: {"type":"transcribe","id":"<string>","samples":"<base64>","sampleRate":16000}
 *   Child → parent: {"type":"transcription","id":"<string>","text":"..."}
 *                 | {"type":"error","id":"<string>","error":"<message>"}
 *   Parent → child: {"type":"shutdown"}
 *   (child exits 0 after shutdown)
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

// --- main loop ---

async function handle(msg: Inbound): Promise<boolean> {
 if (msg.type === 'shutdown') {
  return false;
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

rl.on('line', async (line: string) => {
 const trimmed = line.trim();
 if (!trimmed) return;

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
});
