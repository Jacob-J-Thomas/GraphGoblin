import { Liquid } from 'liquidjs';
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

/** Render a template against a view. Throws TemplateError with the Liquid message on failure. */
export async function renderTemplate(
  template: string,
  view: Record<string, unknown>,
): Promise<string> {
  try {
    const out: unknown = await engine.parseAndRender(template, view);
    return typeof out === 'string' ? out : String(out);
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TemplateError(`template failed: ${message}`, { template: template.slice(0, 200) });
  }
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
