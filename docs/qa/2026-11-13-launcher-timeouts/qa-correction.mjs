import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = await mkdtemp(join(root, '.tmp', 'qa-correction-'));
const launcher = 'apps/windows-launcher/Launcher.cs';
const suite = 'tooling/scripts/windows-launcher-helper.acceptance.mjs';
const fixture = 'tooling/scripts/__fixtures__/launcher-pipe-holder.cs';
const source = await readFile(join(root, launcher));
const testBytes = await readFile(join(root, suite));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const execOptions = { cwd: root, windowsHide: true, timeout: 40_000 };
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GG_') &&
    !['NODE_OPTIONS', 'NODE_DEBUG', 'JEV_API_KEY'].includes(name.toUpperCase())),
);
const overflowPattern = 'rejects oversized stdout';
const guidancePattern = 'retains held guidance when an ownership recheck';
const deterministicGuidancePattern = 'retains held guidance when an ownership recheck ends in (exit|invalid)';
const evidence = {
  head: (await execute('git', ['rev-parse', 'HEAD'], execOptions)).stdout.trim(),
  node: process.version,
  launcherSourceSha256: hash(source),
  acceptanceSuiteSha256: hash(testBytes),
};
async function runVariant(name, onDisk, pattern) {
  const variant = join(base, name);
  for (const file of [launcher, suite, fixture]) await mkdir(dirname(join(variant,file)), {recursive:true});
  await writeFile(join(variant,launcher), onDisk);
  await writeFile(join(variant,suite), testBytes);
  await copyFile(join(root,fixture),join(variant,fixture));
  try {
    const { stdout, stderr } = await execute(process.execPath, [
      '--test', '--test-name-pattern='+pattern, join(variant,suite),
    ], { ...execOptions, env });
    return { exit:0, stdout, stderr };
  } catch(error) {
    assert.equal(error.killed, false, 'the selected CLI cases must finish before the watchdog');
    return { exit:error.code, stdout:error.stdout, stderr:error.stderr };
  }
}
function mutate(before, after) {
  const text = source.toString('utf8').replaceAll('\r\n', '\n');
  assert.equal(text.split(before).length,2,'mutation must target exactly one expression');
  return text.replace(before,after);
}
evidence.candidate = await runVariant('candidate',source,overflowPattern+'|'+guidancePattern);
assert.equal(evidence.candidate.exit,0,evidence.candidate.stdout);
assert.match(evidence.candidate.stdout,/# pass 4/);
const noOverflowGuard = mutate('!stdout.Oversized && !stdout.Failed','!stdout.Failed');
evidence.withoutOversizeGuard = await runVariant('overflow-guard-removed',noOverflowGuard,overflowPattern);
assert.equal(evidence.withoutOversizeGuard.exit,1);
assert.match(evidence.withoutOversizeGuard.stdout,/0 !== 1/);
assert.match(evidence.withoutOversizeGuard.stdout,/# fail 1/);
const oldCatch = mutate(
  'catch (Exception) {\n                        // A truncated or failed recheck does not invalidate the last held\n                        // result. Keep its safety guidance rather than implying a WMI fault.\n                        throw new Exception(HeldOwnershipRefusal() + " The last ownership recheck was inconclusive after " + releaseElapsed.ElapsedMilliseconds + " ms of the " + releaseBudget + " ms release wait; the last verified held result was retained.");',
  'catch (Exception error) {\n                        throw new Exception(ownershipDetail + ". " + error.Message);',
);
evidence.withoutHeldGuidance = await runVariant('held-catch-reverted',oldCatch,deterministicGuidancePattern);
assert.equal(evidence.withoutHeldGuidance.exit,1);
assert.match(evidence.withoutHeldGuidance.stdout,/# fail 2/);
assert.match(evidence.withoutHeldGuidance.stdout,/not match.*No second gateway was started/i);
assert.match(evidence.withoutHeldGuidance.stdout,/ownership check exited with code 7/i);
assert.match(evidence.withoutHeldGuidance.stdout,/ownership check returned invalid output/i);
console.log(JSON.stringify(evidence,null,2));
