/**
 * The New run flow's address. `?loop=<loopId>` preselects a loop, so the editor's "Open in Runs"
 * and the post-publish link land on its form, and a reload keeps the choice.
 */
export function newRunPath(loopId?: string): string {
  return loopId ? `/runs/new?loop=${encodeURIComponent(loopId)}` : '/runs/new';
}
