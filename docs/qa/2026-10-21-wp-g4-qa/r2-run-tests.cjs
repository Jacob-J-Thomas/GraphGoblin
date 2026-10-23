const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = process.cwd(),
  dir = path.join(root, 'docs/qa/2026-10-21-wp-g4-qa');
const phase = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-qa-129-r2-tests-'));
const results = [];
const clean = (s) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replaceAll(root, '<worktree>')
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>')
    .replaceAll(os.tmpdir(), '%TEMP%')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%');
function compact(log) {
  log = clean(log);
  if (log.length < 28000) return log;
  const lines = log.split(/\r?\n/);
  const failures = [];
  for (let i = 0; i < lines.length; i++)
    if (/^\s*FAIL\s/.test(lines[i])) failures.push(...lines.slice(i, i + 8));
  const worker = lines.filter((l) =>
    /Failed to start.*worker|Timeout waiting for worker|^\s*Test Files|^\s*Tests\s|^\s*Errors\s|^\s*Duration\s/.test(
      l,
    ),
  );
  return [
    'Compact original log excerpts; verbose DOM dumps omitted.',
    log.slice(0, 2200),
    ...failures,
    ...worker,
    log.slice(-6500),
  ]
    .join('\n')
    .slice(0, 35000);
}
async function execute(id, args, full = false) {
  const json = path.join(temp, id + '.json'),
    log = path.join(temp, id + '.txt'),
    request = path.join(temp, id + '-request.json');
  const actualArgs = [
    ...args,
    '--reporter=default',
    '--reporter=json',
    '--outputFile.json=' + json,
  ];
  fs.writeFileSync(request, JSON.stringify({ args: actualArgs, log }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith('GG_') && k.toUpperCase() !== 'JEV_API_KEY',
    ),
  );
  const psText = fs
    .readFileSync(path.join(dir, 'r2-test-command.ps1'), 'utf8')
    .replace(
      /^param[^\n]*\n/,
      '$RequestFile = ' +
        String.fromCharCode(39) +
        request.replaceAll(String.fromCharCode(39), String.fromCharCode(39).repeat(2)) +
        String.fromCharCode(39) +
        '\n',
    );
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', Buffer.from(psText, 'utf16le').toString('base64')],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let err = '';
  child.stdout.on('data', (x) => (err += x));
  child.stderr.on('data', (x) => (err += x));
  const [exit] = await once(child, 'exit');
  const raw = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').replace(/^\uFEFF/, '') : err;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(json, 'utf8').replace(/^\uFEFF/, ''));
  } catch {}
  const files = (data?.testResults || []).map((file) => ({
    file: path.relative(path.join(root, 'apps/web'), file.name).replaceAll('\\', '/'),
    status: file.status,
    total: file.assertionResults?.length,
    failures: (file.assertionResults || [])
      .filter((a) => a.status === 'failed')
      .map((a) => ({
        title: a.fullName || [...(a.ancestorTitles || []), a.title].join(' > '),
        messages: (a.failureMessages || []).map((m) => clean(m).slice(0, 700)),
        timeout: (a.failureMessages || []).some((m) =>
          /timed out|Timeout waiting.*worker/i.test(m),
        ),
      })),
  }));
  const result = {
    id,
    command: 'pnpm.cmd ' + args.join(' '),
    exit,
    summary: data
      ? {
          tests: data.numTotalTests,
          passed: data.numPassedTests,
          failed: data.numFailedTests,
          pending: data.numPendingTests,
          suites: data.numTotalTestSuites,
          failedSuites: data.numFailedTestSuites,
          success: data.success,
        }
      : null,
    files,
    workerFailures: [
      ...raw.matchAll(/Failed to start[^\n]*worker for test files (.+?)\.(?:\r?\n|$)/g),
    ].map((m) => path.relative(path.join(root, 'apps/web'), m[1]).replaceAll('\\', '/')),
    log: 'r2-' + id + '.txt',
  };
  if (full) {
    const summaryPath = path.join(root, 'apps/web/coverage/coverage-summary.json');
    if (/Coverage summary|%\s*\(/i.test(raw) && fs.existsSync(summaryPath))
      result.coverage = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total;
    result.coverageText = clean(
      raw.slice(Math.max(0, raw.lastIndexOf('Coverage summary') - 100)),
    ).slice(0, 2000);
  }
  fs.writeFileSync(path.join(dir, result.log), compact(raw) + '\nEXIT_CODE=' + exit + '\n');
  fs.writeFileSync(
    path.join(dir, 'r2-' + id + '-summary.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  results.push(result);
  console.log(JSON.stringify({ id, exit, summary: result.summary, coverage: result.coverage }));
  return result;
}
(async () => {
  if (phase === 'inspectors') {
    for (const [id, file] of [
      ['projections', 'src/runs/projections.test.ts'],
      ['run-inspector', 'src/runs/RunInspectorPage.test.tsx'],
      ['evaluation-details', 'src/runs/inspector/EvaluationDetails.test.tsx'],
    ])
      await execute(id, [
        '--filter',
        '@graphgoblin/web',
        'exec',
        'vitest',
        'run',
        file,
        '--maxWorkers=1',
      ]);
  } else if (phase === 'coverage') {
    const full = await execute(
      'full-coverage',
      ['--filter', '@graphgoblin/web', 'test:coverage', '--maxWorkers=1'],
      true,
    );
    const failed = [
      ...new Set([
        ...full.files.filter((f) => f.status === 'failed' || f.failures.length).map((f) => f.file),
        ...full.workerFailures,
      ]),
    ];
    const triage = [];
    for (let i = 0; i < failed.length; i++) {
      const file = failed[i];
      const alone = await execute('triage-' + String(i + 1).padStart(2, '0'), [
        '--filter',
        '@graphgoblin/web',
        'exec',
        'vitest',
        'run',
        file,
        '--maxWorkers=1',
      ]);
      const original = full.files.find((f) => f.file === file);
      triage.push({
        file,
        originalFailures: original?.failures || [],
        workerTimeout: full.workerFailures.includes(file),
        isolatedExit: alone.exit,
        isolatedSummary: alone.summary,
        classification:
          alone.exit === 0
            ? full.workerFailures.includes(file) ||
              (original?.failures?.length > 0 && original.failures.every((f) => f.timeout))
              ? 'load-class timeout: full run timeout or worker startup failure; entire file passed alone'
              : 'transient assertion: entire file passed alone; load cause not proven'
            : 'persistent isolated failure',
        evidence: alone.log,
      });
    }
    fs.writeFileSync(
      path.join(dir, 'r2-coverage-triage.json'),
      JSON.stringify({ fullExit: full.exit, failedFileCount: failed.length, triage }, null, 2) +
        '\n',
    );
  } else throw Error('Unknown phase');
})()
  .catch((e) => {
    console.error(clean(e.stack));
    process.exitCode = 1;
  })
  .finally(() => {
    const absolute = path.resolve(temp);
    if (
      path.dirname(absolute) !== path.resolve(os.tmpdir()) ||
      !path.basename(absolute).startsWith('gg-qa-129-r2-tests-') ||
      fs.lstatSync(absolute).isSymbolicLink()
    )
      throw Error('Unsafe cleanup target');
    fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5 });
    fs.writeFileSync(
      path.join(dir, 'r2-' + phase + '-cleanup.json'),
      JSON.stringify(
        { path: '%TEMP%\\' + path.basename(absolute), absent: !fs.existsSync(absolute) },
        null,
        2,
      ) + '\n',
    );
  });
