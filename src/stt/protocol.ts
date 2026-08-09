/**
 * The JSON-over-stdio protocol between the parent STT client and the
 * sherpa-onnx worker child. Declared ONCE here — the two halves run in
 * separate processes (the NAPI finalizer segfaults in a shared address
 * space), so a field rename that compiles green would break the pipe at
 * runtime if each half kept its own copy.
 *
 * Streaming (redesign wave 4): a transcription session is one stream id.
 * The parent opens it, pushes audio chunks, and ends it; the worker answers
 * each with partial hypotheses (only when the text changed) and a final
 * partial on stream-end. The one-shot `transcribe` and `shutdown` messages
 * are unchanged — the worker keeps both engines, so the one-shot fallback
 * path stays byte-identical.
 */

/** Parent → worker: transcribe one audio buffer (one-shot). */
export interface TranscribeMsg {
 type: 'transcribe';
 id: string;
 /** Base64-encoded Float32 bytes. */
 samples: string;
 sampleRate: number;
}

/** Parent → worker: open a streaming transcription session. */
export interface StreamOpenMsg {
 type: 'stream-open';
 id: string;
}

/** Parent → worker: push one audio chunk into a stream. */
export interface AudioMsg {
 type: 'audio';
 id: string;
 /** Base64-encoded Float32 bytes. */
 samples: string;
 sampleRate: number;
}

/** Parent → worker: finalize a stream; the worker answers with the final partial. */
export interface StreamEndMsg {
 type: 'stream-end';
 id: string;
}

/** Parent → worker: shut the recognizer down. */
export interface ShutdownMsg {
 type: 'shutdown';
}

export type Inbound = TranscribeMsg | StreamOpenMsg | AudioMsg | StreamEndMsg | ShutdownMsg;

/** Worker → parent: a finished one-shot transcription, token-timed. */
export interface TranscriptionResp {
 type: 'transcription';
 id: string;
 text: string;
 tokens: string[];
 timestamps: number[];
 durations: number[];
}

/** Worker → parent: the stream opened and the recognizer is ready. */
export interface StreamReadyResp {
 type: 'stream-ready';
 id: string;
}

/** Worker → parent: a partial (or, on stream-end, the final) hypothesis.
 *  `final` absent reads as false. */
export interface PartialResp {
 type: 'partial';
 id: string;
 text: string;
 final?: boolean;
}

/** Worker → parent: a failed one-shot transcription. */
export interface ErrorResp {
 type: 'error';
 id: string;
 error: string;
}

/** Worker → parent: a stream-scoped failure (unknown id, decode failure). */
export interface StreamErrorResp {
 type: 'stream-error';
 id: string;
 error: string;
}

export type Outbound =
 | TranscriptionResp
 | StreamReadyResp
 | PartialResp
 | ErrorResp
 | StreamErrorResp;

/** Encode one outbound message as a newline-terminated stdio line. */
export function encodeOutbound(msg: Outbound): string {
 return `${JSON.stringify(msg)}\n`;
}

/** Parse one inbound stdio line; throws on a malformed line. */
export function decodeInbound(line: string): Inbound {
 const parsed: unknown = JSON.parse(line);
 if (parsed === null || typeof parsed !== 'object') throw new Error('malformed STT message');
 const p = parsed as { type?: unknown };
 if (p.type === 'transcribe') {
  const m = parsed as TranscribeMsg;
  if (typeof m.id !== 'string' || typeof m.samples !== 'string' || typeof m.sampleRate !== 'number') {
   throw new Error('malformed transcribe message');
  }
  return m;
 }
 if (p.type === 'stream-open') {
  const m = parsed as StreamOpenMsg;
  if (typeof m.id !== 'string') throw new Error('malformed stream-open message');
  return m;
 }
 if (p.type === 'audio') {
  const m = parsed as AudioMsg;
  if (typeof m.id !== 'string' || typeof m.samples !== 'string' || typeof m.sampleRate !== 'number') {
   throw new Error('malformed audio message');
  }
  return m;
 }
 if (p.type === 'stream-end') {
  const m = parsed as StreamEndMsg;
  if (typeof m.id !== 'string') throw new Error('malformed stream-end message');
  return m;
 }
 if (p.type === 'shutdown') return { type: 'shutdown' };
 throw new Error(`unknown STT message type: ${String(p.type)}`);
}
