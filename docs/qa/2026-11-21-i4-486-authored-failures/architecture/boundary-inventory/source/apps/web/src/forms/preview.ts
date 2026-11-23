import type { ContextThread } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { evaluateExpression, renderTemplate, threadView } from '@graphgoblin/domain';
import { prettyJson } from '../lib/utils.js';

export type PreviewKind = 'template' | 'expression';

export type PreviewResult = { ok: true; output: string } | { ok: false; error: string };

/** The thread previews render against: the shared sample fixture from contracts. */
export function previewThread(): ContextThread {
  return sampleThread();
}

/**
 * Render a Liquid template or evaluate a JSONata expression against the sample thread, through the
 * same `domain` functions the engine uses, so the preview matches what a run would produce.
 */
export async function renderPreview(kind: PreviewKind, source: string): Promise<PreviewResult> {
  const view = threadView(previewThread()) as unknown as Record<string, unknown>;
  try {
    if (kind === 'template') return { ok: true, output: await renderTemplate(source, view) };
    const value = await evaluateExpression(source, view, { timeoutMs: 500 });
    return { ok: true, output: value === undefined ? '(no result)' : prettyJson(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
