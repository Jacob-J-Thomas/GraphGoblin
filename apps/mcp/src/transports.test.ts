/**
 * Both transport entry points through `main`: Streamable HTTP on port 0 driven by the SDK's HTTP
 * client, and stdio over in-memory streams driven by the SDK client.
 */
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { main, startHttpServer } from './index.js';

/** The client half of a stdio connection over a pair of in-process streams. */
class StreamClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();
  constructor(
    private readonly toServer: PassThrough,
    private readonly fromServer: PassThrough,
  ) {}
  start(): Promise<void> {
    this.fromServer.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) {
        this.onmessage?.(message);
      }
    });
    return Promise.resolve();
  }
  send(message: JSONRPCMessage): Promise<void> {
    this.toServer.write(serializeMessage(message));
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.toServer.end();
    this.onclose?.();
    return Promise.resolve();
  }
}

function rawRequest(
  url: string,
  options: { method: string; host?: string },
): Promise<{ status: number; body: string; allow?: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: options.method,
        headers: {
          ...(options.host ? { host: options.host } : {}),
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            ...(res.headers.allow ? { allow: res.headers.allow } : {}),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.method === 'POST' ? '{}' : undefined);
  });
}

describe('transports', () => {
  let t: TestApp;
  let apiUrl: string;
  let loopId: string;
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    apiUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    loopId = await t.publishLoop(minimalLoop());
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves Streamable HTTP from main --http on an ephemeral port', async () => {
    const started = await main(['--http', '--port', '0', '--api-url', apiUrl], {}, { log });
    expect(started.exitCode).toBe(0);
    const url = started.url as string;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(logs.at(-1)).toContain('Streamable HTTP');
    try {
      const client = new Client({ name: 'http-test', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url)) as Transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(14);
      const result = await client.callTool({ name: 'start_run', arguments: { loopId } });
      const { runId } = JSON.parse((result.content as { text: string }[])[0]!.text);
      const waited = await client.callTool({ name: 'wait_for_run', arguments: { runId } });
      expect((waited.structuredContent as { finished: boolean }).finished).toBe(true);
      await client.close();

      const get = await rawRequest(url, { method: 'GET' });
      expect(get).toMatchObject({ status: 405, allow: 'POST' });
      const other = await rawRequest(url.replace('/mcp', '/other'), { method: 'GET' });
      expect(other.status).toBe(404);
      const rebound = await rawRequest(url, { method: 'POST', host: 'evil.example:80' });
      expect(rebound.status).toBe(403);
      const v6 = await rawRequest(url, { method: 'GET', host: '[::1]:1' });
      expect(v6.status).toBe(405);
    } finally {
      await started.close();
    }
  });

  it('answers 500 when building the server fails and allows any Host off loopback', async () => {
    const failing = await startHttpServer({
      createServer: () => {
        throw new Error('no server');
      },
      host: '0.0.0.0',
      port: 0,
    });
    try {
      const port = new URL(failing.url).port;
      const response = await rawRequest(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        host: 'anything.example',
      });
      expect(response.status).toBe(500);
      expect(response.body).toContain('no server');
    } finally {
      await failing.close();
    }
  });

  it('binds IPv6 loopback and rejects a port that is in use', async () => {
    const first = await startHttpServer({
      createServer: () => new McpServer({ name: 'x', version: '1' }),
      host: '::1',
      port: 0,
    });
    try {
      expect(first.url).toMatch(/^http:\/\/\[::1\]:\d+\/mcp$/);
      const port = Number(new URL(first.url).port);
      await expect(
        startHttpServer({ createServer: () => first as never, host: '::1', port }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });

  it('serves stdio from main by default', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const seen: Request[] = [];
    const started = await main(
      ['--api-key', 'local-key'],
      { GG_API_URL: apiUrl },
      {
        stdin,
        stdout,
        log,
        fetch: (request) => {
          seen.push(request);
          // Local trusted mode would reject an unknown key, so strip it after recording it.
          const headers = new Headers(request.headers);
          headers.delete('authorization');
          return fetch(new Request(request, { headers }));
        },
        tools: { pollMs: 5 },
      },
    );
    expect(started.exitCode).toBe(0);
    expect(logs.at(-1)).toContain(`stdio (gateway ${apiUrl})`);
    const client = new Client({ name: 'stdio-test', version: '1' });
    await client.connect(new StreamClientTransport(stdin, stdout));
    const result = await client.callTool({ name: 'list_loops', arguments: {} });
    expect((result.structuredContent as { items: { id: string }[] }).items[0]?.id).toBe(loopId);
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer local-key');
    await client.close();
    await started.close();
  });

  it('prints usage for --help and exits 2 on bad flags', async () => {
    const help = await main(['--help'], {}, { log });
    expect(help.exitCode).toBe(0);
    expect(logs.at(-1)).toContain('Usage: graphgoblin-mcp');
    await help.close();
    const bad = await main(['--port', 'nope'], {}, { log });
    expect(bad.exitCode).toBe(2);
    expect(logs.at(-1)).toMatch(/^graphgoblin-mcp: invalid port "nope"/);
  });
});
