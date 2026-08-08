/**
 * The JSON-over-stdio protocol between the parent STT client and the
 * sherpa-onnx worker child. Declared ONCE here — the two halves run in
 * separate processes (the NAPI finalizer segfaults in a shared address
 * space), so a field rename that compiles green would break the pipe at
 * runtime if each half kept its own copy.
 */

/** Parent → worker: transcribe one audio buffer. */
export interface TranscribeMsg {
 type: 'transcribe';
 id: string;
 /** Base64-encoded Float32 bytes. */
 samples: string;
 sampleRate: number;
}

/** Parent → worker: shut the recognizer down. */
export interface ShutdownMsg {
 type: 'shutdown';
}

export type Inbound = TranscribeMsg | ShutdownMsg;

/** Worker → parent: a finished transcription, token-timed. */
export interface TranscriptionResp {
 type: 'transcription';
 id: string;
 text: string;
 tokens: string[];
 timestamps: number[];
 durations: number[];
}

/** Worker → parent: a failed transcription. */
export interface ErrorResp {
 type: 'error';
 id: string;
 error: string;
}

export type Outbound = TranscriptionResp | ErrorResp;

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
 if (p.type === 'shutdown') return { type: 'shutdown' };
 throw new Error(`unknown STT message type: ${String(p.type)}`);
}
