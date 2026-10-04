/**
 * How the jsdom stand-in for `<dialog>` (set up in setup.ts) delivers the `close` event. Browsers
 * queue it as a task that runs after the code that closed the dialog, which is the default here
 * too; `sync` dispatches it inside `close()`. The setup resets it after each test.
 */
export const dialogClose: { delivery: 'task' | 'sync' } = { delivery: 'task' };

/** Let queued tasks run, such as a dialog's `close` event. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
