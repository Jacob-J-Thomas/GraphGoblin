/**
 * Model-only download allowlist, checked against the official upstream on 2026-11-08.
 * whisper.cpp's models/README.md links this repository for converted OpenAI weights.
 * Immutable metadata (exact bytes and LFS SHA-256):
 * https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
 * Model licence:
 * https://huggingface.co/ggerganov/whisper.cpp/raw/5359861c739e955e79d9a303bcbc70fb988958b1/README.md
 * https://github.com/openai/whisper/blob/main/LICENSE
 * These are model assets, not runtime binaries or an approval to build/install a runtime.
 */
const revision = '5359861c739e955e79d9a303bcbc70fb988958b1';
export const VOICE_MODELS = Object.freeze({
  'tiny.en': Object.freeze({
    filename: 'ggml-tiny.en.bin',
    revision,
    bytes: 77_704_715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    license: 'MIT',
  }),
  'base.en': Object.freeze({
    filename: 'ggml-base.en.bin',
    revision,
    bytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    license: 'MIT',
  }),
});
export type VoiceModelId = keyof typeof VOICE_MODELS;
