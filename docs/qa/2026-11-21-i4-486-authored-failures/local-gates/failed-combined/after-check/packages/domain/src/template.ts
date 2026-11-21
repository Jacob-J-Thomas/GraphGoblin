import { Liquid, LiquidError } from 'liquidjs';
import { TemplateError } from './errors.js';

/**
 * LiquidJS rendering with no filesystem access and a bounded template cache.
 * Templates are user-authored; they never execute code.
 */

const noFs = {
  readFile: () => Promise.reject(new TemplateError('template includes are disabled')),
  readFileSync: (): string => {
    throw new TemplateError('template includes are disabled');
  },
  exists: () => Promise.resolve(false),
  existsSync: () => false,
  resolve: (_root: string, file: string) => file,
  contains: () => Promise.resolve(false),
  dirname: (file: string) => file,
  sep: '/',
};

const engine = new Liquid({
  cache: 256,
  strictFilters: true,
  strictVariables: false,
  lenientIf: true,
  relativeReference: false,
  fs: noFs,
  jsTruthy: true,
});

export interface TemplateFact {
  phase: 'parse' | 'render';
  line?: number;
  column?: number;
}

/** Parse and render with the runtime dialect. Keep source and Liquid diagnostics out of the fact. */
export async function observeTemplate(template: string, view: Record<string, unknown>) {
  let phase: TemplateFact['phase'] = 'parse';
  try {
    const parsed = engine.parse(template);
    phase = 'render';
    const out: unknown = await engine.render(parsed, view);
    return { ok: true as const, value: typeof out === 'string' ? out : String(out) };
  } catch (error) {
    const fact: TemplateFact = { phase };
    if (error instanceof LiquidError && error.token.input === template) {
      const [line, column] = error.token.getPosition();
      if (
        line !== undefined &&
        column !== undefined &&
        Number.isSafeInteger(line) &&
        Number.isSafeInteger(column) &&
        line > 0 &&
        column > 0
      ) {
        fact.line = line;
        fact.column = column;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      fact,
      error:
        error instanceof TemplateError
          ? error
          : new TemplateError(`template failed: ${message}`, { template: template.slice(0, 200) }),
    };
  }
}

/** Render a template against a view. Throws TemplateError with the Liquid message on failure. */
export async function renderTemplate(
  template: string,
  view: Record<string, unknown>,
): Promise<string> {
  const result = await observeTemplate(template, view);
  if (!result.ok) throw result.error;
  return result.value;
}

/** Parse only, to surface syntax errors at authoring time. Returns null when valid. */
export function checkTemplate(template: string): string | null {
  try {
    engine.parse(template);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Parse using the runtime dialect, without rendering or loading partials. */
export function parseAuthoredTemplate(source: string) {
  return { engine, templates: engine.parse(source) };
}
