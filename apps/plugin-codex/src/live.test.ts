/**
 * LIVE=1 only: one real Codex session drives the GraphGoblin MCP server against an in-process API
 * with the fake harness. Needs `pnpm build` (Codex launches `apps/mcp/dist/main.js`), the Codex CLI
 * on PATH, and a logged-in Codex. Uses model gpt-6-luna at low effort.
 *
 *   LIVE=1 pnpm --filter @graphgoblin/plugin-codex exec vitest run src/live.test.ts
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp } from '@graphgoblin/api/testing';
import { defaultPaths } from './index.js';

const LIVE = process.env['LIVE'] === '1';

/** The Codex CLI's JavaScript entry, found next to the npm shim on PATH. */
function codexEntry(): string {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    const candidate = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('codex CLI not found on PATH');
}

function runCodex(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [codexEntry(), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? -1, stdout }));
  });
}

describe.skipIf(!LIVE)('live Codex session', () => {
  it('lists loops, starts one, and reads its result through the MCP server', async () => {
    const packageDir = resolve(fileURLToPath(import.meta.url), '..', '..');
    const { mcpEntry } = defaultPaths(packageDir);
    expect(existsSync(mcpEntry), 'run pnpm build first').toBe(true);

    const t = await createTestApp();
    const cwd = await mkdtemp(join(tmpdir(), 'gg-live-'));
    try {
      await t.app.listen({ port: 0, host: '127.0.0.1' });
      const apiUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
      await t.publishLoop({ ...minimalLoop(), name: 'live-check' });

      const { code, stdout } = await runCodex(
        [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          '--ignore-user-config',
          '-m',
          'gpt-6-luna',
          '-c',
          'model_reasoning_effort="low"',
          '-s',
          'read-only',
          '-c',
          'approval_policy="never"',
          '-c',
          'mcp_servers.graphgoblin.command="node"',
          '-c',
          `mcp_servers.graphgoblin.args=['${mcpEntry}']`,
          '-c',
          `mcp_servers.graphgoblin.env={GG_API_URL="${apiUrl}"}`,
          '-c',
          'mcp_servers.graphgoblin.default_tools_approval_mode="approve"',
          'Use the graphgoblin MCP tools: call list_loops, then start_run for the loop named live-check, then wait_for_run on the returned runId. Reply with the loop names and the final run status only.',
        ],
        cwd,
      );
      // Keep the transcript for the record (ignored by git).
      await mkdir(join(packageDir, '.tmp'), { recursive: true });
      await writeFile(join(packageDir, '.tmp', 'live-codex.jsonl'), stdout);
      expect(code).toBe(0);
      const events = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as { type: string; item?: Record<string, unknown> });
      const calls = events
        .filter((e) => e.type === 'item.completed' && e.item?.['type'] === 'mcp_tool_call')
        .map((e) => e.item as { server: string; tool: string; status: string });
      expect(calls.map((c) => `${c.server}.${c.tool}`)).toEqual(
        expect.arrayContaining([
          'graphgoblin.list_loops',
          'graphgoblin.start_run',
          'graphgoblin.wait_for_run',
        ]),
      );
      const runs = await t.app.inject({ method: 'GET', url: '/runs' });
      const items = runs.json<{ items: { status: string; id: string }[] }>().items;
      expect(items[0]?.status).toBe('succeeded');
      const thread = await t.app.inject({ method: 'GET', url: `/runs/${items[0]?.id}/thread` });
      expect(thread.json<{ invocation: { source: string } }>().invocation.source).toBe(
        'manual.mcp',
      );
    } finally {
      await t.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 300_000);
});
