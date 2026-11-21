// Reverse the documented attempt-2 instrumentation edits to reconstruct the run-01 driver bytes.
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
let s = readFileSync(src, 'utf8');
const swap = (from, to) => {
  if (!s.includes(from)) throw new Error('missing: ' + from.slice(0, 80));
  s = s.split(from).join(to);
};
swap(
  "const RUN = attempt.dir;\nconst RUN_TAG = `run${String(attempt.i).padStart(2, '0')}`;\n// Per-attempt scratch state (run-01 used fixture/calls.jsonl and unsuffixed store/home/log names).\nconst CALLS = join(S, `fixture/calls-${RUN_TAG}.jsonl`);\n// Retain the exact driver and fixture bytes used by this attempt.\nwriteFileSync(join(RUN, 'ui-qa.used.mjs'), readFileSync(fileURLToPath(import.meta.url)));\nwriteFileSync(join(RUN, 'fixture-codex.used.mjs'), readFileSync(FIXTURE));",
  'const RUN = attempt.dir;',
);
swap('const FORBIDDEN_PORTS', "const CALLS = join(S, 'fixture/calls.jsonl');\nconst FORBIDDEN_PORTS");
swap("  const home = join(S, 'home', `${label}-${RUN_TAG}`);\n  const temp = join(S, 'temp', `gateway-${label}-${RUN_TAG}`);", "  const home = join(S, 'home', label);\n  const temp = join(S, 'temp', 'gateway-' + label);");
swap("    GG_DATA_DIR: join(S, 'stores', `${label}-${RUN_TAG}`),", "    GG_DATA_DIR: join(S, 'stores', label),");
swap(
  "  const outLog = join(S, 'logs', `${label}-${RUN_TAG}-gateway.stdout.log`);\n  const errLog = join(S, 'logs', `${label}-${RUN_TAG}-gateway.stderr.log`);",
  "  const outLog = join(S, 'logs', `${label}-gateway.stdout.log`);\n  const errLog = join(S, 'logs', `${label}-gateway.stderr.log`);",
);
swap(
  "const interceptCounts = {};\nlet activeSession = '';\nconst bump = () => (interceptCounts[activeSession] = (interceptCounts[activeSession] ?? 0) + 1);\n\nasync function startGateway(label, webDist, extra = {}) {\n  activeSession = label;\n",
  'async function startGateway(label, webDist, extra = {}) {\n',
);
swap(
  "  // Server-side cross-check: gateway request log vs browser-observed requests minus intercepted.\n  const prefix = session.label.slice(0, 2);\n  const browserObserved = allPages.filter((p) => p.__tag.startsWith(prefix)).reduce((n, p) => n + preflightRequests(p, 0), 0);\n  const intercepted = interceptCounts[session.label] ?? 0;\n  const serverLogged = serverPreflightCount(session);\n  record.preflightAccounting = { serverLogged, browserObserved, intercepted, match: serverLogged === browserObserved - intercepted };\n  log(`${session.label}: shutdown ${JSON.stringify(record.shutdown)} accounting ${JSON.stringify(record.preflightAccounting)}`);",
  '  log(`${session.label}: shutdown ${JSON.stringify(record.shutdown)}`);',
);
swap('        intercepted += 1;\n        bump();', '        intercepted += 1;');
swap("(route) => (bump(), route.fulfill({ json: { items } })))", "(route) => route.fulfill({ json: { items } }))");
swap("(route) => (bump(), route.fulfill({ json: { items: [claudeReady, ollamaReady] } })))", "(route) => route.fulfill({ json: { items: [claudeReady, ollamaReady] } }))");
swap(
  "  results.browser = { channel: 'msedge', version: browser.version(), playwright: createRequire(join(REPO, 'apps/web/package.json'))('@playwright/test/package.json').version };\n  const launched = await census('after browser launch');\n  results.browser.ownedEdgePids = launched.rows.filter((r) => /msedge/i.test(r.name ?? '')).map((r) => r.pid);\n",
  "  const bproc = browser.process?.();\n  results.browser = { channel: 'msedge', version: browser.version(), pid: bproc?.pid ?? null, playwright: createRequire(join(REPO, 'apps/web/package.json'))('@playwright/test/package.json').version };\n",
);
swap(
  "      check(c10, 'restored: open pages in context', ctx.pages().length === 1, ctx.pages().map((p) => p.__tag), ['s1-main']);\n",
  '',
);
const enterKeyStart = s.indexOf('  session.record.keyEnteredThroughPanel = true;\n  // Attempt 2:');
const enterKeyEnd = s.indexOf('// ---------------------------------------------------------------- items for INTERCEPT cases');
if (enterKeyStart < 0 || enterKeyEnd < 0) throw new Error('enterKey block not found');
const tailStart = s.indexOf('function nonGetRequests(pages)');
s =
  s.slice(0, enterKeyStart) +
  '  session.record.keyEnteredThroughPanel = true;\n  return page;\n}\n' +
  s.slice(tailStart, enterKeyEnd) +
  s.slice(enterKeyEnd);
swap(
  "  if (browser) {\n    await browser.close().catch((e) => log('browser close error ' + e));\n    await sleep(1500);\n    const after = await census('after browser close');\n    results.browser.closed = true;\n    results.browser.ownedProcessesAfterClose = after.rows;\n    results.browser.ownedEdgePidsAlive = (results.browser.ownedEdgePids ?? []).filter((pid) => {\n      try {\n        process.kill(pid, 0);\n        return true;\n      } catch {\n        return false;\n      }\n    });\n  }",
  "  if (browser) {\n    const pid = results.browser?.pid;\n    await browser.close().catch((e) => log('browser close error ' + e));\n    await sleep(1000);\n    let alive = 'unknown';\n    if (pid)\n      try {\n        process.kill(pid, 0);\n        alive = 'ALIVE';\n      } catch (e) {\n        alive = e.code;\n      }\n    results.browser.closed = true;\n    results.browser.pidAfterClose = alive;\n  }",
);
const leakStart = s.indexOf('  // Synthetic QA key leak scan');
const leakEnd = s.indexOf('  log(`SUMMARY ${JSON.stringify(results.summary)}`);');
s = s.slice(0, leakStart) + s.slice(leakEnd);
writeFileSync(out, s);
console.log('reconstructed bytes', Buffer.byteLength(s));
