// SYNTHETIC-SEAM shim: re-exports the real built domain module (same instance) and overrides only
// renderTemplate for the canonical rerender caller. Armed per run by globalThis.__QA486_B17.
import * as real from 'file:///G:/ggq/gg-i4-486-qa/GraphGoblin/packages/domain/dist/index.js';
export * from 'file:///G:/ggq/gg-i4-486-qa/GraphGoblin/packages/domain/dist/index.js';
export async function renderTemplate(template, view) {
  globalThis.__QA486_B17_CALLS = (globalThis.__QA486_B17_CALLS ?? 0) + 1;
  if (globalThis.__QA486_B17) throw new real.TemplateError('QA486-EXT-B17 synthetic canonical rerender fault');
  return real.renderTemplate(template, view);
}
