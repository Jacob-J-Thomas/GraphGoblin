# Replaying WP-C3 evidence

The original experiments ran on `9070207` with Node 22.14.0. The stored paths were
rewritten to `<local>` and `%TEMP%` after the audit. These are historical records,
not runnable database locations. The round-two fix starts from `d33514f`.

Use a disposable checkout/worktree with dependencies already installed. Never
point these scripts at an owner store. They retain `%TEMP%/gg-wp-c3-*` directories
for explicit orchestrator cleanup. Run all commands from the worktree root.
Do not run the replay concurrently with another user of ports 5780–5789.

## Round-one drivers and audits

This copies the recorded sources into the gitignored `apps/api/.tmp/` folder as
`.mjs` without a BOM. `audit.mjs.txt` carries a BOM; the copy block removes it
explicitly. The copy also selects the current allotted probe port
5781 instead of the original 5663, and stamps the current baseline rather than
misreporting a replay as the original run.

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node --version # must be v22.x
pnpm.cmd build
New-Item -ItemType Directory -Force apps/api/.tmp | Out-Null
$evidence = Join-Path (Get-Location) 'docs/qa/2026-10-18-wp-c3-evidence'
$baseline = (git rev-parse HEAD).Trim() + ' + current worktree'
$copies = @{
  'driver.mjs.txt' = 'wp-c3-investigate.mjs'
  'fast-child.mjs.txt' = 'wp-c3-fast-child.mjs'
  'audit.mjs.txt' = 'wp-c3-audit.mjs'
  'completion-audit.mjs.txt' = 'wp-c3-completion-audit.mjs'
}
foreach ($entry in $copies.GetEnumerator()) {
  $text = [IO.File]::ReadAllText((Join-Path $evidence $entry.Key)).TrimStart([char]0xFEFF)
  $text = $text.Replace('5663', '5781')
  $text = $text.Replace('9070207ee11b86c31aee54a911ff3d16992fc67f', $baseline)
  $text = $text.Replace("executionDate:'2026-10-19'", "executionDate:'" + (Get-Date -Format yyyy-MM-dd) + "'")
  [IO.File]::WriteAllText((Join-Path (Get-Location) ('apps/api/.tmp/' + $entry.Value)), $text, [Text.UTF8Encoding]::new($false))
}
node apps/api/.tmp/wp-c3-investigate.mjs
node apps/api/.tmp/wp-c3-fast-child.mjs
node apps/api/.tmp/wp-c3-audit.mjs
node apps/api/.tmp/wp-c3-completion-audit.mjs
```

The two drivers must finish before the audits. They recreate actual absolute
paths in `results.json` and `fast-child.json`. The admission audit **cannot run
against the committed redacted `results.json` as is**. It overwrites
`storage-audit.json` and `environment.json`; it also refreshes the two driver
source copies and their hashes. The completion audit reads the regenerated
manifest and overwrites `completion-audit.json`. A fresh result is a new run,
not a recertification of the historical baseline. Review/redact local paths
before retaining any replay output. The admission-audit source retains the old
`apiTeardownFailure` field as historical metadata; it does not run that test or
certify a current teardown failure.

The committed [completion-audit.json](completion-audit.json) records the original
read-only audit: **16 stores, 432 runs, zero duplicate node completions**. Its
source is now retained alongside the admission audit. Do not apply its acyclic
graph assertion to the independent review's intentionally looping graphs.

Generated `.mjs` files under `apps/api/.tmp` are gitignored but package ESLint
still sees them. After replay, preserve them as `.mjs.txt` before running lint;
do not add a lint exclusion. For example, `Rename-Item -LiteralPath
apps/api/.tmp/wp-c3-investigate.mjs -NewName wp-c3-investigate.mjs.txt`. A repeated
replay should choose an unused archive filename if that target already exists;
keep the canonical source records
under this evidence directory.

## Round-two depth regression

The maintained tests are the repeatable acceptance path:

```powershell
pnpm.cmd --filter @graphgoblin/domain exec vitest run src/poll-items.test.ts src/json-value.test.ts
pnpm.cmd --filter @graphgoblin/api exec vitest run src/triggers/poll-depth.test.ts src/triggers/poll-items.test.ts src/triggers/poll-probe.test.ts
```

`poll-depth.test.ts` uses HTTP port 5788 and real file-backed SQLite. It checks
1,100/3,000-level first items, the 996/997 boundary, middle refusal, close/reopen,
durable dedupe and repair of the previously refused key. The before/after command
record is [round2-verification.md](round2-verification.md). The native driver
source/output listed there additionally exercises the built API with three
polls, a hard kill/fresh process, two more polls, and repaired candidates.

To replay that native check after building (it uses ports 5780 and 5781):

```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
$text = [IO.File]::ReadAllText((Join-Path $evidence 'round2-native.mjs.txt')).TrimStart([char]0xFEFF)
[IO.File]::WriteAllText((Join-Path (Get-Location) '.tmp/wp-c3-r2-native.mjs'), $text, [Text.UTF8Encoding]::new($false))
node .tmp/wp-c3-r2-native.mjs
```

This overwrites `round2-native.json` with fresh observations. It terminates only
the API child processes it spawns and retains its disposable store.
