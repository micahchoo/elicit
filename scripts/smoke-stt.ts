/**
 * Smoke-test the STT engine:
 *   1. Transcribe 1s of generated silence → must not crash (exit 1 on crash)
 *   2. If a WAV path is provided, transcribe it and print the result
 *
 * Usage:
 *   npx tsx scripts/smoke-stt.ts [path/to/16khz-mono-pcm16.wav]
 */

import { createSttClient } from '../src/stt/client.js';
import { readFileSync } from 'node:fs';

// --- WAV parser (PCM16 mono only, inline) ---

interface WavData {
 sampleRate: number;
 samples: Float32Array;
}

function parseWav(path: string): WavData {
 const buf = readFileSync(path);
 const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

 // RIFF header
 if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not a RIFF file');
 if (view.getUint32(8, false) !== 0x57415645) throw new Error('Not a WAV file');

 // Scan chunks
 let offset = 12;
 let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
 let dataOffset = -1;
 let dataSize = 0;

 while (offset + 8 <= buf.length) {
  const id = view.getUint32(offset, false);
  const size = view.getUint32(offset + 4, true);

  if (id === 0x666d7420) {
   // "fmt "
   if (view.getUint16(offset + 8, true) !== 1) throw new Error('Only PCM format supported');
   fmt = {
    channels: view.getUint16(offset + 10, true),
    sampleRate: view.getUint32(offset + 12, true),
    bitsPerSample: view.getUint16(offset + 22, true),
   };
  } else if (id === 0x64617461) {
   // "data"
   dataOffset = offset + 8;
   dataSize = size;
   break; // data is always last-ish; stop scanning
  }

  offset += 8 + size;
  // Chunks are word-aligned
  if (size % 2 !== 0) offset += 1;
 }

 if (!fmt) throw new Error('WAV missing fmt chunk');
 if (dataOffset < 0) throw new Error('WAV missing data chunk');

 if (fmt.channels !== 1) throw new Error(`Expected mono, got ${fmt.channels} channels`);
 if (fmt.bitsPerSample !== 16) throw new Error(`Expected 16-bit PCM, got ${fmt.bitsPerSample}-bit`);
 if (fmt.sampleRate !== 16000) {
  throw new Error(`Expected 16 kHz, got ${fmt.sampleRate} Hz. Resampling is not supported.`);
 }

 const sampleCount = Math.floor(dataSize / 2);
 const samples = new Float32Array(sampleCount);
 for (let i = 0; i < sampleCount; i++) {
  // PCM16 little-endian → float [-1, 1]
  samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
 }

 return { sampleRate: fmt.sampleRate, samples };
}

// --- main ---

async function main(): Promise<void> {
 console.log('STT smoke test: loading client...');
 const client = createSttClient();

 try {
  // 1. Silence test
  console.log('Transcribing 1s silence...');
  const silenceSamples = 16000; // 1s @ 16kHz
  const silence = new Float32Array(silenceSamples);
  const silenceResult = await client.transcribe(silence, 16000);
  console.log(`Silence result: "${silenceResult.text}"`);
  if (silenceResult.text.trim().length > 0) {
   console.log('(non-empty silence transcript is fine — some models emit noise tokens)');
  }

  // 2. WAV test (if path provided)
  const wavPath = process.argv[2];
  if (wavPath) {
   console.log(`\nTranscribing WAV: ${wavPath}`);
   const wav = parseWav(wavPath);
   const wavResult = await client.transcribe(wav.samples, wav.sampleRate);
   console.log(`Transcript: "${wavResult.text}"`);
  }

  console.log('\nSmoke test passed.');
 } finally {
  client.dispose();
 }
}

main().catch((err) => {
 console.error('Smoke test FAILED:', err instanceof Error ? err.message : String(err));
 process.exit(1);
});
