# #514 first formal ownership finding

The first independent formal review for #481 returned **CHANGES REQUIRED** on head `95c759b7b7d466b1e4c0b9e7a36389d55b96eb6b`, against base `10cdc55a8573e484ceb07a32fba9fe9f513a005f`. Review tree `56620c63865e53d338e461a1aef52b95f7591dfb` also identifies the tested hosted merge tree. This is scan 1 of 3. The [full review](report.md) is byte-identical to the original and matches its published SHA-256 `0fb897e128f03d90a792f625b1d1f1be7b89c9ae502701d44912f296e31edf5b`. [Source and artifact provenance](provenance.json) · [Published review](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/514#issuecomment-7000862479) · [Coordinator disposition](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/514#issuecomment-7000820553)

## Six direct store cases

Two outgoing records from one Decision can share an edge ID. When the second Decision row temporarily takes the first row's ID, a subsequent rename retargets the first row's connection. Removing the second row at that point previews and deletes the first connection, including its manual geometry. The second connection remains on its original port. The direct rename with shared edge IDs and all three unique-edge-ID controls preserve the first connection. The driver asserted exact Undo for all six journeys. [Collision reproduction](ownership-probe-run2.json) · [Six recorded outcomes](ownership-controls.json) · [Portable case driver](ownership-controls.mts)

These cases use synthetic in-memory state and the product store. They establish the wrong-record rewrite and removal directly. A fresh native browser reproduction and server autosave were outside this scan. The first launcher attempt stopped at Windows ESM URL resolution before any product code ran. [First launcher failure excerpt](ownership-probe.json)

## Maintained tests and recorded checks

The reviewer observed 259 tests passing in seven focused files and all 20 Decision-route tests passing. Separately, 19 read-only checks verified 97 listed publication files, 16 bound source files, and selected history, metadata, recovery and protected-voice records. The earlier focus packet replayed 22 checks. The real recorder packet replayed 12 recorded facts without starting another browser. Its **Record again** path is distinct from the hosted **Try again** failure at the old immediate focus assertion. [Focused suite](focused-tests.txt) · [Decision-route suite](decision-tests.txt) · [Record verification](evidence-check.json) · [Focus replay](focus-replay.json) · [Recorder replay](browser-publication-replay.json) · [First hosted failure excerpt](hosted-focus-failure.txt)

The exact-head ordinary CI, canonical Windows replay and separate routing outcomes are retained as coordinator-verified receipts. The formal reviewer inspected those receipts. The scan did not independently download and replay those current hosted archives or rerun broad coverage, browser, launcher or routing suites. The full review retains the 15-second reconnect miss, eventual same-journey recovery and separately scoped device metadata observations. [Ordinary CI](normal-ci-receipt.json) · [Windows replay receipt](native-windows-ci-receipt.json) · [Routing receipt](routing-ci-receipt.json)

## Replay and integrity

With Node 22.23.4 and pnpm 12.8.1, run the commands from the installed exact reviewed checkout. Set `$packet` to the directory containing this README. The development export condition resolves the workspace packages from source without a build.

```powershell
$checkout = (Get-Location).Path
$env:NODE_OPTIONS = '--conditions=development'
pnpm.cmd --filter @graphgoblin/web exec tsx "$packet/ownership-controls.mts" $checkout
pnpm.cmd --filter @graphgoblin/web exec tsx "$packet/ownership-probe.mts" $checkout
node "$packet/evidence-check.mjs" $checkout
```

Each replay matched the corresponding original JSON. The public projection replaces private checkout roots with a supplied path or a placeholder. The original byte counts and SHA-256 digests are recorded for every projection. The full report, underlying result JSON, original hosted focus excerpt and hosted coordinator receipts retain their exact bytes. [Verification](verification.json) · [Publication manifest](publication-manifest.json)
