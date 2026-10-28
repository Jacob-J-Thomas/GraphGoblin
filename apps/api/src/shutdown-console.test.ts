/**
 * Native Windows console evidence for deliberate shutdown (#319, ADR-0049). The built gateway runs
 * attached to a console the way it runs in a terminal window, and a real CTRL_C_EVENT is delivered
 * to that console. Console control events and console sharing exist only on Windows; POSIX signal
 * evidence is in shutdown-process.test.ts. The helpers are compiled with the .NET Framework
 * compiler that Windows PowerShell ships, as the browser shutdown spec does for its fake CLI.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const windows = process.platform === 'win32';
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const entry = join(apiRoot, 'dist', 'main.js');

// host <cwd> <command line>: own a console like a terminal window, start the command attached to
// it with Ctrl+C processing enabled and this process's standard handles, and exit with its code.
// ctrlc <pid>: deliver one CTRL_C_EVENT to every process attached to the console of <pid>.
const consoleTool = String.raw`
using System;
using System.Runtime.InteropServices;
public static class ConsoleTool {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
    IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  public static int Main(string[] args) {
    if (args.Length == 3 && args[0] == "host") {
      IntPtr input = GetStdHandle(-10), output = GetStdHandle(-11), error = GetStdHandle(-12);
      foreach (IntPtr h in new[] { input, output, error }) SetHandleInformation(h, 1, 1);
      SetConsoleCtrlHandler(IntPtr.Zero, false);
      var si = new STARTUPINFO();
      si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
      si.dwFlags = 0x100;
      si.hStdInput = input; si.hStdOutput = output; si.hStdError = error;
      PROCESS_INFORMATION pi;
      if (!CreateProcess(null, args[2], IntPtr.Zero, IntPtr.Zero, true, 0x400, IntPtr.Zero, args[1], ref si, out pi)) return 3;
      SetConsoleCtrlHandler(IntPtr.Zero, true);
      Console.Error.WriteLine("console-host child " + pi.dwProcessId);
      WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
      uint code;
      GetExitCodeProcess(pi.hProcess, out code);
      return (int)code;
    }
    if (args.Length == 2 && args[0] == "ctrlc") {
      FreeConsole();
      if (!AttachConsole(uint.Parse(args[1]))) return 4;
      SetConsoleCtrlHandler(IntPtr.Zero, true);
      if (!GenerateConsoleCtrlEvent(0, 0)) return 5;
      System.Threading.Thread.Sleep(300);
      FreeConsole();
      return 0;
    }
    return 2;
  }
}`;

// A controlled fake Codex CLI (no provider): answers preflight, then reports an accepted turn and
// holds it until <pid file>.release exists. SHUTDOWN_FAKE_TOOL_CHILD=1 first starts a "tool"
// child that inherits its stdout, like a real CLI running a long command.
const fakeCodex = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
public static class FakeCodex {
  public static int Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex-cli 0.160.0"); return 0; }
    if (Array.IndexOf(args, "--help") >= 0) { Console.WriteLine("--json --model --sandbox --cd --skip-git-repo-check --output-schema --config"); return 0; }
    if (Array.IndexOf(args, "login") >= 0) { Console.WriteLine("Logged in using ChatGPT"); return 0; }
    if (Array.IndexOf(args, "mcp") >= 0 && Array.IndexOf(args, "list") >= 0) { Console.WriteLine("[]"); return 0; }
    string pidFile = Environment.GetEnvironmentVariable("SHUTDOWN_FAKE_PID");
    if (Array.IndexOf(args, "--tool-child") >= 0) {
      File.WriteAllText(pidFile + ".tool", Process.GetCurrentProcess().Id.ToString());
      Thread.Sleep(120000);
      return 0;
    }
    if (Environment.GetEnvironmentVariable("SHUTDOWN_FAKE_TOOL_CHILD") == "1") {
      var psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--tool-child");
      psi.UseShellExecute = false; psi.CreateNoWindow = true;
      psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
      Process.Start(psi);
    }
    File.WriteAllText(pidFile, Process.GetCurrentProcess().Id.ToString());
    Console.WriteLine("{\"type\":\"thread.started\",\"thread_id\":\"console-session\"}");
    Console.WriteLine("{\"type\":\"turn.started\"}");
    Console.Out.Flush();
    for (int waited = 0; waited < 120000; waited += 50) {
      if (File.Exists(pidFile + ".release")) {
        Console.WriteLine("{\"type\":\"item.completed\",\"item\":{\"id\":\"answer\",\"type\":\"agent_message\",\"text\":\"Released\"}}");
        Console.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}");
        Console.Out.Flush();
        return 0;
      }
      Thread.Sleep(50);
    }
    return 0;
  }
}`;

let tools = '';
beforeAll(async () => {
  if (!windows) return;
  tools = await mkdtemp(join(tmpdir(), 'gg-console-tools-'));
  for (const [name, source] of [
    ['console-tool', consoleTool],
    ['fake-codex', fakeCodex],
  ] as const) {
    await writeFile(join(tools, `${name}.cs`), source);
    const compiled = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -TypeDefinition (Get-Content -Raw '${join(tools, `${name}.cs`)}') -OutputAssembly '${join(tools, `${name}.exe`)}' -OutputType ConsoleApplication`,
      ],
      { windowsHide: true, encoding: 'utf8' },
    );
    if (compiled.status !== 0) throw new Error(`Could not compile ${name}: ${compiled.stderr}`);
  }
}, 120_000);
afterAll(async () => {
  if (tools) await rm(tools, { recursive: true, force: true, maxRetries: 10 });
});

const started: number[] = [];
const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
const hosts: ChildProcess[] = [];
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
afterEach(async () => {
  for (const host of hosts.splice(0))
    if (host.exitCode === null && host.pid !== undefined) process.kill(host.pid);
  for (const pid of started.splice(0)) if (alive(pid)) process.kill(pid);
  for (const f of fixtures.splice(0)) await f.dispose();
}, 60_000);

async function gateway(extra: NodeJS.ProcessEnv) {
  const f = await createApiProcessFixture({ prefix: 'gg-console-' });
  fixtures.push(f);
  const token = await f.createKey();
  const binary = join(f.dataDir, 'fake-codex.exe');
  await copyFile(join(tools, 'fake-codex.exe'), binary);
  const pidFile = join(f.dataDir, 'harness.pid');
  const env = {
    ...f.env,
    GG_CODEX_BINARY: binary,
    SHUTDOWN_FAKE_PID: pidFile,
    GG_SHUTDOWN_GRACE_MS: '300000',
    ...extra,
  };
  const origin = `http://127.0.0.1:${f.port}`;
  const headers = { authorization: `Bearer ${token}` };
  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return (await response.json()) as Record<string, unknown>;
  }
  const phase = () => call('GET', '/system/shutdown');
  const run = async (id: string) => (await call('GET', `/runs/${id}`)) as unknown as RunRecord;
  async function startTurn() {
    const nodes: LoopDefinitionInput['nodes'] = [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Held turn',
        config: { harness: 'codex', prompt: { template: 'Controlled fixture; no provider call' } },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ];
    const created = await call('POST', '/loops', {
      definition: {
        schemaVersion: 4,
        name: 'Console shutdown',
        nodes,
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
          { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
        ],
      },
    });
    const loopId = (created['loop'] as { id: string }).id;
    await call('POST', `/loops/${loopId}/publish`);
    const runId = ((await call('POST', `/loops/${loopId}/runs`, {}))['run'] as { id: string }).id;
    let cli = 0;
    await eventually(async () => {
      cli = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
      return cli > 0;
    });
    started.push(cli);
    return { runId, cli };
  }
  async function restarted() {
    const child = f.run([], env);
    await f.ready(child, token);
    return child;
  }
  return { f, env, call, phase, run, startTurn, restarted, pidFile };
}

/** Start the built gateway attached to a console of its own, as in a terminal window. */
async function inConsole(env: NodeJS.ProcessEnv) {
  const host = spawn(
    join(tools, 'console-tool.exe'),
    ['host', apiRoot, `"${process.execPath}" "${entry}"`],
    { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  hosts.push(host);
  let output = '';
  host.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  host.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  const exit = new Promise<number | null>((resolve) => host.once('exit', resolve));
  await eventually(() => {
    if (host.exitCode !== null) throw new Error(`Console gateway exited during startup: ${output}`);
    return output.includes('GraphGoblin API listening');
  });
  const gatewayPid = Number(/console-host child (\d+)/.exec(output)?.[1]);
  started.push(gatewayPid);
  return {
    exit,
    ctrlC() {
      const sent = spawnSync(join(tools, 'console-tool.exe'), ['ctrlc', String(host.pid)], {
        windowsHide: true,
      });
      expect(sent.status).toBe(0);
    },
    /** After a Ctrl+C, wait for a normal drain; a gateway that exits instead never drained. */
    async draining(phase: () => Promise<Record<string, unknown>>) {
      await eventually(async () => {
        const state = await phase().catch(async (error: unknown) => {
          await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 2000))]);
          if (host.exitCode !== null)
            throw new Error(
              `The gateway exited with code ${host.exitCode} after one Ctrl+C instead of draining`,
            );
          throw error;
        });
        return state['phase'] === 'draining';
      });
    },
  };
}

it.skipIf(!windows)(
  'one terminal Ctrl+C drains while a running Codex turn keeps running, then completes when it finishes',
  async () => {
    const g = await gateway({});
    const gw = await inConsole(g.env);
    const { runId, cli } = await g.startTurn();
    gw.ctrlC();
    await gw.draining(g.phase);
    // A provider CLI sharing the gateway's console dies with STATUS_CONTROL_C_EXIT within
    // milliseconds of the keypress; observe a window well past that.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await g.phase()).toMatchObject({ phase: 'draining', activeRunIds: [runId] });
    expect((await g.run(runId)).status).toBe('running');
    expect(alive(cli)).toBe(true);
    await writeFile(g.pidFile + '.release', 'finish');
    expect(await gw.exit).toBe(0);
    await expect(access(g.f.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = await g.restarted();
    expect(await g.run(runId)).toMatchObject({ status: 'succeeded' });
    await g.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);

it.skipIf(!windows)(
  'a later terminal Ctrl+C explicitly forces the running Codex turn',
  async () => {
    const g = await gateway({});
    const gw = await inConsole(g.env);
    const { runId, cli } = await g.startTurn();
    gw.ctrlC();
    await gw.draining(g.phase);
    // A deliberate second keypress is outside the one-second signal coalescing window.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(alive(cli)).toBe(true);
    gw.ctrlC();
    expect(await gw.exit).toBe(0);
    await eventually(() => !alive(cli));
    const restarted = await g.restarted();
    expect(await g.run(runId)).toMatchObject({
      status: 'failed',
      failure: { code: 'RUN_INTERRUPTED_BY_STOP', nodeId: 'infer', resumable: false },
    });
    await g.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);

it.skipIf(!windows)(
  'force over a Codex CLI whose tool process keeps its output open fails cleanup and offers Force exit',
  async () => {
    const g = await gateway({ SHUTDOWN_FAKE_TOOL_CHILD: '1' });
    const child = g.f.run([], g.env);
    await eventually(() => child.stdout.includes('GraphGoblin API listening'));
    const { runId, cli } = await g.startTurn();
    let tool = 0;
    await eventually(async () => {
      tool = Number(await readFile(g.pidFile + '.tool', 'utf8').catch(() => '0'));
      return tool > 0;
    });
    started.push(tool);
    await g.call('POST', '/system/shutdown', { action: 'force' });
    let last: Record<string, unknown> = {};
    await eventually(async () => {
      last = await g.phase();
      return last['phase'] === 'force-failed';
    }, 30_000).catch(() => {
      throw new Error(`Force did not conclude within 30 s: ${JSON.stringify(last)}`);
    });
    expect(last).toMatchObject({ unconfirmedRunIds: [runId], choices: ['force'] });
    expect((await g.run(runId)).failure).toMatchObject({
      code: 'HARNESS_TERMINATION_UNCONFIRMED',
      details: { interruptedByStop: true },
    });
    await eventually(() => !alive(cli));
    expect(alive(tool)).toBe(true);
    expect(await g.call('POST', '/system/shutdown', { action: 'force' })).toMatchObject({
      phase: 'exiting',
    });
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    await expect(access(g.f.lockPath)).resolves.toBeUndefined();
    process.kill(tool);
    const restarted = await g.restarted();
    expect((await g.run(runId)).failure).toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED' });
    await g.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);
