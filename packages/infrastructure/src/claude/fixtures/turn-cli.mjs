import process from 'node:process';
import { log } from 'node:console';
const [scenario, ...args] = process.argv.slice(2);
const print = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) log('2.1.287');
else if (args.includes('--help'))
  log(
    '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume',
  );
else if (args.includes('auth')) print({ authMethod: 'claude.ai' });
else {
  // Drain the synthetic prompt before a controlled refusal or stream cut; no provider is invoked.
  for await (const chunk of process.stdin) void chunk;
  if (scenario === 'missing') {
    const diagnostic =
      'No conversation found with session ID: 11111111-1111-4111-8111-111111111111';
    print({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      num_turns: 0,
      duration_api_ms: 0,
      session_id: '11111111-1111-4111-8111-111111111111',
      errors: [diagnostic],
    });
    process.stderr.write(diagnostic);
  } else if (scenario === 'auth') process.stderr.write('Authentication required');
  else if (scenario === 'arguments') process.stderr.write('error: unknown option --synthetic');
  else {
    print({
      type: 'system',
      subtype: 'init',
      session_id: '11111111-1111-4111-8111-111111111111',
      tools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'dontAsk',
      model: 'claude-opus-5-5',
      apiKeySource: 'none',
      mcp_servers: [],
      plugins: [],
      skills: [],
    });
    if (scenario === 'assistant')
      print({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } });
    // A provider failure reported in the stream, then a non-zero exit with only a banner on stderr.
    if (scenario === 'provider-failure') {
      print({
        type: 'assistant',
        error: 'rate_limit',
        message: { content: [{ type: 'text', text: 'API Error: 429 PRIVATE_PROVIDER_BODY' }] },
      });
      process.stderr.write('PRIVATE_STDERR_BANNER\n');
    }
  }
  process.exitCode = 1;
}
