import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
const [mode, ...args] = process.argv.slice(2);
const print = (value) => process.stdout.write(JSON.stringify(value) + '\n');
// The fake is owned by the disposable API. Its IPC channel closes even on a hard API kill.
process.on('disconnect', () => process.exit(0));
if (args.includes('--version')) process.stdout.write('2.1.304\n');
else if (args.includes('--help'))
  process.stdout.write(
    '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume\n',
  );
else if (args.includes('auth')) print({ authMethod: 'claude.ai' });
else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const id = '11111111-1111-4111-8111-111111111111';
  print({
    type: 'system',
    subtype: 'init',
    session_id: id,
    tools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'dontAsk',
    model: 'claude-opus-5-5',
    apiKeySource: 'none',
    mcp_servers: [],
    plugins: [],
    skills: [],
  });
  print({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: id,
    result: 'Completed: ' + prompt,
    usage: { input_tokens: 2, output_tokens: 3 },
    modelUsage: { 'claude-opus-5-5': {} },
  });
  if (mode === 'hold') await setTimeout(600000);
}
process.exit(0);
