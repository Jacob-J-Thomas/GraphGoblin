export async function load(url, context, next) {
  const result = await next(url, context);
  if (url.endsWith('/apps/api/scripts/recovery-process.integration.mjs')) {
    const source = String(result.source)
      .replace('let port = 5600; port <= 5699', 'let port = 5920; port <= 5929')
      .replace("'gg-recovery-process-'", "'gg-qa-320-recovery-process-'");
    return { ...result, source };
  }
  return result;
}
