/** Supported profile fixture shared by Ollama adapter admission tests. */
export const qwenContextDetail = {
  template: '{{ .Prompt }}',
  model_info: {
    'general.architecture': 'qwen35',
    'tokenizer.ggml.model': 'gpt2',
    'tokenizer.ggml.pre': 'qwen35',
    'qwen35.context_length': 262144,
  },
};
