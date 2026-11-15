import assert from 'node:assert/strict';
import { execFile, fork, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { lstat, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { digest, root, save } from './binding.mjs';

export const stamp = () => new Date().toISOString();
export const boundImport = (binding, module) => import(pathToFileURL(binding.dependencies[module].path).href);
export const allowedPort = (port) => Number.isInteger(port) && port > 0 && ![4747, 4748].includes(port);

export async function within(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + label)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function processEnvironment(data, nodePath) {
  const windows = process.env.SystemRoot;
  assert(windows && process.platform === 'win32');
  return {
    SystemRoot: windows, WINDIR: windows,
    PATH: [dirname(nodePath), join(windows, 'System32'), windows].join(';'),
    TEMP: data, TMP: data, HOME: data, USERPROFILE: data, APPDATA: data, LOCALAPPDATA: data,
    CODEX_HOME: join(data, 'empty-codex-home'), CLAUDE_CONFIG_DIR: join(data, 'empty-claude-home'),
  };
}

// Edge's Windows folder/identity lookup needs the desktop environment. Preserve the
// allowlisted OS keys only for Edge. The explicit profile and temp dirs remain disposable.
function edgeEnvironment(temp, nodePath) {
  const { SystemRoot, WINDIR, PATH, TEMP, TMP } = processEnvironment(temp, nodePath);
  const identityKeys = [
    'ALLUSERSPROFILE', 'APPDATA', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432',
    'COMPUTERNAME', 'ComSpec', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'LOGONSERVER',
    'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SESSIONNAME', 'SystemDrive',
    'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE', 'USERNAME', 'USERPROFILE',
  ];
  const identity = Object.fromEntries(identityKeys.flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  return { ...identity, SystemRoot, WINDIR, PATH, TEMP, TMP };
}

export function track(child, label, processes) {
  const record = { label, pid: child.pid ?? null, launchedAt: stamp() };
  const item = { child, record };
  processes.push(item);
  item.exited = new Promise((resolve) => {
    child.once('error', (error) => { record.spawnError = error.message; });
    child.once('close', (code, signal) => {
      record.exit = { code, signal, at: stamp() };
      resolve(record.exit);
    });
  });
  return item;
}

export async function startGateway(tier, binding, data, out, bounds, processes) {
  const log = await open(join(out, tier + '-gateway.log'), 'wx');
  let child;
  let item;
  const messages = new Map();
  let publishReady;
  const ready = new Promise((resolve) => { publishReady = resolve; });
  try {
    child = fork(join(root, 'gateway.mjs'), [binding.checkout, tier], {
      cwd: data, execPath: binding.nodePath, execArgv: [], windowsHide: true,
      env: { ...processEnvironment(data, binding.nodePath),
        GG_DATA_DIR: data, GG_DB_URL: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/'),
        GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false', GG_SWAGGER_UI: 'false',
        GG_OLLAMA_ENABLED: 'false', GG_GOBLIN_DIST: '', GG_LOG_LEVEL: 'info',
        GG_WEB_DIST: join(binding.checkout, 'apps/web/dist'),
        GG_CODEX_BINARY: join(data, 'no-codex.exe'), GG_CLAUDE_BINARY: join(data, 'no-claude.exe'),
      },
      stdio: ['ignore', log.fd, log.fd, 'ipc'],
    });
    item = track(child, tier, processes);
    child.on('message', (message) => {
      if (message.type === 'ready') publishReady(message);
      else messages.get(message.id)?.(message);
    });
  } finally {
    await log.close();
  }
  const info = await within(Promise.race([ready, item.exited.then(() => null)]), bounds.startup, tier + ' gateway ready');
  assert(info, 'Gateway exited before ready: ' + tier);
  assert.equal(info.pid, child.pid);
  assert.equal(info.host, '127.0.0.1');
  assert.equal(info.cwd, data);
  assert.equal(info.tier, tier);
  assert(allowedPort(info.port));
  item.origin = 'http://127.0.0.1:' + info.port;
  item.record.ready = info;
  item.record.db = await realpath(join(data, 'graphgoblin.db'));
  assert.equal(item.record.db, join(data, 'graphgoblin.db'));
  const stat = await lstat(item.record.db, { bigint: true });
  item.record.dbIdentity = { dev: String(stat.dev), ino: String(stat.ino), born: String(stat.birthtimeMs) };
  let next = 1;
  item.control = async (command, value, ms = bounds.request) => {
    assert.equal(tier, 'composed');
    const id = next++;
    try {
      const result = await within(new Promise((resolve, reject) => {
        messages.set(id, resolve);
        child.send({ id, command, value }, (error) => { if (error) reject(error); });
      }), ms, 'gateway IPC ' + command);
      assert(!result.error, result.error);
      return result;
    } finally {
      messages.delete(id);
    }
  };
  return item;
}

export async function rest(origin, method, path, ms, body, headers = {}) {
  const content = body === undefined ? undefined : JSON.stringify(body);
  const network = { method, headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(ms),
    redirect: 'error' };
  if (content !== undefined) {
    network.body = content;
    network.headers['content-type'] = 'application/json';
  }
  const response = await fetch(origin + path, network);
  const text = await response.text();
  const record = { method, path, requestBody: body, status: response.status, text,
    contentType: response.headers.get('content-type'), pid: response.headers.get('x-graphgoblin-pid'),
    instance: response.headers.get('x-graphgoblin-instance') };
  try { record.body = JSON.parse(text); } catch { /* retain raw bytes before asserting an oracle */ }
  return record;
}

export async function stopGateway(item, bounds) {
  if (item.record.exit) {
    assert.deepEqual([item.record.exit.code, item.record.exit.signal], [0, null]);
    return;
  }
  assert(item.origin, 'No verified gateway origin to drain');
  const health = await rest(item.origin, 'GET', '/healthz', bounds.request);
  assert.equal(health.status, 200);
  assert.equal(health.pid, String(item.child.pid));
  if (item.record.instance) assert.equal(health.instance, item.record.instance);
  const state = await rest(item.origin, 'GET', '/system/shutdown', bounds.request);
  assert.equal(state.status, 200);
  assert.equal(state.body.phase, 'running');
  assert.deepEqual(state.body.activeRunIds, []);
  assert.equal(typeof state.body.controlToken, 'string');
  const answer = await rest(item.origin, 'POST', '/system/shutdown', bounds.request, { action: 'drain' },
    { 'x-graphgoblin-shutdown-token': state.body.controlToken });
  item.record.drain = { status: answer.status, phase: answer.body?.phase, activeRunIds: answer.body?.activeRunIds };
  assert.equal(answer.status, 202);
  const exit = await within(item.exited, bounds.cleanup, 'gateway drain ' + item.child.pid);
  assert.deepEqual([exit.code, exit.signal], [0, null]);
}

export async function checkClosedPort(port, ms) {
  assert(allowedPort(port));
  await within(new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(ms);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('Owned port still listening: ' + port));
    });
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Indeterminate port readback: ' + port));
    });
  }), ms + 250, 'owned listener closed');
}

// Windows can retain libsql file handles after Client.close(). Test the actual sharing mode
// of every present SQLite file after parent GC, while all handles are held simultaneously.
export async function confirmSqliteRelease(binding, directories, knownDatabases, ms) {
  const paths = [];
  const examined = [];
  for (const dir of directories) {
    let entries;
    try {
      assert.equal(await realpath(dir), dir);
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' && !knownDatabases.includes(join(dir, 'graphgoblin.db'))) continue;
      throw error;
    }
    for (const name of ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm']) {
      const path = join(dir, name);
      const entry = entries.find((entry) => entry.name === name);
      examined.push({ path, present: Boolean(entry) });
      if (entry === undefined) {
        assert(!knownDatabases.includes(path), 'A bound database is missing: ' + path);
        continue;
      }
      assert(entry.isFile() && await realpath(path) === path, 'Unexpected SQLite file: ' + path);
      paths.push(path);
    }
  }
  if (paths.length === 0) {
    return { examined, handles: [], allPresentSqliteFilesHeldAtOnce: null, status: 'no SQLite files present' };
  }
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$paths = ConvertFrom-Json -InputObject $env:GG381_QA_SQLITE_FILES',
    'if ($paths -isnot [array]) { throw "Expected a SQLite path array" }',
    '$handles = [System.Collections.Generic.List[System.IO.FileStream]]::new()',
    '$checks = @()',
    '$failed = $null',
    'try {',
    '  foreach ($path in $paths) {',
    '    if ($path -isnot [string] -or [string]::IsNullOrWhiteSpace($path)) { throw "Unexpected SQLite path value" }',
    '    $file = Get-Item -LiteralPath $path -Force',
    '    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.FullName -cne $path) { throw "Unexpected SQLite file identity" }',
    '    $handle = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)',
    '    $handles.Add($handle)',
    '    $checks += @{ path = $path; acquired = $true }',
    '  }',
    '} catch {',
    '  $cause = $_.Exception.GetBaseException()',
    '  $failed = @{ path = $path; hresult = $cause.HResult; message = $cause.Message }',
    '} finally {',
    '  foreach ($handle in $handles) { $handle.Dispose() }',
    '}',
    'ConvertTo-Json -Compress -Depth 4 -InputObject @{ handles = $checks; failure = $failed; allPresentSqliteFilesHeldAtOnce = ($null -eq $failed -and $checks.Count -eq $paths.Count) }',
  ].join('\n');
  const windows = process.env.SystemRoot;
  const probe = new Promise((resolve, reject) => execFile(
    join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { env: { ...processEnvironment(dirname(directories[0]), binding.nodePath),
        GG381_QA_SQLITE_FILES: JSON.stringify(paths) }, timeout: ms, windowsHide: true },
    (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    },
  ));
  const receipt = await within(probe, ms + 500, 'exclusive SQLite handle readback');
  if (receipt.allPresentSqliteFilesHeldAtOnce) {
    assert.deepEqual(receipt.handles.map((handle) => handle.path), paths);
    assert(receipt.handles.every((handle) => handle.acquired));
  }
  return { examined, ...receipt };
}

export async function startMcp(binding, gateway, data, out, bounds, processes) {
  const { Client } = await boundImport(binding, 'mcpClient');
  const { ReadBuffer, serializeMessage } = await boundImport(binding, 'mcpStdio');
  const child = spawn(binding.nodePath, [join(binding.checkout, 'apps/mcp/dist/main.js'), '--api-url', gateway.origin],
    { cwd: data, env: processEnvironment(data, binding.nodePath), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const name = gateway.record.label === 'native' ? 'mcp' : 'composed-mcp';
  const mcp = track(child, name, processes);
  mcp.record.gatewayPid = gateway.child.pid;
  mcp.record.gatewayOrigin = gateway.origin;
  const buffer = new ReadBuffer();
  child.stdout.on('data', (chunk) => appendFileSync(join(out, name + '-stdout.ndjson'), chunk));
  child.stderr.on('data', (chunk) => appendFileSync(join(out, name + '-stderr.log'), chunk));
  const transport = {
    start() {
      child.stdout.on('data', (chunk) => {
        try {
          buffer.append(chunk);
          for (let message = buffer.readMessage(); message; message = buffer.readMessage()) this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(error);
        }
      });
      child.stdin.on('error', (error) => this.onerror?.(error));
      void mcp.exited.then(() => this.onclose?.());
      return Promise.resolve();
    },
    send(message) {
      const text = serializeMessage(message);
      appendFileSync(join(out, name + '-stdin.ndjson'), text);
      return new Promise((resolve, reject) => child.stdin.write(text, (error) => error ? reject(error) : resolve()));
    },
    async close() {
      child.stdin.end();
      await within(mcp.exited, bounds.cleanup, 'MCP stdio EOF');
    },
  };
  mcp.close = async () => {
    await transport.close();
    assert.deepEqual([mcp.record.exit.code, mcp.record.exit.signal], [0, null]);
  };
  const client = new Client({ name: 'graphgoblin-381-independent-qa', version: '1.0.0' });
  await client.connect(transport, { timeout: bounds.request });
  mcp.call = (name, args, ms = bounds.request) => client.callTool({ name, arguments: args }, undefined, { timeout: ms });
  return mcp;
}

export async function browserProcesses(binding, profile, ms, previouslySeen = []) {
  const windows = process.env.SystemRoot;
  const code = [
    '$ErrorActionPreference = "Stop"',
    '$name = $env:GG381_QA_BROWSER',
    '$profilePath = $env:GG381_QA_PROFILE',
    '$seen = ConvertFrom-Json -InputObject $env:GG381_QA_BROWSER_RECORDS',
    'if ($seen -isnot [array]) { throw "Expected an array of browser process identities" }',
    'foreach ($item in $seen) { if (($item.pid -isnot [int] -and $item.pid -isnot [long]) -or $item.pid -le 0 -or $item.creation -isnot [string] -or [string]::IsNullOrWhiteSpace($item.creation)) { throw "Unexpected browser process identity" } }',
    "$all = @(Get-CimInstance -ClassName Win32_Process -Filter (\"Name='\" + $name + \"'\"))",
    '$owned = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })',
    '$ids = @($owned | ForEach-Object ProcessId)',
    'foreach ($p in $all) { if ($seen | Where-Object { $_.pid -eq $p.ProcessId -and $_.creation -eq $p.CreationDate.ToUniversalTime().ToString("o") }) { $ids += $p.ProcessId } }',
    'do { $prior = $ids.Count; $ids += @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object ProcessId) } while ($ids.Count -gt $prior)',
    '$details = @($all | Where-Object { $_.ProcessId -in $ids } | ForEach-Object { @{ pid=$_.ProcessId; parent=$_.ParentProcessId; creation=$_.CreationDate.ToUniversalTime().ToString("o") } })',
    'ConvertTo-Json -Compress -InputObject $details',
  ].join('\n');
  const name = basename(binding.browserPath);
  assert.match(name, /^[a-z0-9._-]+\.exe$/iu);
  const inspection = new Promise((resolve, reject) => execFile(
    join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code],
    { env: { ...processEnvironment(dirname(profile), binding.nodePath),
        GG381_QA_BROWSER: name, GG381_QA_PROFILE: profile, GG381_QA_BROWSER_RECORDS: JSON.stringify(previouslySeen) },
      timeout: ms, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)),
  ));
  return within(inspection, ms + 500, 'owned browser process readback');
}

export async function launchOwnedEdge(binding, profile, startup, browserState) {
  if (browserState.context) return browserState.context;
  const { chromium } = await boundImport(binding, 'playwright');
  const temp = dirname(profile);
  assert.equal(await realpath(temp), temp, 'Expected the owned Edge temp directory');
  const env = edgeEnvironment(temp, binding.nodePath);
  if (env.LOCALAPPDATA) {
    const defaultProfile = join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
    assert.notEqual(profile.toLowerCase(), defaultProfile.toLowerCase());
  }
  browserState.environmentKeys = Object.keys(env).sort();
  browserState.temp = temp;
  browserState.attempted = true;
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: binding.browserPath, headless: true, viewport: { width: 1440, height: 940 },
    serviceWorkers: 'block', timeout: startup, env,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check'],
  });
  browserState.context = context;
  return context;
}

export async function inspectRun({
  binding, gateway, run, code, cause, visibleOperation, profile, out, bounds, browserState, nodeId,
  requestBudget, forbiddenText = [],
}) {
  const pending = [];
  const network = [];
  const consoleOutput = [];
  const path = '/app/runs/' + run.id;
  const context = await launchOwnedEdge(binding, profile, bounds.startup, browserState);
  let captured = false;
  async function capturePage(page) {
    if (captured) return;
    captured = true;
    const html = await within(page.content(), bounds.request, 'inspector DOM artifact');
    await writeFile(join(out, 'inspector-dom.html'), html, { flag: 'wx' });
    await page.screenshot({ path: join(out, 'inspector.png'), fullPage: true, timeout: bounds.request });
    return html;
  }
  let page;
  let inspectionError;
  try {
    browserState.owned = await browserProcesses(binding, profile, requestBudget());
    assert(browserState.owned.length > 0, 'Owned browser profile was not observed');
    page = await context.newPage();
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === gateway.origin) return route.continue();
      network.push({ url: url.origin, decision: 'external request blocked' });
      return route.abort();
    });
    page.setDefaultTimeout(bounds.request);
    page.on('console', (line) => consoleOutput.push({ type: line.type(), text: line.text() }));
    page.on('pageerror', (error) => consoleOutput.push({ type: 'pageerror', text: error.message }));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== gateway.origin) return;
      const record = { path: url.pathname, query: url.search, status: response.status(),
        contentType: response.headers()['content-type'] };
      network.push(record);
      if (record.contentType?.includes('text/event-stream')) return;
      pending.push(response.body().then((body) => {
        record.sha256 = digest(body);
        if (url.pathname.startsWith('/runs/' + run.id)) record.text = body.toString('utf8');
      }, (error) => { record.error = error.message; }));
    });
    await page.goto(gateway.origin + path, { waitUntil: 'domcontentloaded', timeout: requestBudget() });
    await page.waitForLoadState('load', { timeout: requestBudget() });
    const alert = page.getByRole('alert').filter({ hasText: 'Failed: ' + code });
    await alert.waitFor({ state: 'visible', timeout: requestBudget() });
    const timeline = page.getByRole('list', { name: 'Timeline' });
    const failure = timeline.getByText('run.failed', { exact: true });
    await failure.waitFor({ state: 'visible', timeout: requestBudget() });
    const resume = page.getByRole('button', { name: 'Resume', exact: true });
    const reasonId = await resume.getAttribute('aria-describedby', { timeout: requestBudget() });
    assert.equal(reasonId, 'resume-reason-' + run.id);
    const failureText = await alert.innerText({ timeout: requestBudget() });
    const timelineText = await timeline.innerText({ timeout: requestBudget() });
    const resumeText = await page.locator('#' + reasonId).innerText({ timeout: requestBudget() });
    const disabled = await resume.isDisabled({ timeout: requestBudget() });
    assert(failureText.includes(cause), 'Inspector did not surface the evaluator reason');
    assert(timelineText.includes(cause), 'Timeline did not surface the evaluator reason');
    assert.equal(await failure.count(), 1);
    assert.equal(disabled, !run.recovery.resume.allowed);
    if (disabled) {
      assert(resumeText.includes(run.recovery.resume.message));
      assert(!failureText.includes('(resumable)'));
    } else {
      assert(failureText.includes('(resumable)'));
    }
    if (visibleOperation) assert(new RegExp(visibleOperation, 'iu').test(failureText + '\n' + timelineText),
      'Inspector lacks the reviewed visible operation diagnostic');
    const nodePattern = nodeId === 'mut' ? /QA mutation|\bmut\b/u : /\bDone\b|\bdone\b/u;
    assert(nodePattern.test(timelineText), 'Inspector lacks the corresponding subject node');
    const html = await capturePage(page);
    await within(Promise.all(pending), requestBudget(), 'browser response bytes');
    const shell = network.find((response) => response.path === path && response.status === 200);
    assert.equal(shell?.sha256, binding.output['apps/web/dist/index.html']);
    const assets = network.filter((response) => response.path?.startsWith('/app/assets/'));
    assert(assets.some((asset) => /\.[cm]?js$/u.test(asset.path)), 'No bound inspector JavaScript observed');
    for (const asset of assets) {
      assert.equal(asset.status, 200);
      const key = 'apps/web/dist/' + asset.path.slice('/app/'.length);
      assert(binding.output[key], 'Browser used an unbound asset: ' + key);
      assert.equal(asset.sha256, binding.output[key], 'Served inspector asset byte mismatch: ' + key);
    }
    const read = network.find((response) => response.status === 200 && response.path === '/runs/' + run.id);
    assert(read?.text, 'No inspector run GET observed');
    assert.deepEqual(JSON.parse(read.text).failure, run.failure);
    for (const marker of forbiddenText) {
      assert(!html.includes(marker), 'Private marker in served inspector DOM: ' + marker);
      assert(!JSON.stringify(network).includes(marker), 'Private marker in inspector network evidence: ' + marker);
      assert(!JSON.stringify(consoleOutput).includes(marker), 'Private marker in inspector browser console: ' + marker);
    }
    assert(!consoleOutput.some((line) => line.type === 'pageerror'), 'Inspector raised a script error');
    await save(join(out, 'inspector-readback.json'), { failureText, timelineText, resumeText, disabled, url: page.url(),
      ownedProcesses: browserState.owned, browserPath: binding.browserPath,
      profile: relative(dirname(profile), profile), browserVersion: context.browser()?.version() ?? null });
  } catch (error) {
    inspectionError = error;
    if (page) await within(capturePage(page), bounds.request * 2, 'first-failure browser capture').catch(
      (capture) => { consoleOutput.push({ type: 'first-failure capture', text: capture.message }); },
    );
    throw error;
  } finally {
    try {
      await save(join(out, 'inspector-network.json'), network);
      await save(join(out, 'inspector-console.json'), consoleOutput);
    } catch (error) {
      if (!inspectionError) throw error;
      appendFileSync(join(out, 'inspector-cleanup.ndjson'), JSON.stringify({ step: 'save', error: error.message }) + '\n');
    }
    try {
      if (page) await within(page.close(), bounds.cleanup, 'inspector tab close');
    } catch (error) {
      if (!inspectionError) throw error;
      appendFileSync(join(out, 'inspector-cleanup.ndjson'), JSON.stringify({ step: 'tab close', error: error.message }) + '\n');
    }
  }
}
