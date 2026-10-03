import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const MCP_PATH = '/mcp';

export interface HttpServerOptions {
  /** Builds a fresh MCP server per request (stateless Streamable HTTP). */
  createServer: () => McpServer;
  host: string;
  port: number;
}

export interface RunningHttpServer {
  /** The MCP endpoint, for example `http://127.0.0.1:4748/mcp`. */
  url: string;
  server: Server;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

/** The Host header's hostname, without the port. */
function hostname(header = ''): string {
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1);
  return header.split(':')[0] as string;
}

/**
 * Serve MCP over Streamable HTTP at `/mcp` in stateless mode: every POST gets its own server and
 * transport, so no session state lives in the process. When bound to a loopback address, requests
 * whose Host header is not a loopback name are refused (DNS rebinding protection).
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const loopbackOnly = LOOPBACK.has(options.host);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = String(req.url).split('?')[0];
    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: 'not found', endpoint: MCP_PATH });
      return;
    }
    if (loopbackOnly && !LOOPBACK.has(hostname(req.headers.host))) {
      rpcError(res, 403, 'Forbidden: host not allowed');
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      rpcError(res, 405, 'Method not allowed: this server is stateless; use POST');
      return;
    }
    const mcp = options.createServer();
    const transport = new StreamableHTTPServerTransport({}); // no sessionIdGenerator: stateless
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    // The SDK's transport class declares optional callbacks that exactOptionalPropertyTypes rejects.
    await mcp.connect(transport as Transport);
    await transport.handleRequest(req, res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) rpcError(res, 500, `Internal error: ${(error as Error).message}`);
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: `http://${host}:${address.port}${MCP_PATH}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
