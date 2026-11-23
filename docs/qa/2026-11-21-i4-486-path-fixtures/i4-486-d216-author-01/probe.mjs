import { readlinkSync, realpathSync, existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [kind, physical] = process.argv.slice(2);
const root = tmpdir();
const probe = async (input) => ({
  input,
  plain: realpathSync(input),
  native: realpathSync.native(input),
  promises: await realpath(input),
});
const result = { kind, node: process.version, cwd: process.cwd(), temp: root, physical };
switch (kind) {
  case 'short-name': {
    const invocation = ['cmd', '/d', '/s', '/c', '"for %I in ("' + physical + '") do @echo %~sI"'];
    const short = spawnSync(invocation[0], invocation.slice(1), {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    const input = short.stdout?.trim();
    const usable = short.status === 0 && isAbsolute(input ?? '') && existsSync(input);
    Object.assign(result, { invocation, commandExit: short.status, stdout: short.stdout,
      stderr: short.stderr, error: short.error?.message ?? null, available: false });
    if (usable) {
      Object.assign(result, await probe(input));
      result.samePhysicalRoot = result.native === realpathSync.native(physical) && result.native === result.promises;
      result.available = result.samePhysicalRoot && input.toLowerCase() !== physical.toLowerCase();
    }
    console.log(JSON.stringify(result));
    if (!usable || !result.samePhysicalRoot) process.exitCode = 1;
    break;
  }
  case 'uppercase':
  case 'junction': {
    Object.assign(result, await probe(root));
    if (kind === 'junction') result.junctionTarget = readlinkSync(root);
    console.log(JSON.stringify(result));
    if (result.native !== realpathSync.native(physical) || result.native !== result.promises
      || resolve(root) === result.native || (kind === 'uppercase' && result.plain === result.native)) process.exitCode = 1;
    break;
  }
  case 'cross-volume': {
    const originalInput = relative(process.cwd(), join(root, 'gg-wp-e3-control', 'relative'));
    const fixtureInput = relative(process.cwd(), join(process.cwd(), 'gg-wp-relative-control', 'workspace'));
    const volumes = [parse(process.cwd()).root, parse(resolve(root)).root];
    Object.assign(result, { volumes, originalInput, fixtureInput,
      originalAbsolute: isAbsolute(originalInput), fixtureAbsolute: isAbsolute(fixtureInput) });
    console.log(JSON.stringify(result));
    if (volumes[0] === volumes[1] || !result.originalAbsolute || result.fixtureAbsolute) process.exitCode = 1;
    break;
  }
  default:
    throw new Error('Unknown probe');
}
