import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeProcess } from './process.js';
import { subscriptionEnvironment } from './environment.js';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function directory() {
  const folder = await mkdtemp(join(tmpdir(), 'gg-claude-process-'));
  folders.push(folder);
  return folder;
}
async function run(script: string, extra: Partial<Parameters<typeof runClaudeProcess>[0]> = {}) {
  return runClaudeProcess({
    binary: process.execPath,
    args: ['--input-type=module', '-e', script],
    cwd: await directory(),
    env: subscriptionEnvironment(),
    signal: new AbortController().signal,
    timeoutMs: 3000,
    maxOutputBytes: 1024,
    ...extra,
  });
}
describe('owned native Claude process transport', () => {
  it('streams stdout, sends stdin and never retains stderr content', async () => {
    const chunks: Buffer[] = [],
      stderr: Buffer[] = [];
    const result = await runClaudeProcess(
      {
        binary: process.execPath,
        args: [
          '-e',
          'process.stdin.on("data",data=>process.stdout.write(data));process.stdin.on("end",()=>process.stderr.write("PRIVATE_ERROR"));',
        ],
        cwd: await directory(),
        env: subscriptionEnvironment(),
        stdin: 'synthetic input',
        signal: new AbortController().signal,
        timeoutMs: 3000,
        maxOutputBytes: 1024,
      },
      (chunk) => chunks.push(chunk),
      (chunk) => stderr.push(chunk),
    );
    expect(Buffer.concat(chunks).toString()).toBe('synthetic input');
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: 'synthetic input',
      timedOut: false,
      aborted: false,
      overflow: false,
    });
    expect(Buffer.concat(stderr).toString()).toBe('PRIVATE_ERROR');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ERROR');
  });
  it('reports missing executable without exposing raw native errors', async () => {
    const result = await run('', {
      binary: join(await directory(), 'missing-binary.exe'),
      args: [],
    });
    expect(result.spawnCode).toBe('ENOENT');
    expect(result.exitCode).toBeNull();
    expect(JSON.stringify(result)).not.toContain('missing-binary');
  });
  it('kills on deadline and output overflow', async () => {
    expect(await run('setInterval(()=>{},1000)', { timeoutMs: 30 })).toMatchObject({
      timedOut: true,
    });
    expect(
      await run('process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)', {
        maxOutputBytes: 8,
      }),
    ).toMatchObject({ overflow: true });
    expect(
      await run('process.stderr.write("PRIVATE".repeat(1000));setInterval(()=>{},1000)', {
        maxOutputBytes: 8,
      }),
    ).toMatchObject({ overflow: true });
  });
  it('does not spawn for an already aborted signal and cancels a running process', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await run('throw new Error("should not start")', { signal: controller.signal }),
    ).toMatchObject({ aborted: true, exitCode: null });
    const running = new AbortController();
    const promise = run('process.stdout.write("ready");setInterval(()=>{},1000)', {
      signal: running.signal,
    });
    setTimeout(() => running.abort(), 50);
    expect(await promise).toMatchObject({ aborted: true });
  });
  it.skipIf(process.platform !== 'win32')(
    'counts a turn process that exited before its cancellation as stopped once its output closes',
    async () => {
      const dir = await directory(),
        marker = join(dir, 'pids.json'),
        release = join(dir, 'release');
      // Like a CLI that prints its init line and exits at once. A detached process it started
      // keeps the output open until the test creates the release file (or 30 s pass, so a failed
      // run leaves nothing behind).
      const holder =
        "const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},25);setTimeout(()=>process.exit(0),30000)";
      const script =
        "const {spawn}=await import('node:child_process');const fs=await import('node:fs');" +
        `const holder=spawn(process.execPath,['-e',${JSON.stringify(holder)},${JSON.stringify(release)}],{detached:true,stdio:['ignore','inherit','ignore'],windowsHide:true});` +
        'holder.unref();' +
        `fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({root:process.pid,holder:holder.pid}));` +
        "process.stdout.write('init\\n');";
      const controller = new AbortController();
      const result = run(script, { signal: controller.signal, timeoutMs: 10_000 });
      const running = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        let pids: { root: number; holder: number } | undefined;
        await vi.waitFor(
          async () => {
            pids = JSON.parse(await readFile(marker, 'utf8')) as { root: number; holder: number };
          },
          { timeout: 10_000 },
        );
        // Cancel once the root is gone. Whether or not Node has reported its exit yet, a gone root
        // counts as stopped; killTree's own tests cover each of those two paths.
        await vi.waitFor(() => expect(running(pids!.root)).toBe(false), { timeout: 10_000 });
        expect(running(pids!.holder)).toBe(true);
        controller.abort();
        await writeFile(release, 'release');
        const settled = await result;
        expect(settled).not.toHaveProperty('terminationUnconfirmed');
        expect(settled).toMatchObject({ aborted: true, exitCode: 0, stdout: 'init\n' });
        expect(running(pids!.holder)).toBe(false);
      } finally {
        controller.abort();
        await writeFile(release, 'release');
        await result;
      }
    },
    15_000,
  );
  it('kills the descendant that a long-lived child started', async () => {
    const dir = await directory(),
      marker = join(dir, 'descendant-marker');
    const controller = new AbortController();
    const descendant =
      'const fs=require("node:fs");setInterval(()=>fs.appendFileSync(process.argv[1],"x"),20);';
    const script =
      'const {spawn}=await import("node:child_process");const child=spawn(process.execPath,["-e",' +
      JSON.stringify(descendant) +
      ',' +
      JSON.stringify(marker) +
      '],{stdio:"ignore",windowsHide:true});process.stdout.write("ready");setInterval(()=>{},1000);';
    let announce!: () => void;
    const ready = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let stdout = '';
    const result = runClaudeProcess(
      {
        binary: process.execPath,
        args: ['--input-type=module', '-e', script],
        cwd: dir,
        env: subscriptionEnvironment(),
        signal: controller.signal,
        timeoutMs: 5000,
        maxOutputBytes: 1024,
      },
      (chunk) => {
        stdout += chunk.toString();
        if (stdout.includes('ready')) announce();
      },
    );
    try {
      await Promise.race([
        ready,
        result.then(() => {
          throw new Error('Synthetic descendant parent exited before readiness');
        }),
      ]);
      let before = '';
      for (let attempt = 0; attempt < 60 && !before; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        before = await readFile(marker, 'utf8').catch(() => '');
      }
      expect(before.length).toBeGreaterThan(0);
      controller.abort();
      expect(await result).toMatchObject({ aborted: true });
      const stopped = await readFile(marker, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await readFile(marker, 'utf8')).toBe(stopped);
    } finally {
      controller.abort();
      await result;
    }
  });
});
