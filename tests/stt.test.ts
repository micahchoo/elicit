import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { resolveModelDir, resolveCacheDir } from '../src/stt/model.js';

// --- helpers ---

const REQUIRED_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'joiner.int8.onnx',
  'tokens.txt',
] as const;

function populate(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const file of REQUIRED_FILES) {
    writeFileSync(join(dir, file), 'fake content');
  }
}

// --- model resolution ---

describe('resolveModelDir', () => {
  let origEnv: string | undefined;
  let origHome: string | undefined;
  let dir: string;

  beforeEach(() => {
    origEnv = process.env['ELICIT_STT_MODEL_DIR'];
    origHome = process.env['HOME'];
    dir = mkdtempSync(join(tmpdir(), 'stt-model-'));
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env['ELICIT_STT_MODEL_DIR'] = origEnv;
    } else {
      delete process.env['ELICIT_STT_MODEL_DIR'];
    }
    process.env['HOME'] = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses ELICIT_STT_MODEL_DIR when set and all files present', () => {
    const modelDir = join(dir, 'custom-model');
    populate(modelDir);
    process.env['ELICIT_STT_MODEL_DIR'] = modelDir;
    // Prevent cache fallback
    process.env['HOME'] = dir;

    expect(resolveModelDir()).toBe(resolvePath(modelDir));
  });

  it('throws when ELICIT_STT_MODEL_DIR is set but files are missing', () => {
    const modelDir = join(dir, 'incomplete');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'encoder.int8.onnx'), 'fake');
    // Missing decoder, joiner, tokens

    process.env['ELICIT_STT_MODEL_DIR'] = modelDir;
    process.env['HOME'] = dir;

    expect(() => resolveModelDir()).toThrow(/Parakeet STT model not found/);
  });

  it('falls back to cache when env var is not set and cache is populated', () => {
    delete process.env['ELICIT_STT_MODEL_DIR'];
    // Populate the cache path under our temp dir
    const cacheDir = resolveCacheDir();
    // resolveCacheDir uses homedir() which respects HOME — set it first
    process.env['HOME'] = dir;
    const expectedCache = resolveCacheDir();
    populate(expectedCache);

    expect(resolveModelDir()).toBe(resolvePath(expectedCache));
  });

  it('throws when no model dir is available', () => {
    delete process.env['ELICIT_STT_MODEL_DIR'];
    process.env['HOME'] = dir; // empty temp dir, no cache

    expect(() => resolveModelDir()).toThrow(/Parakeet STT model not found/);
  });

  it('rejects env dir with partial files even when cache is valid', () => {
    const partialDir = join(dir, 'partial');
    mkdirSync(partialDir, { recursive: true });
    writeFileSync(join(partialDir, 'encoder.int8.onnx'), 'fake');
    // Only encoder present — env dir is incomplete

    process.env['ELICIT_STT_MODEL_DIR'] = partialDir;
    process.env['HOME'] = dir;
    const expectedCache = resolveCacheDir();
    populate(expectedCache);

    // The env var dir has missing files → skipped.
    // Falls through to cache, which is populated → succeeds.
    expect(resolveModelDir()).toBe(resolvePath(expectedCache));
  });
});

// --- WAV format contract tests ---

function buildWavHeader(
  dataSize: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize);
  let off = 0;

  // RIFF
  buf.write('RIFF', off); off += 4;
  buf.writeUInt32LE(36 + dataSize, off); off += 4;
  buf.write('WAVE', off); off += 4;

  // fmt
  buf.write('fmt ', off); off += 4;
  buf.writeUInt32LE(16, off); off += 4; // chunk size
  buf.writeUInt16LE(1, off); off += 2; // PCM
  buf.writeUInt16LE(channels, off); off += 2;
  buf.writeUInt32LE(sampleRate, off); off += 4;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  buf.writeUInt32LE(byteRate, off); off += 4;
  const blockAlign = channels * (bitsPerSample / 8);
  buf.writeUInt16LE(blockAlign, off); off += 2;
  buf.writeUInt16LE(bitsPerSample, off); off += 2;

  // data
  buf.write('data', off); off += 4;
  buf.writeUInt32LE(dataSize, off);

  return buf;
}

function float32ToPcm16(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return buf;
}

describe('WAV format (smoke script contract)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wav-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a valid 16kHz mono PCM16 WAV', () => {
    const samples = new Float32Array([0.1, -0.2, 0.5, -0.8]);
    const pcm = float32ToPcm16(samples);
    const header = buildWavHeader(pcm.length, 16000, 1, 16);
    const wavPath = join(dir, 'test.wav');
    writeFileSync(wavPath, Buffer.concat([header, pcm]));

    const buf = readFileSync(wavPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    expect(view.getUint32(0, false)).toBe(0x52494646); // "RIFF"
    expect(view.getUint32(8, false)).toBe(0x57415645); // "WAVE"
    expect(view.getUint32(12, false)).toBe(0x666d7420); // "fmt "
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(36, false)).toBe(0x64617461); // "data"
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('builds a WAV header with 44100 Hz (should be rejected by parser)', () => {
    const pcm = Buffer.alloc(200);
    const header = buildWavHeader(pcm.length, 44100, 1, 16);
    const wavPath = join(dir, 'bad-rate.wav');
    writeFileSync(wavPath, Buffer.concat([header, pcm]));

    const buf = readFileSync(wavPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint32(24, true)).toBe(44100);
  });

  it('builds a stereo WAV header (should be rejected by parser)', () => {
    const pcm = Buffer.alloc(400);
    const header = buildWavHeader(pcm.length, 16000, 2, 16);
    const wavPath = join(dir, 'stereo.wav');
    writeFileSync(wavPath, Buffer.concat([header, pcm]));

    const buf = readFileSync(wavPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint16(22, true)).toBe(2); // stereo
  });

  it('round-trips Float32 → PCM16 without clipping artifacts', () => {
    // Use values that avoid tie-case rounding ambiguities.
    // 0.5 → 16383.5 → Math.round = 16384 (half up).
    // But Math.round varies by ES version for ties. Use clean multiples:
    //  0.25 →  8191.75 → rounds to  8192
    // -0.25 → -8191.75 → rounds to -8192
    //  0.75 → 24575.25 → rounds to 24575
    // -0.75 → -24575.25 → rounds to -24575
    //  0.0  → 0
    //  1.0  → 32767
    // -1.0  → -32767
    const original = new Float32Array([0.0, 0.25, -0.25, 0.75, -0.75, 1.0, -1.0]);
    const pcm = float32ToPcm16(original);

    expect(pcm.readInt16LE(0)).toBe(0);
    expect(pcm.readInt16LE(2)).toBe(8192);
    expect(pcm.readInt16LE(4)).toBe(-8192);
    expect(pcm.readInt16LE(6)).toBe(24575);
    expect(pcm.readInt16LE(8)).toBe(-24575);
    expect(pcm.readInt16LE(10)).toBe(32767);
    expect(pcm.readInt16LE(12)).toBe(-32767);
  });
});
