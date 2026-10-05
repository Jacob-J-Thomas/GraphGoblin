/** Recover a clean baseline even if an earlier E2E process was killed before teardown. */
export function originalWorker(source: string): string {
  return source.replace(/(?:\n\/\/ E2E build \d+\n)+$/, '');
}
