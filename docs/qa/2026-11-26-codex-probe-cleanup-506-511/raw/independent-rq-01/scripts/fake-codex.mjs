// Independent QA fake Codex CLI (#506/#511 QA). No prompt, session or provider request is ever made.
// Scenario from GG_QA_SCENARIO; QA-owned state (pid files, turn-attempt record) in GG_QA_STATE.
// Every helper process it starts is bounded by GG_QA_HOLD_MS and records its pid for cleanup.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const scenario = process.env.GG_QA_SCENARIO ?? 'ready';
const state = process.env.GG_QA_STATE;
const holdMs = Number(process.env.GG_QA_HOLD_MS ?? '8000');
const args = process.argv.slice(2);
const print = (text) => process.stdout.write(text + '\n');
const FLAGS = '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config';

/**
 * A bounded helper process in this process's working directory. `pipes`: it inherits this
 * process's stdout/stderr (as the real @openai/codex launcher's native child does), so the caller
 * sees no close while it lives. `detached`: it is outside this process's job, so terminating this
 * process does not end it. `sentinel`: it first writes sentinel.txt into its working directory.
 */
function helper(name, { pipes, detached, sentinel }) {
  const code = [
    "const fs = require('node:fs');",
    sentinel ? "fs.writeFileSync('sentinel.txt', 'written by the QA helper');" : '',
    `fs.writeFileSync(${JSON.stringify(join(state, name + '.pid'))}, String(process.pid));`,
    `setTimeout(() => {}, ${holdMs});`,
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code, `gg-qa-506-helper-${name}`], {
    stdio: pipes ? 'inherit' : 'ignore',
    detached,
    windowsHide: true,
  });
  child.unref();
}

const hang = () => setInterval(() => {}, 1000);

if (args.includes('--version')) print('codex-cli 0.160.0');
else if (args.includes('--help')) print(FLAGS);
else if (args.join(' ') === 'login status') {
  switch (scenario) {
    case 'ready':
      print('Logged in using ChatGPT');
      break;
    case 'auth':
      process.stderr.write('Not logged in PRIVATE_AUTH_CANARY');
      process.exitCode = 1;
      break;
    case 'hang':
      hang();
      break;
    case 'unconfirmed-detached':
      helper('grandchild', { pipes: true, detached: true, sentinel: true });
      hang();
      break;
    case 'unconfirmed-attached':
      helper('grandchild', { pipes: true, detached: false, sentinel: true });
      hang();
      break;
    case 'cwdhold-ready':
      helper('holder', { pipes: false, detached: true, sentinel: false });
      print('Logged in using ChatGPT');
      break;
    case 'cwdhold-auth':
      helper('holder', { pipes: false, detached: true, sentinel: false });
      process.stderr.write('Not logged in PRIVATE_AUTH_CANARY');
      process.exitCode = 1;
      break;
    case 'cwdhold-hang':
      helper('holder', { pipes: false, detached: true, sentinel: false });
      hang();
      break;
    default:
      throw new Error('unknown scenario ' + scenario);
  }
} else if (args[0] === 'mcp' && args[1] === 'list') {
  process.stderr.write('Listing MCP servers PRIVATE_LISTING_CANARY\n');
  if (scenario === 'listing-hang') hang();
  else if (scenario === 'listing-unconfirmed') {
    helper('listing-grandchild', { pipes: true, detached: true, sentinel: false });
    hang();
  } else print('[]');
} else {
  // A turn command would be a QA failure: record it and refuse.
  if (state) writeFileSync(join(state, 'turn-attempt.json'), JSON.stringify(args));
  process.exitCode = 2;
}
