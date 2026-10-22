// Changes only test-fixture locations to honor this QA brief. No assertions or runtime code change.
export function relocateFixture(code, id) {
  const normalized = id.replaceAll('\\', '/');
  if (normalized.endsWith('/apps/api/src/testing/api-subprocess.ts')) {
    return code
      .replace('options.portRange ?? [5600, 5699]', '[5920, 5929]')
      .replace("options.directoryPrefix ?? 'gg-api-process-'", "'gg-qa-320-suite-api-process-'");
  }
  if (
    (normalized.includes('/apps/api/') || normalized.includes('/packages/infrastructure/')) &&
    (normalized.endsWith('.test.ts') ||
      normalized.endsWith('/testing/test-app.ts') ||
      normalized.endsWith('.global-setup.ts'))
  ) {
    return code.replace(
      /(\b(?:mkdtemp|mkdtempSync)\(join\(tmpdir\(\),\s*)(['"])(gg-[^'"\r\n]*)(\2)/g,
      (_all, before, quote, prefix) =>
        `${before}${quote}gg-qa-320-suite-${prefix.slice(3)}${quote}`,
    );
  }
  return code;
}
export function locationPlugin() {
  return {
    name: 'qa-fixture-locations',
    enforce: 'pre',
    transform(code, id) {
      const relocated = relocateFixture(code, id);
      if (relocated !== code) return { code: relocated, map: null };
    },
  };
}
