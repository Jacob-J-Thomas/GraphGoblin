// Minimal MCP stdio client for QA: spawns the built MCP server against a disposable API.
import { spawn } from 'node:child_process';
import { mcpEntry } from './lib.mjs';

export async function mcpSession(apiUrl) {
  const child = spawn(process.execPath, [mcpEntry, '--api-url', apiUrl], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([n]) => !n.toUpperCase().startsWith('GG_'))),
  });
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out: ${stderr}`)), 30_000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const init = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'gg-qa-d1', version: '0.0.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return {
    serverInfo: init.result?.serverInfo,
    async tool(name, args) {
      const response = await request('tools/call', { name, arguments: args });
      if (response.error) throw new Error(`MCP ${name}: ${JSON.stringify(response.error)}`);
      const result = response.result;
      const text = result.content?.map((c) => c.text).join('\n') ?? '';
      return { isError: Boolean(result.isError), text, structured: result.structuredContent };
    },
    async tools() {
      const response = await request('tools/list', {});
      return response.result.tools;
    },
    async close() {
      child.stdin.end();
      child.kill();
      await new Promise((r) => child.once('close', r));
    },
  };
}
