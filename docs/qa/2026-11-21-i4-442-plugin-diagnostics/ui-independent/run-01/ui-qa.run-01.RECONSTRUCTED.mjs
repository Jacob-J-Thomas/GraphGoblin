// Independent #442 integrated UI/browser QA driver (authored in this phase; see PLAN.md).
// Real built gateway (apps/api/dist/main.js) + real built web (apps/web/dist) + system Edge via the
// repo-installed Playwright library. Labels: NATIVE (real HTTP -> gateway -> fixture child process),
// INTERCEPT (page.route in the browser), DOM-CONTROL (in-page mutation), BASELINE (retained 5b web).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const E = dirname(fileURLToPath(import.meta.url));
const REPO = 'G:/ggq/gg-i4-442-qa/GraphGoblin';
const S = 'G:/ggq/qa-scratch/i4-442-ui-qa';
const MAIN = join(REPO, 'apps/api/dist/main.js');
const CAND_DIST = join(REPO, 'apps/web/dist');
const BASE_DIST = join(S, 'baseline-web-5b');
const FIXTURE = join(E, 'fixture-codex.mjs');
const STATE = join(S, 'fixture/state.json');
const CALLS = join(S, 'fixture/calls.jsonl');
const FORBIDDEN_PORTS = new Set([4747, 4748, 11434]);
// Independent literal (D175 wording, as in the backend packet); cross-checked against the built domain.
const NOTICE =
  'Loaded plugin tools are not verified by this check. Inspect codex plugin list --json and codex mcp list --json in the worker directory; neither proves every enabled plugin loaded. Verify the expected tool in the worker before relying on it.';
const CODES = ['codex plugin list --json', 'codex mcp list --json'];
const ALLOWED_ARGS = ['--version', 'exec --help', 'exec resume --help', 'login status'];
const EXPECT = {
  ready: { label: 'Ready', tone: 'good', problems: null, version: 'v0.160.0' },
  auth: {
    label: 'Sign-in needed',
    tone: 'bad',
    problems: ['Codex sign-in is missing or invalid. Run codex login, then retry preflight.'],
    version: 'v0.160.0',
  },
  quota: {
    label: 'Usage limit',
    tone: 'warn',
    problems: ['Codex account usage limit reached. Wait for the usage limit to reset, then retry preflight.'],
    version: 'v0.160.0',
  },
  transport: {
    label: 'Connection failed',
    tone: 'warn',
    problems: [
      "Codex reported a connection or provider service error. Check the network connection and the provider's service status, then retry preflight.",
    ],
    version: 'v0.160.0',
  },
  unknown: {
    label: 'Unknown',
    tone: 'warn',
    problems: ['Codex readiness could not be confirmed. Check that the Codex CLI starts and responds, then retry preflight.'],
    version: null,
  },
  'cli-incompatible': {
    label: 'CLI update needed',
    tone: 'bad',
    problems: ['Codex CLI 0.160.0 does not list required exec options: --config. Update the Codex CLI, then retry preflight.'],
    version: 'v0.160.0',
  },
  'cli-missing': {
    label: 'CLI not found',
    tone: 'bad',
    problems: ['Codex CLI was not found. Install the Codex CLI or set GG_CODEX_BINARY, then retry preflight.'],
    version: null,
  },
};

// ---------------------------------------------------------------- run directory and records
const attempt = (() => {
  for (let i = 1; i < 100; i++) {
    const dir = join(E, `run-${String(i).padStart(2, '0')}`);
    if (!existsSync(dir)) return { i, dir };
  }
  throw new Error('no free run directory');
})();
const RUN = attempt.dir;
mkdirSync(join(RUN, 'screens'), { recursive: true });
mkdirSync(join(RUN, 'aria'), { recursive: true });
mkdirSync(join(RUN, 'html'), { recursive: true });
const secrets = [];
const redact = (text) => {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('<QA_KEY_REDACTED>');
  return out;
};
const results = {
  attempt: attempt.i,
  started: new Date().toISOString(),
  node: process.version,
  temp: process.env.TEMP,
  repo: REPO,
  webDist: { candidate: CAND_DIST, baseline: BASE_DIST },
  domainConstantMatchesIndependentLiteral: null,
  browser: null,
  sessions: [],
  cases: [],
  processes: [],
  console: [],
  pageErrors: [],
  failures: [],
  finished: null,
};
const log = (msg) => {
  const line = `${new Date().toISOString()} ${redact(msg)}`;
  console.log(line);
  appendFileSync(join(RUN, 'driver.log'), line + '\n');
};
const save = () => writeFileSync(join(RUN, 'results.json'), redact(JSON.stringify(results, null, 2)) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fixture control
function setFixture(mode, delayMs = 0) {
  writeFileSync(STATE, JSON.stringify({ mode, delayMs }));
}
function fixtureStarts() {
  if (!existsSync(CALLS)) return [];
  return readFileSync(CALLS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.event === 'start');
}

// ---------------------------------------------------------------- gateway lifecycle
function gatewayEnv(label, extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC)$/i.test(k)) env[k] = v;
  const home = join(S, 'home', label);
  const temp = join(S, 'temp', 'gateway-' + label);
  mkdirSync(home, { recursive: true });
  mkdirSync(temp, { recursive: true });
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    CODEX_HOME: home,
    TEMP: temp,
    TMP: temp,
    GG_DATA_DIR: join(S, 'stores', label),
    GG_REQUIRE_API_KEY: 'true',
    GG_LOG_LEVEL: 'info',
    GG_MASTER_KEY: randomBytes(32).toString('base64'),
    GG_CODEX_BINARY: FIXTURE,
    GG_CLAUDE_BINARY: join(S, 'absent', 'claude-absent.exe'),
    GG_OLLAMA_ENABLED: 'false',
    GG_GOBLIN_DIST: '',
    GG442UI_STATE: STATE,
    GG442UI_CALLS: CALLS,
    ...extra,
  });
  return env;
}

function runCli(label, args, env, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN, ...args], {
      env,
      cwd: REPO,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const row = { label, pid: child.pid, args: ['main.js', ...args], started: new Date().toISOString() };
    results.processes.push(row);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    const timer = setTimeout(() => {
      row.timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      Object.assign(row, { exitCode: code, signal, exited: new Date().toISOString() });
      resolve({ code, stdout, stderr, pid: child.pid });
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startGateway(label, webDist, extra = {}) {
  const env = gatewayEnv(label, { GG_WEB_DIST: webDist, ...extra });
  const created = await runCli(`${label}-create-api-key`, ['--create-api-key', `QA UI ${label}`], env);
  const token = created.stdout.match(/^ {2}(\S+)$/m)?.[1];
  if (created.code !== 0 || !token) throw new Error(`${label}: API key creation failed (${created.code})`);
  secrets.push(token);
  writeFileSync(
    join(RUN, `${label}-create-api-key.json`),
    redact(JSON.stringify({ exitCode: created.code, stdout: created.stdout, stderr: created.stderr }, null, 2)) + '\n',
  );
  let port;
  for (let i = 0; i < 5 && (port === undefined || FORBIDDEN_PORTS.has(port)); i++) port = await freePort();
  if (FORBIDDEN_PORTS.has(port)) throw new Error('only forbidden ports offered');
  const outLog = join(S, 'logs', `${label}-gateway.stdout.log`);
  const errLog = join(S, 'logs', `${label}-gateway.stderr.log`);
  writeFileSync(outLog, '');
  writeFileSync(errLog, '');
  const child = spawn(process.execPath, [MAIN], {
    env: { ...env, GG_PORT: String(port) },
    cwd: REPO,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const row = { label: `${label}-gateway`, pid: child.pid, port, args: ['main.js'], started: new Date().toISOString() };
  results.processes.push(row);
  child.stdout.on('data', (b) => appendFileSync(outLog, b));
  child.stderr.on('data', (b) => appendFileSync(errLog, b));
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      Object.assign(row, { exitCode: code, signal, exited: new Date().toISOString() });
      resolve(code);
    }),
  );
  const base = `http://127.0.0.1:${port}`;
  let health;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (r.status === 200) {
        health = {
          status: 200,
          pidHeader: Number(r.headers.get('x-graphgoblin-pid')),
          phase: r.headers.get('x-graphgoblin-phase'),
        };
        break;
      }
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  const session = { label, base, port, token, child, exited, row, health, webDist, outLog, errLog, record: { label, port, webDist, gatewayPid: child.pid, health, extraEnv: Object.keys(extra) } };
  results.sessions.push(session.record);
  if (!health || health.pidHeader !== child.pid) throw new Error(`${label}: health/ownership check failed ${JSON.stringify(health)}`);
  log(`${label}: gateway pid ${child.pid} healthy on ${base} (owned pid header matches)`);
  return session;
}

async function api(session, path, options = {}) {
  const r = await fetch(session.base + path, {
    ...options,
    headers: { Authorization: `Bearer ${session.token}`, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

async function stopGateway(session) {
  const record = session.record;
  record.shutdown = {};
  try {
    const snap = await api(session, '/system/shutdown');
    record.shutdown.getStatus = snap.status;
    const post = await api(session, '/system/shutdown', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': snap.body.controlToken },
      body: JSON.stringify({ action: 'drain' }),
    });
    record.shutdown.postStatus = post.status;
    record.shutdown.phase = post.body?.phase;
  } catch (error) {
    record.shutdown.error = String(error);
  }
  let code = await Promise.race([session.exited, sleep(20_000).then(() => 'timeout')]);
  if (code === 'timeout') {
    record.shutdown.fallbackKill = 'exact owned child handle only';
    session.child.kill();
    code = await Promise.race([session.exited, sleep(5_000).then(() => 'timeout')]);
  }
  record.shutdown.exitCode = code;
  record.shutdown.portAfter = await new Promise((resolve) => {
    const sock = net.connect(session.port, '127.0.0.1');
    sock.on('connect', () => {
      sock.destroy();
      resolve('LISTENING');
    });
    sock.on('error', (e) => resolve(e.code));
  });
  try {
    process.kill(session.child.pid, 0);
    record.shutdown.pidAfter = 'ALIVE';
  } catch (e) {
    record.shutdown.pidAfter = e.code;
  }
  log(`${session.label}: shutdown ${JSON.stringify(record.shutdown)}`);
  save();
}

// ---------------------------------------------------------------- in-page probes (self-contained)
function collectFacts(NOTICE) {
  const FIRST = 'Loaded plugin tools are not verified by this check.';
  const findRegion = (name) => {
    for (const s of document.querySelectorAll('section[aria-labelledby]')) {
      const label = s
        .getAttribute('aria-labelledby')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (label === name) return s;
    }
    return null;
  };
  const region = findRegion('Harness preflight');
  const defaults = findRegion('Defaults');
  const live = (root) =>
    [...root.querySelectorAll('[role=status],[role=alert],[role=log],[aria-live],output')].map((el) => ({
      role: el.getAttribute('role'),
      ariaLive: el.getAttribute('aria-live'),
      text: el.textContent.trim(),
      cls: String(el.className || ''),
    }));
  const isRow = (li) => li && li.tagName === 'LI' && li.querySelector(':scope > div [data-state]');
  const rowOf = (el) => {
    for (let e = el; e; e = e.parentElement) if (isRow(e)) return e;
    return null;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const noticeNodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes(FIRST)) noticeNodes.push(n);
  const describe = (p) => {
    const row = rowOf(p);
    const problems = row ? row.querySelector(':scope > ul') : null;
    const cs = getComputedStyle(p);
    const rect = p.getBoundingClientRect();
    return {
      tag: p.tagName.toLowerCase(),
      cls: String(p.className || ''),
      role: p.getAttribute('role'),
      ariaLive: p.getAttribute('aria-live'),
      ariaAttrs: [...p.attributes]
        .filter((a) => a.name.startsWith('aria-') || a.name === 'role' || a.name === 'tabindex')
        .map((a) => `${a.name}=${a.value}`),
      text: p.textContent,
      textMatches: p.textContent === NOTICE,
      codes: [...p.querySelectorAll('code')].map((c) => c.textContent),
      childKinds: [...p.childNodes].map((n) => (n.nodeType === 3 ? 'text' : n.nodeName.toLowerCase())),
      otherElements: [...p.querySelectorAll('*')].filter((e) => e.tagName !== 'CODE').map((e) => e.tagName),
      rowHarness: row?.querySelector(':scope > div > code')?.textContent ?? null,
      directChildOfRow: Boolean(row) && p.parentElement === row,
      isLastChild: Boolean(row) && row.lastElementChild === p,
      rowChildTags: row ? [...row.children].map((c) => c.tagName.toLowerCase()) : [],
      insideNestedList: Boolean(p.closest('li ul')),
      afterProblems: problems ? Boolean(problems.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      insideLiveRegion: Boolean(p.closest('[role=status],[role=alert],[aria-live],[role=log]')),
      visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      color: cs.color,
      fontSize: cs.fontSize,
      animations: p.getAnimations().length,
    };
  };
  const rows = region
    ? [...region.querySelectorAll('li')].filter(isRow).map((li) => {
        const badge = li.querySelector(':scope > div [data-state]');
        const problems = li.querySelector(':scope > ul');
        return {
          harness: li.querySelector(':scope > div > code')?.textContent ?? null,
          badge: {
            state: badge.getAttribute('data-state'),
            text: badge.textContent.trim(),
            cls: String(badge.className),
            hasIcon: Boolean(badge.querySelector('svg')),
          },
          version: li.querySelector(':scope > div > span.text-muted')?.textContent ?? null,
          problems: problems ? { cls: String(problems.className), items: [...problems.children].map((x) => x.textContent) } : null,
          childTags: [...li.children].map((c) => c.tagName.toLowerCase()),
          hasNotice: li.textContent.includes(FIRST),
          signedInClaude: li.textContent.includes('Signed in with Claude.ai.'),
          claudeListingNote: li.textContent.includes('Adapter model listings do not confirm account access.'),
        };
      })
    : [];
  const retry = region ? [...region.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retry preflight') : null;
  const status = region?.querySelector('[role=status]');
  return {
    regionFound: Boolean(region),
    loading: region ? region.textContent.includes('Loading preflight…') : null,
    errorAlert: region?.querySelector('[role=alert]')?.textContent?.trim() ?? null,
    regionHasReadyWord: region ? /\bReady\b/.test(region.textContent) : null,
    regionDataStates: region ? [...region.querySelectorAll('[data-state]')].map((e) => e.getAttribute('data-state')) : [],
    retry: retry ? { disabled: retry.disabled, text: retry.textContent.trim() } : null,
    status: status ? { text: status.textContent, cls: String(status.className) } : null,
    regionLive: region ? live(region) : [],
    pageLive: live(document.body),
    rows,
    notices: noticeNodes.map((n) => describe(n.parentElement)),
    pageNoticeTextNodes: noticeNodes.length,
    pageCmdOccurrences: document.body.textContent.split('codex plugin list --json').length - 1,
    pageReadyBadges: document.querySelectorAll('[data-state="ready"]').length,
    defaultsText: defaults?.textContent ?? null,
    defaultsHasNotice: defaults ? defaults.textContent.includes(FIRST) : null,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    theme: document.documentElement.getAttribute('data-theme'),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function regionHtml(strip) {
  for (const s of document.querySelectorAll('section[aria-labelledby]')) {
    if (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() !== 'Harness preflight') continue;
    const clone = s.cloneNode(true);
    if (strip)
      for (const p of [...clone.querySelectorAll('p')])
        if (p.textContent.startsWith('Loaded plugin tools are not verified')) p.remove();
    return clone.outerHTML.replace(/\s(id|aria-labelledby|aria-describedby|aria-controls|for)="[^"]*"/g, ' $1="*"');
  }
  return null;
}

function geometry() {
  const toRgba = (color) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, 1, 1);
    x.fillStyle = color;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const effectiveBg = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = toRgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let bg = [255, 255, 255, 1];
    for (const layer of layers.reverse()) bg = over(layer, bg);
    return bg;
  };
  const lum = ([r, g, b]) =>
    [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (el) => {
    const bg = effectiveBg(el);
    const fg = over(toRgba(getComputedStyle(el).color), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { fg: fg.map((v) => Math.round(v)), bg: bg.map((v) => Math.round(v)), ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
  };
  let region = null;
  for (const s of document.querySelectorAll('section[aria-labelledby]'))
    if (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'Harness preflight') region = s;
  const p = region ? [...region.querySelectorAll('p')].find((x) => x.textContent.startsWith('Loaded plugin tools')) : null;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, top: Math.round(r.top * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  };
  const lines = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  const regionRect = region ? region.getBoundingClientRect() : null;
  const codes = p
    ? [...p.querySelectorAll('code')].map((c) => {
        const r = c.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        return {
          text: c.textContent,
          box: box(c),
          fragments: c.getClientRects().length,
          whiteSpace: getComputedStyle(c).whiteSpace,
          fontFamily: getComputedStyle(c).fontFamily,
          insideNotice: r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1,
          insideViewport: r.left >= -1 && r.right <= innerWidth + 1,
          contrast: contrast(c),
        };
      })
    : [];
  const pr = p ? p.getBoundingClientRect() : null;
  return {
    viewport: { innerWidth, innerHeight, devicePixelRatio },
    page: { scrollWidth: document.scrollingElement.scrollWidth, overflowX: document.scrollingElement.scrollWidth > innerWidth },
    region: region
      ? {
          box: box(region),
          scrollWidth: region.scrollWidth,
          clientWidth: region.clientWidth,
          overflowX: region.scrollWidth > region.clientWidth,
          insideViewport: regionRect.left >= -1 && regionRect.right <= innerWidth + 1,
        }
      : null,
    notice: p
      ? {
          box: box(p),
          lines: lines(p),
          scrollWidth: p.scrollWidth,
          clientWidth: p.clientWidth,
          overflowX: p.scrollWidth > p.clientWidth + 0,
          insideRegion: pr.left >= regionRect.left - 1 && pr.right <= regionRect.right + 1,
          insideViewport: pr.left >= -1 && pr.right <= innerWidth + 1,
          fontSize: getComputedStyle(p).fontSize,
          lineHeight: getComputedStyle(p).lineHeight,
          contrast: contrast(p),
        }
      : null,
    codes,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    theme: document.documentElement.getAttribute('data-theme'),
  };
}

// ---------------------------------------------------------------- assertions
function codexChecks(facts, state, { notice = true } = {}) {
  const out = [];
  const add = (name, ok, observed, expected) => out.push({ name, ok: Boolean(ok), observed, expected });
  const want = EXPECT[state];
  const codexRows = facts.rows.filter((r) => r.harness === 'codex');
  add('row:codex exactly one', codexRows.length === 1, codexRows.length, 1);
  const row = codexRows[0];
  if (row) {
    add('badge:state', row.badge.state === state, row.badge.state, state);
    add('badge:label', row.badge.text === want.label, row.badge.text, want.label);
    add(
      'badge:tone classes',
      row.badge.cls.includes(`bg-status-${want.tone}-bg`) && row.badge.cls.includes(`text-status-${want.tone}-fg`),
      row.badge.cls,
      `bg-status-${want.tone}-bg text-status-${want.tone}-fg`,
    );
    add('badge:icon', row.badge.hasIcon, row.badge.hasIcon, true);
    add('version', row.version === want.version, row.version, want.version);
    add('problems:items', JSON.stringify(row.problems?.items ?? null) === JSON.stringify(want.problems), row.problems?.items ?? null, want.problems);
    if (want.problems)
      add(
        'problems:tone',
        row.problems?.cls.includes(want.tone === 'bad' ? 'text-status-bad-fg' : 'text-status-warn-fg'),
        row.problems?.cls,
        want.tone === 'bad' ? 'text-status-bad-fg' : 'text-status-warn-fg',
      );
  }
  add('region:one live region (status)', facts.regionLive.length === 1 && facts.regionLive[0].role === 'status', facts.regionLive, '[role=status] only');
  add('other harness rows: no notice', facts.rows.filter((r) => r.harness !== 'codex' && r.hasNotice).length === 0, facts.rows.filter((r) => r.hasNotice).map((r) => r.harness), ['codex']);
  add('defaults: no notice', facts.defaultsHasNotice === false, facts.defaultsHasNotice, false);
  if (notice) {
    add('notice:exactly one page-wide', facts.pageNoticeTextNodes === 1, facts.pageNoticeTextNodes, 1);
    add('notice:commands only inside notice', facts.pageCmdOccurrences === 1, facts.pageCmdOccurrences, 1);
    const n = facts.notices[0];
    if (n) {
      add('notice:exact shared text', n.textMatches, n.text, NOTICE);
      add('notice:two code spans', JSON.stringify(n.codes) === JSON.stringify(CODES), n.codes, CODES);
      add('notice:node sequence', JSON.stringify(n.childKinds) === JSON.stringify(['text', 'code', 'text', 'code', 'text']), n.childKinds, ['text', 'code', 'text', 'code', 'text']);
      add('notice:no other elements', n.otherElements.length === 0, n.otherElements, []);
      add('notice:paragraph', n.tag === 'p', n.tag, 'p');
      add('notice:muted class', n.cls === 'text-xs text-muted', n.cls, 'text-xs text-muted');
      add('notice:no role/aria', n.ariaAttrs.length === 0, n.ariaAttrs, []);
      add('notice:not inside live region', !n.insideLiveRegion, n.insideLiveRegion, false);
      add('notice:codex row', n.rowHarness === 'codex', n.rowHarness, 'codex');
      add('notice:direct child and last of row', n.directChildOfRow && n.isLastChild, { direct: n.directChildOfRow, last: n.isLastChild, tags: n.rowChildTags }, true);
      add('notice:outside problems list', !n.insideNestedList, n.insideNestedList, false);
      if (want.problems) add('notice:after problems', n.afterProblems === true, n.afterProblems, true);
      add('notice:visible', n.visible, n.visible, true);
      add('notice:12px', n.fontSize === '12px', n.fontSize, '12px');
    }
  }
  return out;
}

const caseRecord = (id, kind, title) => {
  const c = { id, kind, title, status: 'RUNNING', checks: [], observations: {}, started: new Date().toISOString() };
  results.cases.push(c);
  return c;
};
const check = (c, name, ok, observed, expected) => c.checks.push({ name, ok: Boolean(ok), observed, expected });
const finish = (c, expectedControl) => {
  const failed = c.checks.filter((x) => !x.ok).map((x) => x.name);
  if (expectedControl) {
    const ok = expectedControl(failed);
    c.status = ok ? 'EXPECTED-CONTROL' : 'FAIL';
    c.controlFailedChecks = failed;
  } else c.status = failed.length ? 'FAIL' : 'PASS';
  if (c.status === 'FAIL') results.failures.push(`${c.id}: ${failed.join('; ') || 'control mismatch'}`);
  c.finished = new Date().toISOString();
  log(`${c.id} ${c.status}${failed.length ? ' failed=' + JSON.stringify(failed) : ''}`);
  save();
};
async function guarded(c, fn, expectedControl) {
  try {
    await fn();
  } catch (error) {
    check(c, 'case completed without exception', false, redact(error.stack ?? String(error)), 'no exception');
  }
  finish(c, expectedControl);
}

// ---------------------------------------------------------------- browser helpers
const pathOf = (url) => {
  const u = new URL(url);
  return u.pathname + (u.search ? '?' + [...u.searchParams.keys()].join('&') : '');
};
function instrument(page, tag) {
  const netlog = [];
  page.on('request', (r) => netlog.push({ t: Date.now(), kind: 'request', method: r.method(), path: pathOf(r.url()), type: r.resourceType() }));
  page.on('response', async (r) => {
    const e = { t: Date.now(), kind: 'response', method: r.request().method(), path: pathOf(r.url()), status: r.status() };
    netlog.push(e);
    if (e.path === '/harness/preflight') {
      try {
        e.body = await r.json();
      } catch (error) {
        e.bodyError = String(error).slice(0, 200);
      }
    }
  });
  page.on('requestfailed', (r) => netlog.push({ t: Date.now(), kind: 'failed', method: r.method(), path: pathOf(r.url()), failure: r.failure()?.errorText }));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') results.console.push({ tag, type: m.type(), text: redact(m.text()).slice(0, 500) });
  });
  page.on('pageerror', (e) => results.pageErrors.push({ tag, message: redact(String(e)).slice(0, 500) }));
  page.__net = netlog;
  page.__tag = tag;
  return netlog;
}
const preflightRequests = (page, from) =>
  page.__net.slice(from).filter((e) => e.kind === 'request' && e.path === '/harness/preflight' && e.method === 'GET').length;
const lastPreflightBody = (page, from) =>
  page.__net
    .slice(from)
    .filter((e) => e.kind === 'response' && e.path === '/harness/preflight' && e.body)
    .at(-1)?.body;
async function settle(page, quietMs = 800, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let lastCalls = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const reqs = page.__net.filter((e) => e.path === '/harness/preflight' && e.kind === 'request').length;
    const done = page.__net.filter((e) => e.path === '/harness/preflight' && e.kind !== 'request').length;
    const calls = fixtureStarts().length;
    if (calls !== lastCalls || reqs !== done) {
      lastCalls = calls;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) return;
    await sleep(100);
  }
  throw new Error('settle timeout');
}
const facts = (page) => page.evaluate(collectFacts, NOTICE);
const waitCodex = (page, state, timeout = 20_000) =>
  page.waitForFunction(
    (want) => {
      for (const s of document.querySelectorAll('section[aria-labelledby]')) {
        if (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() !== 'Harness preflight') continue;
        for (const li of s.querySelectorAll('li')) {
          const b = li.querySelector(':scope > div [data-state]');
          if (b && li.querySelector(':scope > div > code')?.textContent === 'codex') return b.getAttribute('data-state') === want;
        }
      }
      return false;
    },
    state,
    { timeout },
  );
const waitRegionText = (page, text, timeout = 15_000) =>
  page.waitForFunction(
    (want) => {
      for (const s of document.querySelectorAll('section[aria-labelledby]'))
        if (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'Harness preflight')
          return s.textContent.includes(want);
      return false;
    },
    text,
    { timeout },
  );
const waitStatus = (page, text, timeout = 10_000) =>
  page.waitForFunction(
    (want) => {
      for (const s of document.querySelectorAll('section[aria-labelledby]'))
        if (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'Harness preflight')
          return s.querySelector('[role=status]')?.textContent === want;
      return false;
    },
    text,
    { timeout },
  );
const region = (page) => page.getByRole('region', { name: 'Harness preflight' });
const retryButton = (page) => region(page).getByRole('button', { name: 'Retry preflight' });
async function aria(page, name) {
  const snap = await region(page).ariaSnapshot();
  writeFileSync(join(RUN, 'aria', `${name}.yml`), snap + '\n');
  return snap;
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await region(page).screenshot({ path: join(RUN, 'screens', `${name}.png`) });
  return `screens/${name}.png`;
}
async function html(page, name, strip) {
  const value = await page.evaluate(regionHtml, strip);
  writeFileSync(join(RUN, 'html', `${name}.html`), (value ?? '') + '\n');
  return value;
}
const twoFrames = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

async function newContext(browser, session, { theme, reducedMotion, viewport } = {}) {
  const context = await browser.newContext({
    baseURL: session.base,
    viewport: viewport ?? { width: 1440, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: reducedMotion ?? 'no-preference',
    ...(session.storageState ? { storageState: session.storageState } : {}),
  });
  context.setDefaultTimeout(20_000);
  if (theme) await context.addInitScript((t) => localStorage.setItem('graphgoblin-theme', t), theme);
  return context;
}
async function enterKey(session, context) {
  const page = await context.newPage();
  instrument(page, `${session.label}-key`);
  await page.goto('/app/settings');
  await page.getByRole('heading', { name: 'API key required' }).waitFor({ timeout: 20_000 });
  await page.locator('#api-key-input').fill(session.token);
  await page.getByRole('button', { name: 'Use key' }).click();
  await waitCodex(page, session.firstState ?? 'ready', 30_000);
  await settle(page);
  session.storageState = await context.storageState(); // memory only (contains the QA key)
  session.record.keyEnteredThroughPanel = true;
  return page;
}
function nonGetRequests(pages) {
  return pages.flatMap((p) => p.__net.filter((e) => e.kind === 'request' && e.method !== 'GET').map((e) => ({ tag: p.__tag, ...e })));
}
function saveNet(pages, name) {
  writeFileSync(join(RUN, `${name}-network.json`), redact(JSON.stringify(pages.map((p) => ({ tag: p.__tag, entries: p.__net })), null, 2)) + '\n');
}

// ---------------------------------------------------------------- items for INTERCEPT cases
const codexReady = { harness: 'codex', state: 'ready', ok: true, version: '0.160.0', authenticated: true, problems: [] };
const claudeReady = {
  harness: 'claude',
  state: 'ready',
  ok: true,
  version: '2.1.287 (QA intercept)',
  authenticated: true,
  authMethod: 'claude.ai',
  problems: [],
  models: [{ model: 'claude-opus-5-5', efforts: ['high'] }],
};
const ollamaReady = { harness: 'ollama', state: 'ready', ok: true, problems: [] };

// ---------------------------------------------------------------- main
const watchdog = setTimeout(() => {
  log('WATCHDOG: 15 minute bound reached');
  results.failures.push('watchdog');
  save();
  process.exit(3);
}, 15 * 60_000);

let browser;
const sessions = [];
const allPages = [];
const baselineHtml = {};
try {
  mkdirSync(join(S, 'fixture'), { recursive: true });
  if (existsSync(CALLS)) throw new Error('fixture call log already exists; refusing to mix attempts');
  writeFileSync(CALLS, '');
  setFixture('ready');
  const domain = await import(pathToFileURL(join(REPO, 'packages/domain/dist/index.js')).href);
  results.domainConstantMatchesIndependentLiteral = domain.CODEX_PLUGIN_OBSERVABILITY_NOTICE === NOTICE;
  results.domainProblemCrossCheck = Object.fromEntries(
    Object.entries(EXPECT)
      .filter(([s]) => s !== 'ready')
      .map(([s, w]) => [s, s === 'cli-incompatible' ? 'detail is version-specific (independent literal)' : domain.readinessMessage('codex', s) === w.problems[0]]),
  );
  log(`domain constant equals independent literal: ${results.domainConstantMatchesIndependentLiteral}`);

  const pw = createRequire(join(REPO, 'apps/web/package.json'))('@playwright/test');
  browser = await pw.chromium.launch({ channel: 'msedge', headless: true, timeout: 60_000 });
  const bproc = browser.process?.();
  results.browser = { channel: 'msedge', version: browser.version(), pid: bproc?.pid ?? null, playwright: createRequire(join(REPO, 'apps/web/package.json'))('@playwright/test/package.json').version };
  log(`browser ${JSON.stringify(results.browser)}`);
  save();

  // ================================================================ S0 BASELINE
  {
    setFixture('ready');
    const s0 = await startGateway('s0-baseline', BASE_DIST);
    sessions.push(s0);
    const settingsBefore = await api(s0, '/settings');
    const ctx = await newContext(browser, s0);
    const keyPage = await enterKey(s0, ctx);
    allPages.push(keyPage);
    const page = await ctx.newPage();
    instrument(page, 's0-main');
    allPages.push(page);

    const b1 = caseRecord('B1', 'BASELINE+NATIVE', '5b build Ready: everything but the notice');
    await guarded(
      b1,
      async () => {
        const mark = page.__net.length;
        const calls = fixtureStarts().length;
        await page.goto('/app/settings');
        await waitCodex(page, 'ready');
        await settle(page);
        const f = await facts(page);
        b1.observations.facts = f;
        b1.checks.push(...codexChecks(f, 'ready'));
        check(b1, 'preflight GETs on load', preflightRequests(page, mark) === 1, preflightRequests(page, mark), 1);
        const delta = fixtureStarts().slice(calls).map((r) => r.args.join(' '));
        check(b1, 'fixture commands', JSON.stringify(delta) === JSON.stringify(ALLOWED_ARGS), delta, ALLOWED_ARGS);
        baselineHtml.ready = await html(page, 'B1-baseline-ready-stripped', true);
        b1.observations.screenshot = await shot(page, 'B1-baseline-ready-1440');
        b1.observations.aria = await aria(page, 'B1-baseline-ready');
      },
      (failed) => failed.length > 0 && failed.every((n) => n.startsWith('notice:')) && failed.includes('notice:exactly one page-wide'),
    );

    const b2 = caseRecord('B2', 'BASELINE+NATIVE', '5b build Retry -> auth: everything but the notice');
    await guarded(
      b2,
      async () => {
        setFixture('auth');
        const mark = page.__net.length;
        const calls = fixtureStarts().length;
        await retryButton(page).click();
        await waitCodex(page, 'auth');
        await settle(page);
        const f = await facts(page);
        b2.observations.facts = f;
        b2.checks.push(...codexChecks(f, 'auth'));
        check(b2, 'preflight GETs per Retry', preflightRequests(page, mark) === 1, preflightRequests(page, mark), 1);
        check(b2, 'fixture commands', fixtureStarts().length - calls === 4, fixtureStarts().length - calls, 4);
        baselineHtml.auth = await html(page, 'B2-baseline-auth-stripped', true);
        b2.observations.screenshot = await shot(page, 'B2-baseline-auth-1440');
      },
      (failed) => failed.length > 0 && failed.every((n) => n.startsWith('notice:')) && failed.includes('notice:exactly one page-wide'),
    );

    const b3 = caseRecord('B3', 'BASELINE+NATIVE', '5b build first-load Loading view (fixture delay)');
    await guarded(b3, async () => {
      setFixture('ready', 3000);
      const p = await ctx.newPage();
      instrument(p, 's0-loading');
      allPages.push(p);
      await p.goto('/app/settings');
      await waitRegionText(p, 'Loading preflight…');
      const f = await facts(p);
      b3.observations.facts = f;
      check(b3, 'loading text', f.loading, f.loading, true);
      check(b3, 'no badge while loading', f.regionDataStates.length === 0, f.regionDataStates, []);
      baselineHtml.loading = await html(p, 'B3-baseline-loading', false);
      await waitCodex(p, 'ready', 30_000);
      await settle(p);
      check(b3, 'preflight GETs', preflightRequests(p, 0) === 1, preflightRequests(p, 0), 1);
      await p.close();
      setFixture('ready', 0);
    });

    const b4 = caseRecord('B4', 'BASELINE+INTERCEPT', '5b build first-load request failure view (503)');
    await guarded(b4, async () => {
      const p = await ctx.newPage();
      instrument(p, 's0-error');
      allPages.push(p);
      let intercepted = 0;
      await p.route('**/harness/preflight', (route) => {
        intercepted += 1;
        return route.fulfill({ status: 503, json: { code: 'TEMPORARY_FAILURE', detail: 'Synthetic lookup failure' } });
      });
      await p.goto('/app/settings');
      await waitRegionText(p, 'Could not load preflight');
      await sleep(1500);
      const f = await facts(p);
      b4.observations.facts = f;
      b4.observations.intercepted = intercepted;
      check(b4, 'error view', f.errorAlert?.startsWith('Could not load preflight'), f.errorAlert, 'Could not load preflight…');
      check(b4, 'no badge', f.regionDataStates.length === 0, f.regionDataStates, []);
      baselineHtml.error = await html(p, 'B4-baseline-error', false);
      await p.unrouteAll({ behavior: 'wait' });
      await p.close();
    });

    const b5 = caseRecord('B5', 'BASELINE+NATIVE', '5b build 320 px geometry at Ready (attribution)');
    await guarded(b5, async () => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto('/app/settings');
      await waitCodex(page, 'ready');
      await settle(page);
      await twoFrames(page);
      const g = await page.evaluate(geometry);
      b5.observations.geometry = g;
      check(b5, 'card inside viewport', g.region?.insideViewport, g.region, true);
      check(b5, 'card no horizontal overflow', g.region && !g.region.overflowX, g.region, false);
      b5.observations.pageOverflowX = g.page;
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    const settingsAfter = await api(s0, '/settings');
    s0.record.settingsUnchanged = JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
    s0.record.nonGetRequests = nonGetRequests(allPages.filter((p) => p.__tag.startsWith('s0')));
    saveNet(allPages.filter((p) => p.__tag.startsWith('s0')), 's0');
    await ctx.close();
    await stopGateway(s0);
  }

  // ================================================================ S1 CANDIDATE
  {
    setFixture('ready');
    const s1 = await startGateway('s1-candidate', CAND_DIST);
    sessions.push(s1);
    const settingsBefore = await api(s1, '/settings');
    const ctx = await newContext(browser, s1);
    const keyPage = await enterKey(s1, ctx);
    allPages.push(keyPage);
    const page = await ctx.newPage();
    instrument(page, 's1-main');
    allPages.push(page);

    const c1 = caseRecord('C1', 'NATIVE', 'First-load Loading view: no badge, notice or false Ready');
    await guarded(c1, async () => {
      setFixture('ready', 3000);
      const p = await ctx.newPage();
      instrument(p, 's1-loading');
      allPages.push(p);
      const calls = fixtureStarts().length;
      await p.goto('/app/settings');
      await waitRegionText(p, 'Loading preflight…');
      const f = await facts(p);
      c1.observations.loadingFacts = f;
      check(c1, 'loading text', f.loading, f.loading, true);
      check(c1, 'no badge', f.regionDataStates.length === 0, f.regionDataStates, []);
      check(c1, 'no notice', f.pageNoticeTextNodes === 0, f.pageNoticeTextNodes, 0);
      check(c1, 'no Ready in card', f.regionHasReadyWord === false, f.regionHasReadyWord, false);
      check(c1, 'no ready badge on page', f.pageReadyBadges === 0, f.pageReadyBadges, 0);
      check(c1, 'Retry disabled', f.retry?.disabled === true, f.retry, true);
      const h = await html(p, 'C1-candidate-loading', false);
      check(c1, 'loading view HTML == baseline B3', h === baselineHtml.loading, h === baselineHtml.loading, true);
      c1.observations.aria = await aria(p, 'C1-loading');
      await waitCodex(p, 'ready', 30_000);
      await settle(p);
      const after = await facts(p);
      c1.checks.push(...codexChecks(after, 'ready').map((x) => ({ ...x, name: 'after: ' + x.name })));
      check(c1, 'preflight GETs', preflightRequests(p, 0) === 1, preflightRequests(p, 0), 1);
      check(c1, 'fixture commands', fixtureStarts().length - calls === 4, fixtureStarts().length - calls, 4);
      await p.close();
      setFixture('ready', 0);
    });

    const c2 = caseRecord('C2', 'NATIVE', 'Ready Codex at 1440: notice, code spans, unchanged Ready/auth facts');
    await guarded(c2, async () => {
      const mark = page.__net.length;
      const calls = fixtureStarts().length;
      await page.goto('/app/settings');
      await waitCodex(page, 'ready');
      await settle(page);
      const f = await facts(page);
      c2.observations.facts = f;
      c2.checks.push(...codexChecks(f, 'ready'));
      check(c2, 'preflight GETs on load', preflightRequests(page, mark) === 1, preflightRequests(page, mark), 1);
      const delta = fixtureStarts().slice(calls).map((r) => r.args.join(' '));
      check(c2, 'fixture commands exactly the four no-turn checks', JSON.stringify(delta) === JSON.stringify(ALLOWED_ARGS), delta, ALLOWED_ARGS);
      const body = lastPreflightBody(page, mark);
      const codex = body?.items?.find((i) => i.harness === 'codex');
      c2.observations.codexResponse = codex;
      check(c2, 'response Ready/authenticated', codex?.state === 'ready' && codex?.ok === true && codex?.authenticated === true && codex?.problems?.length === 0, codex, 'ready ok authenticated:true problems:[]');
      check(c2, 'response carries no notice text', !JSON.stringify(body).includes('Loaded plugin tools'), JSON.stringify(body).includes('Loaded plugin tools'), false);
      check(c2, 'other rows natively present', f.rows.map((r) => `${r.harness}:${r.badge.state}`).join(',') === 'codex:ready,claude:cli-missing,ollama:unknown', f.rows.map((r) => `${r.harness}:${r.badge.state}`), 'codex:ready,claude:cli-missing,ollama:unknown');
      check(c2, 'no /system/preflight request', page.__net.slice(mark).filter((e) => e.path === '/system/preflight').length === 0, page.__net.slice(mark).filter((e) => e.path === '/system/preflight').length, 0);
      const h = await html(page, 'C2-candidate-ready-stripped', true);
      check(c2, 'card HTML minus notice == baseline B1', h === baselineHtml.ready, h === baselineHtml.ready, true);
      check(c2, 'page live-region count == baseline', f.pageLive.length === results.cases.find((x) => x.id === 'B1')?.observations.facts?.pageLive.length, f.pageLive.length, results.cases.find((x) => x.id === 'B1')?.observations.facts?.pageLive.length);
      c2.observations.screenshot = await shot(page, 'C2-ready-1440');
      c2.observations.aria = await aria(page, 'C2-ready');
    });

    const c3 = caseRecord('C3', 'NATIVE', 'Retry while Ready: one query, Rechecking, one notice');
    await guarded(c3, async () => {
      setFixture('ready', 1500);
      const mark = page.__net.length;
      const calls = fixtureStarts().length;
      await retryButton(page).click();
      await waitStatus(page, 'Rechecking…', 3000);
      const during = await facts(page);
      c3.observations.during = during;
      check(c3, 'during: status Rechecking…', during.status?.text === 'Rechecking…', during.status, 'Rechecking…');
      check(c3, 'during: last Ready kept', during.rows.find((r) => r.harness === 'codex')?.badge.state === 'ready', during.rows.find((r) => r.harness === 'codex')?.badge.state, 'ready');
      check(c3, 'during: no checking badge', !during.regionDataStates.includes('checking'), during.regionDataStates, 'no checking');
      check(c3, 'during: Retry disabled', during.retry?.disabled === true, during.retry, true);
      check(c3, 'during: notice once', during.pageNoticeTextNodes === 1, during.pageNoticeTextNodes, 1);
      check(c3, 'during: one live region', during.regionLive.length === 1, during.regionLive, 1);
      c3.observations.ariaDuring = await aria(page, 'C3-rechecking');
      c3.observations.screenshotDuring = await shot(page, 'C3-rechecking-1440');
      await waitStatus(page, '', 15_000);
      await settle(page, 1200);
      const after = await facts(page);
      c3.observations.after = after;
      c3.checks.push(...codexChecks(after, 'ready').map((x) => ({ ...x, name: 'after: ' + x.name })));
      check(c3, 'exactly one preflight GET', preflightRequests(page, mark) === 1, preflightRequests(page, mark), 1);
      const delta = fixtureStarts().slice(calls).map((r) => r.args.join(' '));
      check(c3, 'exactly four fixture commands', JSON.stringify(delta) === JSON.stringify(ALLOWED_ARGS), delta, ALLOWED_ARGS);
      check(c3, 'no non-preflight API request triggered', page.__net.slice(mark).filter((e) => e.kind === 'request' && e.path !== '/harness/preflight').map((e) => e.path).length === 0, page.__net.slice(mark).filter((e) => e.kind === 'request' && e.path !== '/harness/preflight').map((e) => e.path), []);
      setFixture('ready', 0);
    });

    const retryTo = async (c, mode, state, expectedCalls) => {
      setFixture(mode, 0);
      const mark = page.__net.length;
      const calls = fixtureStarts().length;
      await retryButton(page).click();
      await waitCodex(page, state);
      await settle(page);
      const f = await facts(page);
      c.observations.facts = f;
      c.checks.push(...codexChecks(f, state));
      check(c, 'exactly one preflight GET', preflightRequests(page, mark) === 1, preflightRequests(page, mark), 1);
      check(c, 'fixture command count', fixtureStarts().length - calls === expectedCalls, fixtureStarts().length - calls, expectedCalls);
      const codex = lastPreflightBody(page, mark)?.items?.find((i) => i.harness === 'codex');
      c.observations.codexResponse = codex;
      return { f, codex };
    };

    const c4 = caseRecord('C4', 'NATIVE', 'Retry -> sign-in failure: detail+action then quiet notice');
    await guarded(c4, async () => {
      const { f, codex } = await retryTo(c4, 'auth', 'auth', 4);
      check(c4, 'response auth/authenticated:false', codex?.state === 'auth' && codex?.authenticated === false, codex, 'auth authenticated:false');
      check(c4, 'Defaults readiness line', f.defaultsText?.includes('Codex readiness: Sign-in needed. See Harness preflight below.'), f.defaultsText?.match(/Codex readiness[^.]*\.[^.]*\./)?.[0] ?? null, 'Codex readiness: Sign-in needed. See Harness preflight below.');
      const h = await html(page, 'C4-candidate-auth-stripped', true);
      check(c4, 'card HTML minus notice == baseline B2', h === baselineHtml.auth, h === baselineHtml.auth, true);
      c4.observations.screenshot = await shot(page, 'C4-auth-1440');
      c4.observations.aria = await aria(page, 'C4-auth');
    });

    const c5 = caseRecord('C5', 'NATIVE', 'Retry -> restored Ready (negative-path restoration)');
    await guarded(c5, async () => {
      const { codex } = await retryTo(c5, 'ready', 'ready', 4);
      check(c5, 'response ready/authenticated:true', codex?.state === 'ready' && codex?.authenticated === true, codex, 'ready authenticated:true');
    });

    for (const [id, mode, state, n] of [
      ['C6', 'quota', 'quota', 4],
      ['C7', 'transport', 'transport', 4],
      ['C8', 'unknown', 'unknown', 1],
      ['C9', 'incompatible', 'cli-incompatible', 2],
    ]) {
      const c = caseRecord(id, 'NATIVE', `Retry -> ${state}: notice after problem`);
      await guarded(c, async () => {
        await retryTo(c, mode, state, n);
        c.observations.aria = await aria(page, `${id}-${state}`);
      });
    }

    const c10 = caseRecord('C10', 'NATIVE+BROWSER-OFFLINE', 'Offline keeps last result in the one status region; restore');
    await guarded(c10, async () => {
      setFixture('ready', 0);
      await retryButton(page).click();
      await waitCodex(page, 'ready');
      await settle(page);
      const mark = page.__net.length;
      const calls = fixtureStarts().length;
      await ctx.setOffline(true);
      await sleep(400);
      await retryButton(page).click();
      await waitStatus(page, 'Offline; showing the last check.', 8000);
      await sleep(800);
      const f = await facts(page);
      c10.observations.offline = f;
      check(c10, 'offline: status text', f.status?.text === 'Offline; showing the last check.', f.status, 'Offline; showing the last check.');
      check(c10, 'offline: last Ready kept', f.rows.find((r) => r.harness === 'codex')?.badge.state === 'ready', f.rows.find((r) => r.harness === 'codex')?.badge, 'ready');
      check(c10, 'offline: notice once', f.pageNoticeTextNodes === 1, f.pageNoticeTextNodes, 1);
      check(c10, 'offline: one live region in card', f.regionLive.length === 1, f.regionLive, 1);
      check(c10, 'offline: no preflight request', preflightRequests(page, mark) === 0, preflightRequests(page, mark), 0);
      check(c10, 'offline: no fixture commands', fixtureStarts().length - calls === 0, fixtureStarts().length - calls, 0);
      c10.observations.retryWhileOffline = f.retry;
      c10.observations.pageLiveOffline = f.pageLive;
      c10.observations.aria = await aria(page, 'C10-offline');
      c10.observations.screenshot = await shot(page, 'C10-offline-1440');
      const restore = page.__net.length;
      const calls2 = fixtureStarts().length;
      await ctx.setOffline(false);
      await waitStatus(page, '', 15_000);
      await waitCodex(page, 'ready');
      await settle(page, 1200);
      const after = await facts(page);
      c10.observations.restored = after;
      c10.checks.push(...codexChecks(after, 'ready').map((x) => ({ ...x, name: 'restored: ' + x.name })));
      check(c10, 'restored: exactly one preflight GET', preflightRequests(page, restore) === 1, preflightRequests(page, restore), 1);
      check(c10, 'restored: four fixture commands', fixtureStarts().length - calls2 === 4, fixtureStarts().length - calls2, 4);
    });

    const c11 = caseRecord('C11', 'INTERCEPT then NATIVE', 'Retry request failure: no false Ready, then native restoration');
    await guarded(c11, async () => {
      let intercepted = 0;
      await page.route('**/harness/preflight', (route) => {
        intercepted += 1;
        return route.fulfill({ status: 503, json: { code: 'TEMPORARY_FAILURE', detail: 'Synthetic lookup failure' } });
      });
      const mark = page.__net.length;
      const calls = fixtureStarts().length;
      await retryButton(page).click();
      let sawRechecking = true;
      try {
        await waitStatus(page, 'Rechecking…', 3000);
      } catch {
        sawRechecking = false;
      }
      c11.observations.sawRechecking = sawRechecking;
      await waitRegionText(page, 'Could not load preflight', 15_000);
      await sleep(2000);
      const f = await facts(page);
      c11.observations.facts = f;
      check(c11, 'error alert', f.errorAlert?.startsWith('Could not load preflight'), f.errorAlert, 'Could not load preflight…');
      check(c11, 'no badge in card', f.regionDataStates.length === 0, f.regionDataStates, []);
      check(c11, 'no notice', f.pageNoticeTextNodes === 0, f.pageNoticeTextNodes, 0);
      check(c11, 'no Ready in card', f.regionHasReadyWord === false, f.regionHasReadyWord, false);
      check(c11, 'Defaults says lookup failed, not Ready', f.defaultsText?.includes('Could not check Codex readiness.') && !/Codex readiness: Ready/.test(f.defaultsText ?? ''), f.defaultsText?.match(/Could not check Codex readiness\./)?.[0] ?? null, 'Could not check Codex readiness.');
      check(c11, 'status cleared', f.status?.text === '', f.status, '');
      check(c11, 'no fixture command (intercepted)', fixtureStarts().length - calls === 0, fixtureStarts().length - calls, 0);
      c11.observations.interceptedRequests = intercepted;
      c11.observations.browserPreflightRequests = preflightRequests(page, mark);
      check(c11, 'intercepted requests (existing retry:1 predicts 2)', intercepted === 2, intercepted, 2);
      c11.observations.aria = await aria(page, 'C11-error');
      c11.observations.screenshot = await shot(page, 'C11-error-1440');
      await page.unrouteAll({ behavior: 'wait' });
      const restore = page.__net.length;
      const calls2 = fixtureStarts().length;
      await retryButton(page).click();
      await waitCodex(page, 'ready');
      await settle(page);
      const after = await facts(page);
      c11.checks.push(...codexChecks(after, 'ready').map((x) => ({ ...x, name: 'restored: ' + x.name })));
      check(c11, 'restored: one preflight GET', preflightRequests(page, restore) === 1, preflightRequests(page, restore), 1);
      check(c11, 'restored: four fixture commands', fixtureStarts().length - calls2 === 4, fixtureStarts().length - calls2, 4);
    });

    const c12 = caseRecord('C12', 'INTERCEPT', 'First-load request failure view unchanged, no notice');
    await guarded(c12, async () => {
      const p = await ctx.newPage();
      instrument(p, 's1-error');
      allPages.push(p);
      let intercepted = 0;
      await p.route('**/harness/preflight', (route) => {
        intercepted += 1;
        return route.fulfill({ status: 503, json: { code: 'TEMPORARY_FAILURE', detail: 'Synthetic lookup failure' } });
      });
      await p.goto('/app/settings');
      await waitRegionText(p, 'Could not load preflight');
      await sleep(1500);
      const f = await facts(p);
      c12.observations.facts = f;
      c12.observations.intercepted = intercepted;
      check(c12, 'no notice', f.pageNoticeTextNodes === 0, f.pageNoticeTextNodes, 0);
      check(c12, 'no badge', f.regionDataStates.length === 0, f.regionDataStates, []);
      check(c12, 'no ready badge on page', f.pageReadyBadges === 0, f.pageReadyBadges, 0);
      const h = await html(p, 'C12-candidate-error', false);
      check(c12, 'error view HTML == baseline B4', h === baselineHtml.error, h === baselineHtml.error, true);
      await p.unrouteAll({ behavior: 'wait' });
      await p.close();
    });

    const c13 = caseRecord('C13', 'INTERCEPT', 'Multi-harness: Codex-only notice; Claude signed-in line; notice after two problems');
    await guarded(c13, async () => {
      const p = await ctx.newPage();
      instrument(p, 's1-multi');
      allPages.push(p);
      let items = [codexReady, claudeReady, ollamaReady];
      await p.route('**/harness/preflight', (route) => route.fulfill({ json: { items } }));
      await p.goto('/app/settings');
      await waitCodex(p, 'ready');
      await sleep(500);
      const a = await facts(p);
      c13.observations.allReady = a;
      c13.checks.push(...codexChecks(a, 'ready').map((x) => ({ ...x, name: 'a: ' + x.name })));
      const claude = a.rows.find((r) => r.harness === 'claude');
      const ollama = a.rows.find((r) => r.harness === 'ollama');
      check(c13, 'a: Claude Ready + Signed in with Claude.ai. (existing semantics)', claude?.badge.state === 'ready' && claude?.signedInClaude && claude?.claudeListingNote, claude, 'ready, signed-in line, listing note');
      check(c13, 'a: Claude no notice', claude && !claude.hasNotice, claude?.hasNotice, false);
      check(c13, 'a: Ollama Ready, no notice', ollama?.badge.state === 'ready' && !ollama.hasNotice, ollama, 'ready, no notice');
      c13.observations.aria = await aria(p, 'C13a-all-ready-intercept');
      c13.observations.screenshot = await shot(p, 'C13a-all-ready-intercept-1440');
      items = [
        { harness: 'codex', state: 'auth', ok: false, version: '0.160.0', authenticated: false, problems: ['QA intercept problem one.', 'QA intercept problem two.'] },
        claudeReady,
      ];
      await p.reload();
      await waitCodex(p, 'auth');
      await sleep(500);
      const b = await facts(p);
      c13.observations.twoProblems = b;
      const n = b.notices[0];
      check(c13, 'b: both problems listed', JSON.stringify(b.rows.find((r) => r.harness === 'codex')?.problems?.items) === JSON.stringify(['QA intercept problem one.', 'QA intercept problem two.']), b.rows.find((r) => r.harness === 'codex')?.problems?.items, 2);
      check(c13, 'b: notice once, after both, outside list, last', b.pageNoticeTextNodes === 1 && n?.afterProblems === true && n?.isLastChild && !n?.insideNestedList, n && { after: n.afterProblems, last: n.isLastChild, nested: n.insideNestedList }, true);
      await p.unrouteAll({ behavior: 'wait' });
      await p.close();
    });

    const c14 = caseRecord('C14', 'INTERCEPT', 'Codex absent: no notice anywhere');
    await guarded(c14, async () => {
      const p = await ctx.newPage();
      instrument(p, 's1-nocodex');
      allPages.push(p);
      await p.route('**/harness/preflight', (route) => route.fulfill({ json: { items: [claudeReady, ollamaReady] } }));
      await p.goto('/app/settings');
      await p.waitForFunction(() => document.querySelectorAll('[data-state="ready"]').length >= 2);
      await sleep(500);
      const f = await facts(p);
      c14.observations.facts = f;
      check(c14, 'rows', f.rows.map((r) => r.harness).join(',') === 'claude,ollama', f.rows.map((r) => r.harness), 'claude,ollama');
      check(c14, 'no notice', f.pageNoticeTextNodes === 0, f.pageNoticeTextNodes, 0);
      check(c14, 'one live region', f.regionLive.length === 1, f.regionLive, 1);
      await p.unrouteAll({ behavior: 'wait' });
      await p.close();
    });

    const c15 = caseRecord('C15', 'NATIVE', 'Layout: 1440/375/320/200%-equivalent, dark+light, Ready+auth');
    await guarded(c15, async () => {
      const measurements = [];
      const shots = {
        'dark|ready|1440': 'C15-dark-ready-1440',
        'dark|auth|1440': 'C15-dark-auth-1440',
        'dark|ready|320': 'C15-dark-ready-320',
        'dark|auth|320': 'C15-dark-auth-320',
        'dark|ready|375': 'C15-dark-ready-375',
        'dark|ready|512': 'C15-dark-ready-zoom200',
        'light|ready|1440': 'C15-light-ready-1440',
        'light|auth|320': 'C15-light-auth-320',
      };
      for (const theme of ['dark', 'light']) {
        const tctx = await newContext(browser, s1, { theme });
        const p = await tctx.newPage();
        instrument(p, `s1-layout-${theme}`);
        allPages.push(p);
        for (const state of ['ready', 'auth']) {
          setFixture(state, 0);
          await p.setViewportSize({ width: 1440, height: 900 });
          await p.goto('/app/settings');
          await waitCodex(p, state);
          await settle(p);
          for (const vp of [
            { width: 1440, height: 900 },
            { width: 375, height: 812 },
            { width: 320, height: 640 },
            { width: 512, height: 384 },
          ]) {
            await p.setViewportSize(vp);
            await twoFrames(p);
            await p.evaluate(() => document.fonts.ready);
            const g = await p.evaluate(geometry);
            const row = { theme, state, ...vp, ...g };
            measurements.push(row);
            const tag = `${theme} ${state} ${vp.width}`;
            check(c15, `${tag}: theme applied`, g.theme === theme, g.theme, theme);
            check(c15, `${tag}: card inside viewport, no overflow`, g.region?.insideViewport && !g.region.overflowX, g.region, 'inside, no overflowX');
            check(c15, `${tag}: notice inside card+viewport, no overflow`, g.notice?.insideRegion && g.notice.insideViewport && !g.notice.overflowX, g.notice && { insideRegion: g.notice.insideRegion, insideViewport: g.notice.insideViewport, overflowX: g.notice.overflowX }, true);
            check(c15, `${tag}: both codes inside notice+viewport`, g.codes.length === 2 && g.codes.every((c) => c.insideNotice && c.insideViewport), g.codes.map((c) => ({ text: c.text, insideNotice: c.insideNotice, insideViewport: c.insideViewport, fragments: c.fragments })), 'inside');
            check(c15, `${tag}: notice contrast >= 4.5`, g.notice?.contrast.ratio >= 4.5, g.notice?.contrast, '>= 4.5:1');
            check(c15, `${tag}: code contrast >= 4.5`, g.codes.every((c) => c.contrast.ratio >= 4.5), g.codes.map((c) => c.contrast.ratio), '>= 4.5:1');
            const key = `${theme}|${state}|${vp.width}`;
            if (shots[key]) {
              await region(p).scrollIntoViewIfNeeded();
              row.screenshot = await shot(p, shots[key]);
            }
          }
        }
        await tctx.close();
      }
      c15.observations.measurements = measurements;
      writeFileSync(join(RUN, 'layout-measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
      setFixture('ready', 0);
    });

    const c16 = caseRecord('C16', 'NATIVE', 'Reduced motion emulation and default root font size');
    await guarded(c16, async () => {
      const rctx = await newContext(browser, s1, { theme: 'dark', reducedMotion: 'reduce' });
      const p = await rctx.newPage();
      instrument(p, 's1-reduced-motion');
      allPages.push(p);
      await p.goto('/app/settings');
      await waitCodex(p, 'ready');
      await settle(p);
      const f = await facts(p);
      c16.observations.facts = { reducedMotion: f.reducedMotion, rootFontSize: f.rootFontSize, notice: f.notices[0] };
      check(c16, 'reduced motion active', f.reducedMotion === true, f.reducedMotion, true);
      c16.checks.push(...codexChecks(f, 'ready'));
      check(c16, 'notice has no animations', f.notices[0]?.animations === 0, f.notices[0]?.animations, 0);
      c16.observations.rootFontSize = f.rootFontSize;
      const main = await facts(page);
      c16.observations.defaultContextNoticeAnimations = main.notices[0]?.animations;
      await rctx.close();
    });

    const c17 = caseRecord('C17', 'DOM-CONTROL', 'Checker sensitivity: wrong tone + live role on the rendered notice');
    await guarded(
      c17,
      async () => {
        await page.goto('/app/settings');
        await waitCodex(page, 'ready');
        await settle(page);
        await page.evaluate(() => {
          const p = [...document.querySelectorAll('p')].find((x) => x.textContent.startsWith('Loaded plugin tools'));
          p.className = 'text-xs text-status-bad-fg';
          p.setAttribute('role', 'alert');
        });
        const f = await facts(page);
        c17.checks.push(...codexChecks(f, 'ready'));
        await page.reload();
        await waitCodex(page, 'ready');
        await settle(page);
        const g = await facts(page);
        c17.observations.afterReloadFailedChecks = codexChecks(g, 'ready').filter((x) => !x.ok).map((x) => x.name);
      },
      (failed) =>
        ['notice:muted class', 'notice:no role/aria', 'notice:not inside live region', 'region:one live region (status)'].every((n) => failed.includes(n)) &&
        failed.every((n) => n.startsWith('notice:') || n.startsWith('region:')) &&
        results.cases.find((x) => x.id === 'C17').observations.afterReloadFailedChecks?.length === 0,
    );

    const settingsAfter = await api(s1, '/settings');
    s1.record.settingsUnchanged = JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
    s1.record.nonGetRequests = nonGetRequests(allPages.filter((p) => p.__tag.startsWith('s1')));
    saveNet(allPages.filter((p) => p.__tag.startsWith('s1')), 's1');
    await ctx.close();
    await stopGateway(s1);
  }

  // ================================================================ S2 MISSING CODEX BINARY
  {
    setFixture('ready');
    const s2 = await startGateway('s2-missing', CAND_DIST, { GG_CODEX_BINARY: join(S, 'absent', 'codex-absent.exe') });
    s2.firstState = 'cli-missing';
    sessions.push(s2);
    const settingsBefore = await api(s2, '/settings');
    const ctx = await newContext(browser, s2);
    const keyPage = await enterKey(s2, ctx);
    allPages.push(keyPage);
    const m1 = caseRecord('M1', 'NATIVE', 'Missing Codex executable: CLI not found then notice');
    await guarded(m1, async () => {
      const page = await ctx.newPage();
      instrument(page, 's2-main');
      allPages.push(page);
      const calls = fixtureStarts().length;
      await page.goto('/app/settings');
      await waitCodex(page, 'cli-missing');
      await settle(page);
      const f = await facts(page);
      m1.observations.facts = f;
      m1.checks.push(...codexChecks(f, 'cli-missing'));
      check(m1, 'preflight GETs', preflightRequests(page, 0) === 1, preflightRequests(page, 0), 1);
      check(m1, 'no fixture command', fixtureStarts().length - calls === 0, fixtureStarts().length - calls, 0);
      m1.observations.codexResponse = lastPreflightBody(page, 0)?.items?.find((i) => i.harness === 'codex');
      m1.observations.screenshot = await shot(page, 'M1-cli-missing-1440');
      m1.observations.aria = await aria(page, 'M1-cli-missing');
    });
    const settingsAfter = await api(s2, '/settings');
    s2.record.settingsUnchanged = JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
    s2.record.nonGetRequests = nonGetRequests(allPages.filter((p) => p.__tag.startsWith('s2')));
    saveNet(allPages.filter((p) => p.__tag.startsWith('s2')), 's2');
    await ctx.close();
    await stopGateway(s2);
  }
} catch (error) {
  results.failures.push('harness: ' + redact(error.stack ?? String(error)));
  log('HARNESS ERROR ' + (error.stack ?? String(error)));
} finally {
  for (const s of sessions)
    if (s.child.exitCode === null && !s.record.shutdown) {
      try {
        await stopGateway(s);
      } catch (error) {
        log('stop failure ' + error);
      }
    }
  if (browser) {
    const pid = results.browser?.pid;
    await browser.close().catch((e) => log('browser close error ' + e));
    await sleep(1000);
    let alive = 'unknown';
    if (pid)
      try {
        process.kill(pid, 0);
        alive = 'ALIVE';
      } catch (e) {
        alive = e.code;
      }
    results.browser.closed = true;
    results.browser.pidAfterClose = alive;
  }
  const calls = fixtureStarts();
  results.fixture = {
    starts: calls.length,
    rejected: calls.filter((c) => !ALLOWED_ARGS.includes(c.args.join(' '))).map((c) => c.args),
    distinctArgs: [...new Set(calls.map((c) => c.args.join(' ')))],
  };
  results.finished = new Date().toISOString();
  results.summary = {
    cases: results.cases.length,
    byStatus: results.cases.reduce((acc, c) => ((acc[c.status] = (acc[c.status] ?? 0) + 1), acc), {}),
    failures: results.failures,
  };
  save();
  // Retain redacted gateway logs and the fixture call log.
  for (const s of sessions)
    for (const [kind, path] of [
      ['stdout', s.outLog],
      ['stderr', s.errLog],
    ]) {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
      writeFileSync(join(RUN, `${s.label}-gateway.${kind}.log`), redact(text));
    }
  writeFileSync(join(RUN, 'fixture-calls.jsonl'), existsSync(CALLS) ? readFileSync(CALLS, 'utf8') : '');
  log(`SUMMARY ${JSON.stringify(results.summary)}`);
  clearTimeout(watchdog);
  process.exitCode = results.failures.length ? 1 : 0;
}
