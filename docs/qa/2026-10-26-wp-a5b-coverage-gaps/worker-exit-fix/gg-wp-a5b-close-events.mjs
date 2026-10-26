import { fork } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
for (const mode of ['disconnect-and-kill', 'disconnect-only']) {
  const child = fork(new URL('./gg-wp-a5b-child-events.mjs', import.meta.url), [], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const events = [];
  child.stderr.resume();
  for (const event of ['disconnect', 'exit', 'close', 'error']) child.on(event, (...args) => events.push([event, ...args]));
  const ended = Promise.all([once(child, 'exit'), finished(child.stderr)]);
  await once(child, 'message');
  child.disconnect();
  const killed = mode === 'disconnect-and-kill' ? child.kill('SIGKILL') : false;
  await ended;
  await sleep(1000);
  let liveness;
  try { process.kill(child.pid, 0); liveness = 'alive'; } catch (error) { liveness = error.code; }
  console.log(JSON.stringify({mode, pid: child.pid, killReturned: killed, events, exitCode: child.exitCode, signalCode: child.signalCode, stderrClosed: child.stderr.closed, liveness}));
}
