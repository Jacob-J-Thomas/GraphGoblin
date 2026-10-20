import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
const scenario = process.argv[2];
const print = (value) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const chunk of process.stdin) void chunk;
if (scenario === 'arguments') process.stderr.write('error: unexpected argument --synthetic');
else if (scenario === 'missing')
  print({
    type: 'turn.failed',
    error: { message: 'no rollout found for thread id prior-session' },
  });
else {
  print({ type: 'thread.started', thread_id: 'fixture-thread' });
  if (scenario.startsWith('accepted') || scenario === 'completed') print({ type: 'turn.started' });
  if (scenario === 'accepted-hold') await setTimeout(600000);
  if (scenario === 'completed') {
    print({
      type: 'item.completed',
      item: { id: 'answer', type: 'agent_message', text: 'Recovered' },
    });
    print({ type: 'turn.completed', usage: {} });
  }
  if (scenario === 'accepted-auth')
    print({ type: 'turn.failed', error: { message: 'Not logged in' } });
}
process.exitCode = scenario === 'completed' ? 0 : 1;
