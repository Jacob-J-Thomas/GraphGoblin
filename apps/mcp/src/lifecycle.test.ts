/** Native built-entry evidence; each API/store and stdio child is disposable. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createTestApp } from '@graphgoblin/api/testing';
import { minimalLoop } from '@graphgoblin/contracts/testing';

const entry = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

function launch(args: string[]) {
  if (!existsSync(entry)) throw new Error('Missing built MCP entry; run pnpm build first');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
  );
  const child = spawn(process.execPath, [entry, ...args], { env, windowsHide: true });
  children.push(child);
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    errors += text;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  void exited.catch(() => undefined);
  return { child, exited, errors: () => errors };
}

class NativeStdio implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();
  constructor(private readonly process: ReturnType<typeof launch>) {}
  start(): Promise<void> {
    this.process.child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.buffer.append(chunk);
        for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage())
          this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    void this.process.exited.then(
      () => this.onclose?.(),
      (error: Error) => this.onerror?.(error),
    );
    return Promise.resolve();
  }
  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) =>
      this.process.child.stdin.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  async close(): Promise<void> {
    this.process.child.stdin.end();
    await this.process.exited;
  }
}

async function connected() {
  const api = await createTestApp();
  try {
    const url = await api.app.listen({ host: '127.0.0.1', port: 0 });
    const loopId = await api.publishLoop(minimalLoop());
    const process = launch(['--api-url', url]);
    const client = new Client({ name: 'native-lifecycle', version: '1' });
    await client.connect(new NativeStdio(process), { timeout: 20_000 });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('list_loops');
    const result = await client.callTool({ name: 'list_loops', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [expect.objectContaining({ id: loopId })],
    });
    return { api, client, ...process };
  } catch (error) {
    await api.close();
    throw error;
  }
}

it('connects over stdio, lists tools, calls a disposable API and exits 0 on stdin EOF', async () => {
  const fixture = await connected();
  try {
    // End input explicitly; no signal or forced SDK fallback may establish this assertion.
    fixture.child.stdin.end();
    expect(await fixture.exited).toEqual({ code: 0, signal: null });
    expect(fixture.errors()).toContain('stdio (gateway');
  } finally {
    await fixture.client.close();
    await fixture.api.close();
  }
}, 60_000);

it.skipIf(process.platform !== 'linux').each(['SIGTERM', 'SIGINT'] as const)(
  'exits 0 on native %s (Linux only; win32 force-kills without JS signal handlers)',
  async (signal) => {
    const fixture = await connected();
    try {
      fixture.child.kill(signal);
      expect(await fixture.exited).toEqual({ code: 0, signal: null });
    } finally {
      await fixture.client.close();
      await fixture.api.close();
    }
  },
  60_000,
);

it('reports invalid CLI configuration with exit 2 and no protocol stdout', async () => {
  const fixture = launch(['--unknown-option']);
  let stdout = '';
  fixture.child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  expect(await fixture.exited).toEqual({ code: 2, signal: null });
  expect(stdout).toBe('');
  expect(fixture.errors()).toContain('Usage:');
}, 60_000);

it('reports a rejected HTTP entry startup with exit 1', async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('missing occupied port');
    const fixture = launch([
      '--http',
      '--port',
      String(address.port),
      '--api-url',
      'http://127.0.0.1:1',
    ]);
    expect(await fixture.exited).toEqual({ code: 1, signal: null });
    expect(fixture.errors()).toContain('EADDRINUSE');
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 60_000);
