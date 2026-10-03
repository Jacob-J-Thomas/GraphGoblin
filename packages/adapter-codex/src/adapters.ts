import { CodexDecider } from './decider.js';
import { CodexHarness, type CodexHarnessOptions } from './harness.js';
import { CodexStructured, type CodexStructuredOptions } from './structured.js';

export interface CodexAdapters {
  harness: CodexHarness;
  structured: CodexStructured;
  decider: CodexDecider;
}

/** All three Codex ports over one harness, for a composition root. */
export function createCodexAdapters(
  options: CodexHarnessOptions & { structured?: CodexStructuredOptions } = {},
): CodexAdapters {
  const { structured: structuredOptions, ...harnessOptions } = options;
  const harness = new CodexHarness(harnessOptions);
  const structured = new CodexStructured(harness, structuredOptions);
  return { harness, structured, decider: new CodexDecider(structured) };
}
