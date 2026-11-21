# Negative controls for #364: apply one production mutation at a time, run focused tests,
# record the outcome, then restore the exact original bytes (verified by SHA-256).
import hashlib, json, pathlib, subprocess, sys
repo = pathlib.Path(r'G:/ggq/gg-i4-364-claude-start/GraphGoblin')
pkg = repo / 'packages/infrastructure'
out = pathlib.Path(r'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-364-author-01/evidence/mutations')
out.mkdir(parents=True, exist_ok=True)
P = 'src/claude/process.ts'; H = 'src/claude/harness.ts'
mutations = [
  ('M1-no-stdio-error-handlers', P,
   "    child.stdout?.on('error', outputFault);\n    child.stderr?.on('error', outputFault);\n", '',
   ['src/claude/start-refusal.test.ts']),
  ('M2-enoent-means-not-installed', H,
   "  if (result.spawnCode) throw startFailure(result.spawnCode, result.startRefusal, cwd, probe);",
   "  if (result.spawnCode) throw startFailure(result.spawnCode, result.spawnCode === 'ENOENT' ? 'executable-missing' : result.startRefusal, cwd, probe);",
   ['src/claude/start-refusal.test.ts', 'src/claude/harness.test.ts']),
  ('M3-no-started-guard-on-error', P,
   "      if (settled || spawnCode || started()) return;", "      if (settled || spawnCode) return;",
   ['src/claude/process-failure.test.ts']),
  ('M4-only-literal-executable-name', P,
   "process.platform === 'win32' ? [binary, `${binary}.com`, `${binary}.exe`] : [binary]", "[binary]",
   ['src/claude/process-failure.test.ts']),
  ('M5-abort-during-observation-waits', P,
   "      if (spawnCode) {\n        finish(null);\n        return;\n      }\n      if (killing) return;", "      if (killing) return;",
   ['src/claude/process-failure.test.ts']),
  ('M6-uncertain-read-claims-absence', P,
   "return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown';", "return 'missing';",
   ['src/claude/process-failure.test.ts']),
  ('M7-probe-folder-as-configuration', H,
   "    return probe\n      ? new ClaudeHarnessError(\n          'HARNESS_TURN_FAILED',", "    return probe\n      ? new ClaudeHarnessError(\n          'HARNESS_INVALID_CONFIGURATION',",
   ['src/claude/harness.test.ts']),
  ('M8-output-failure-below-refusal', H,
   "          result.overflow ||" + chr(10) + "          result.outputFailed ||" + chr(10), "          result.overflow ||" + chr(10),
   ['src/claude/harness.test.ts']),
]
node = r"$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64"
summary = []
for name, rel, old, new, tests in mutations:
  if len(sys.argv) > 1 and name not in sys.argv[1:]: continue
  path = pkg / rel
  original = path.read_bytes()
  digest = hashlib.sha256(original).hexdigest()
  text = original.decode('utf-8')
  assert text.count(old) == 1, (name, text.count(old))
  try:
    path.write_bytes(text.replace(old, new).encode('utf-8'))
    cmd = f'$env:PATH = "{node};$env:PATH"; pnpm.cmd exec vitest run {" ".join(tests)} --testTimeout=8000 2>&1 | ForEach-Object {{ "$_" }}; "vitest-exit=$LASTEXITCODE"'
    proc = subprocess.run(['powershell.exe', '-NoProfile', '-Command', cmd], cwd=pkg, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
    log = proc.stdout + proc.stderr
  finally:
    path.write_bytes(original)
  restored = hashlib.sha256(path.read_bytes()).hexdigest() == digest
  (out / f'{name}.log').write_text(log, encoding='utf-8')
  lines = [l.strip() for l in log.splitlines() if any(k in l for k in ('Tests ', 'Test Files', 'Errors', 'vitest-exit', ' FAIL '))]
  summary.append({'mutation': name, 'file': rel, 'tests': tests, 'restored': restored, 'summary': lines[:12]})
  print(json.dumps(summary[-1]))
(out / ('summary-' + '-'.join(sys.argv[1:]) + '.json' if len(sys.argv) > 1 else 'summary.json')).write_text(json.dumps(summary, indent=1), encoding='utf-8')
