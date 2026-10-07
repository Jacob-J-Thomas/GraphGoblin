// Diagnostic only: this command sandbox failed the network canary; never used for delivery checks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const worktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function sandboxInvocation(check, root) {
  const sdk = fs.realpathSync(
    path.join(worktree, 'packages/adapter-codex/node_modules/@openai/codex-sdk/package.json'),
  );
  const launcher = createRequire(sdk).resolve('@openai/codex/bin/codex.js');
  const profile =
    'permissions={aidlc_checks={filesystem={":root"="read",":workspace_roots"={"."="write"}},network={enabled=false}}}';
  return {
    command: process.execPath,
    args: [
      launcher,
      'sandbox',
      '--permission-profile',
      'aidlc_checks',
      '-c',
      profile,
      '-c',
      'default_permissions="aidlc_checks"',
      '-c',
      'windows.sandbox="elevated"',
      '-C',
      root,
      '--',
      check.program,
      ...check.args,
    ],
  };
}
export function sandboxCheck(check, root, run = spawnSync) {
  const invocation = sandboxInvocation(check, root);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      /^(path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|codex_home)$/i.test(
        k,
      ),
    ),
  );
  return run(invocation.command, invocation.args, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: check.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
}
