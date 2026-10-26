// Native QA-only CLI. It has no provider or network capability.
import { appendFileSync } from 'node:fs';
import { once } from 'node:events';
const args = process.argv.slice(2),
  mode = process.env.GG_QA_MODE;
const print = (x) => process.stdout.write(JSON.stringify(x) + '\n');
if (args.includes('--version')) console.log('2.1.287');
else if (args.includes('--help'))
  console.log(
    '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume',
  );
else if (args.includes('auth')) print({ authMethod: 'claude.ai' });
else {
  for await (const chunk of process.stdin) void chunk;
  appendFileSync(
    process.env.GG_QA_CLI_LOG,
    JSON.stringify({ mode, pid: process.pid, maxTurns: args.includes('--max-turns') }) + '\n',
  );
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
  if (mode === 'stall') await new Promise((r) => setTimeout(r, 12000));
  else if (['quota', 'transport', 'auth'].includes(mode))
    print({
      type: 'assistant',
      error:
        mode === 'quota'
          ? 'quota_exceeded'
          : mode === 'auth'
            ? 'authentication_failed'
            : 'server_error',
    });
  else {
    const text = 'X'.repeat(['large', 'result-only'].includes(mode) ? 20000 : 10);
    for (let i = 0; i < (mode === 'result-only' ? 0 : mode === 'overflow' ? 80 : 1); i++)
      if (
        !print({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: mode === 'overflow' ? 'Y'.repeat(60000) : text }],
          },
        })
      )
        await once(process.stdout, 'drain');
    print({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: id,
      result: text,
      usage: { input_tokens: 2, output_tokens: 3 },
      modelUsage: { 'claude-opus-5-5': {} },
    });
    if (mode === 'result-only') await new Promise((r) => setTimeout(r, 500));
  }
}
