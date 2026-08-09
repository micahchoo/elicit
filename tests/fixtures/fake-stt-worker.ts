/**
 * A fake STT worker for the streaming protocol tests (R4). Speaks the real
 * JSON-over-stdio protocol (src/stt/protocol.ts) — stream-open → stream-ready,
 * audio → partial, stream-end → final partial, transcribe → transcription —
 * but answers with canned text, so the parent client's id correlation,
 * partial dispatch and end resolution run over a REAL stdio pipe without
 * the sherpa addon (no model in CI).
 */

import { createInterface } from 'node:readline';
import { decodeInbound, encodeOutbound, type Inbound } from '../../src/stt/protocol.js';

const rl = createInterface({ input: process.stdin });

rl.on('line', (line: string) => {
 const trimmed = line.trim();
 if (!trimmed) return;

 let msg: Inbound;
 try {
  msg = decodeInbound(trimmed);
 } catch {
  process.stdout.write(encodeOutbound({ type: 'error', id: '', error: 'bad message' }));
  return;
 }

 if (msg.type === 'shutdown') {
  process.exit(0);
  return;
 }
 if (msg.type === 'stream-open') {
  process.stdout.write(encodeOutbound({ type: 'stream-ready', id: msg.id }));
  return;
 }
 if (msg.type === 'audio') {
  process.stdout.write(encodeOutbound({ type: 'partial', id: msg.id, text: 'hello', final: false }));
  return;
 }
 if (msg.type === 'stream-end') {
  process.stdout.write(encodeOutbound({ type: 'partial', id: msg.id, text: 'hello world', final: true }));
  return;
 }
 process.stdout.write(encodeOutbound({
  type: 'transcription',
  id: msg.id,
  text: 'one shot',
  tokens: ['one', 'shot'],
  timestamps: [0, 0.3],
  durations: [0.3, 0.4],
 }));
});
