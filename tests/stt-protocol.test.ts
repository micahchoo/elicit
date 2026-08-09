/**
 * The JSON-over-stdio protocol contract (src/stt/protocol.ts): the one
 * declaration both halves of the child-process pipe share. A field rename
 * that compiles green on one side but not the other fails HERE — the test
 * pins the wire shape the worker and the client both speak.
 */
import { describe, expect, it } from 'vitest';
import { decodeInbound, encodeOutbound, type Outbound } from '../src/stt/protocol.js';

describe('the STT wire protocol (one declaration)', () => {
 it('round-trips a transcribe request through decodeInbound', () => {
  const msg = { type: 'transcribe' as const, id: 'm-1', samples: 'AAAA', sampleRate: 16000 };
  expect(decodeInbound(JSON.stringify(msg))).toEqual(msg);
 });

 it('decodes a shutdown request', () => {
  expect(decodeInbound('{"type":"shutdown"}')).toEqual({ type: 'shutdown' });
 });

 it('throws on a malformed line — JSON that is not an object', () => {
  expect(() => decodeInbound('42')).toThrow();
  expect(() => decodeInbound('null')).toThrow();
  expect(() => decodeInbound('not json')).toThrow();
 });

 it('throws on an unknown message type instead of passing it downstream', () => {
  expect(() => decodeInbound('{"type":"bogus"}')).toThrow();
 });

 it('throws when a transcribe request lacks a field the worker reads', () => {
  expect(() => decodeInbound('{"type":"transcribe","id":"m-1"}')).toThrow();
  expect(() => decodeInbound('{"type":"transcribe","id":"m-1","samples":"AAAA","sampleRate":"16000"}')).toThrow();
 });

 it('encodes an outbound message as one newline-terminated line', () => {
  const out: Outbound = { type: 'transcription', id: 'm-1', text: 'hi', tokens: ['hi'], timestamps: [0], durations: [1] };
  const line = encodeOutbound(out);
  expect(line.endsWith('\n')).toBe(true);
  expect(JSON.parse(line)).toEqual(out);
 });

 // ── Streaming (redesign wave 4, R4): stream-open / audio / stream-end ──

 it('round-trips a stream-open request through decodeInbound', () => {
  expect(decodeInbound('{"type":"stream-open","id":"s-1"}')).toEqual({ type: 'stream-open', id: 's-1' });
 });

 it('round-trips an audio request through decodeInbound', () => {
  const msg = { type: 'audio' as const, id: 's-1', samples: 'AAAA', sampleRate: 16000 };
  expect(decodeInbound(JSON.stringify(msg))).toEqual(msg);
 });

 it('round-trips a stream-end request through decodeInbound', () => {
  expect(decodeInbound('{"type":"stream-end","id":"s-1"}')).toEqual({ type: 'stream-end', id: 's-1' });
 });

 it('throws when a streaming request lacks a field the worker reads', () => {
  expect(() => decodeInbound('{"type":"stream-open"}')).toThrow();
  expect(() => decodeInbound('{"type":"audio","id":"s-1","samples":"AAAA"}')).toThrow();
  expect(() => decodeInbound('{"type":"audio","id":"s-1","sampleRate":16000}')).toThrow();
  expect(() => decodeInbound('{"type":"stream-end"}')).toThrow();
 });

 it('encodes the streaming outbound messages as newline-terminated lines', () => {
  const messages: Outbound[] = [
   { type: 'stream-ready', id: 's-1' },
   { type: 'partial', id: 's-1', text: 'hi', final: false },
   { type: 'partial', id: 's-1', text: 'hi there', final: true },
   { type: 'partial', id: 's-1', text: 'no final flag reads as false' },
   { type: 'stream-error', id: 's-1', error: 'decode failed' },
  ];
  for (const out of messages) {
   const line = encodeOutbound(out);
   expect(line.endsWith('\n')).toBe(true);
   expect(JSON.parse(line)).toEqual(out);
  }
 });
});
