import { OllamaError, object } from './http.js';

/** Qualified separately against actual prompt_eval_count before releasing a new profile. */
export const OLLAMA_CONTEXT_PROFILE = 'ollama-0.32.15/qwen35-gpt2/single-user-v1';
export const OLLAMA_CONTEXT_TOKENS = 4096;
export const OLLAMA_OUTPUT_RESERVE = 1024;
const WRAPPER_RESERVE = 512;

function unsupported(): never {
  throw new OllamaError(
    'HARNESS_CONTEXT_UNSUPPORTED',
    'This Ollama model/runtime has no supported context-admission profile. Use the qualified Qwen3.5 runtime or choose another harness; model discovery alone does not verify context capacity.',
  );
}

/**
 * A conservative byte ceiling for this verified byte-tokenizing renderer, never an exact
 * token count. The no-tools, one-user wrapper is separately covered by WRAPPER_RESERVE.
 * An arbitrary Jinja template cannot be bounded from its source length.
 */
export function contextRuntimeVersion(version: unknown): string {
  if (!object(version) || version.version !== '0.32.15') unsupported();
  return version.version;
}

export function contextProfile(detail: unknown, version: unknown) {
  contextRuntimeVersion(version);
  if (!object(detail)) unsupported();
  const info = detail.model_info;
  if (
    !object(info) ||
    info['general.architecture'] !== 'qwen35' ||
    info['tokenizer.ggml.model'] !== 'gpt2' ||
    info['tokenizer.ggml.pre'] !== 'qwen35' ||
    detail.template !== '{{ .Prompt }}' ||
    detail.renderer !== undefined ||
    (detail.system !== undefined && detail.system !== '') ||
    (detail.messages !== undefined &&
      (!Array.isArray(detail.messages) || detail.messages.length !== 0))
  )
    unsupported();
  const maximum = info['qwen35.context_length'];
  if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 2048)
    unsupported();
  const contextTokens = Math.min(OLLAMA_CONTEXT_TOKENS, maximum);
  return {
    contextTokens,
    outputReserveTokens: OLLAMA_OUTPUT_RESERVE,
    profile: OLLAMA_CONTEXT_PROFILE,
    window(schema?: unknown) {
      const overhead =
        WRAPPER_RESERVE + (schema ? Buffer.byteLength(JSON.stringify(schema), 'utf8') : 0);
      return {
        contextTokens,
        outputReserveTokens: OLLAMA_OUTPUT_RESERVE,
        profile: OLLAMA_CONTEXT_PROFILE,
        fits: (prompt: string) =>
          Buffer.byteLength(prompt, 'utf8') + overhead + OLLAMA_OUTPUT_RESERVE <= contextTokens,
      };
    },
  };
}

export function contextOverflow(): OllamaError {
  return new OllamaError(
    'HARNESS_CONTEXT_LIMIT',
    'The complete prompt exceeds this Ollama context allocation, including instructions and reply reserve. Shorten the current message or workflow prompt, start a new conversation, or choose a qualified model with more context. Required input was not submitted or truncated.',
  );
}
