---
title: "Voice input: in-process Parakeet STT for sittings"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: [001]
resolution: >
  Shipped in two halves, both verified (195/195 tests, smoke on real model).
  Engine b438b5c: src/stt/ — parakeet via sherpa-onnx-node in a hard-killable
  child process, model from omp cache (env override), utterance-at-a-time.
  Wiring fcb16df: GET /api/stt/status, auth-gated POST /api/transcribe
  (Float32 body, injectable client, activity event logs duration+chars never
  content), quiet mic toggle + inline AudioWorklet 16 kHz capture, transcript
  APPENDS to editable textarea (ratification = Sole Authorship), spoken flag
  on the transcript Turn only. Deferred: streaming partials (Q-9 UX call),
  snippet-provenance threading of spoken, model auto-download.
---

## Question

> **Engine half DONE** (commit b438b5c, 2026-08-01): `src/stt/` — model
> resolution (env → omp cache → throw), child-process worker (JSON-lines over
> stdio, base64 audio), `createSttClient().transcribe(Float32Array, rate)`,
> smoke script verified on this machine (silence → ""). Utterance-at-a-time
> only; streaming deferred pending the Q-9 UX decision. REMAINING: browser mic
> capture (AudioWorklet → 16 kHz mono), server route behind the gate,
> textarea ratification flow + `spoken` provenance note.

Add speech-to-text answering to sittings, matched to omp's proven stack — the
transcription runs inside the Elicit server process (native addon), no separate
STT server, fully local (ADR-0001 holds).

The recipe (read from omp's source, `@oh-my-pi/pi-coding-agent` `src/stt/`):

- Dependency: `sherpa-onnx-node@1.13.2` (native sherpa-onnx addon; platform
  package `sherpa-onnx-linux-x64` comes with it).
- Model: HF `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` —
  `encoder.int8.onnx` + `decoder.int8.onnx` + `joiner.int8.onnx` + `tokens.txt`,
  modelType `nemo_transducer`, ~680 MB. ALREADY CACHED on this machine at
  `~/.omp/agent/cache/tiny-models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/`
  — reuse that path when present (config override), download otherwise.
- Load pattern: `OfflineRecognizer.createAsync({modelConfig: {transducer:
  {encoder, decoder, joiner}, tokens, modelType: 'nemo_transducer', ...}})`;
  per utterance: `createStream()` → `acceptWaveform({samples: Float32Array,
  sampleRate: 16000})` → `decodeAsync(stream)` → `.text`. Load once, keep warm.
  omp isolates it in a hard-killable subprocess worker so a native crash cannot
  take the main process down — mirror that (worker or subprocess), not
  main-thread loading.
- Audio path (Elicit is a web app, omp is a TUI — this part differs): browser
  `getUserMedia` + AudioWorklet downsampling to 16 kHz mono Float32, streamed
  to the server (phone sittings over LAN work identically, behind the password
  gate). No MediaRecorder/webm — that would drag in ffmpeg for decoding.

Design constraints to resolve when building:

- Sole Authorship seam: ASR output is a machine rendering of speech, not yet
  the user's prose. Dictation fills the answer textarea as EDITABLE text; the
  user ratifies (edits, then submits) before it can be harvested. Consider a
  `spoken` provenance note on answers that arrived by voice.
- Streaming UX: omp's endpointer gives partial + committed segments; decide
  whether Elicit needs live partials or utterance-at-a-time is quieter (Q-9).
- Where the model cache lives for a fresh machine (no omp installed).
