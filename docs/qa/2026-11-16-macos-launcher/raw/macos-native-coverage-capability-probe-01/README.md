# Native Swift coverage capability

This prepared probe measures coverage export for one standalone Swift file on the owner Mac's installed Command Line Tools. It compiles an unoptimized arm64 program with both Swift profile flags, runs it once with a private LLVM_PROFILE_FILE, merges the resulting profile and exports the JSON mapping. The command line selects the arm returning 81. The arm returning -42 remains unexecuted.

The known strict SSH transport pins its SSH host and native Node and creates one fresh physical stage at /Users/jake/Library/Caches/graphgoblin-456-coverage-capability-70ad5b9607d94198a4b975a1b6005309. All seven tool and witness processes use explicit environments and the private stage. The compile deadline is 60 seconds and the witness deadline is 5 seconds. Each phase captures its actual exit and both output streams with caps, including at most 1 MiB of LLVM export. SSH has a 120-second deadline and zero automatic retries. The phase watchdog may stop only the direct phase process it launched. The stage and all local artifacts are retained.

## Operator readback

Read CoverageProbe.swift, coverage-probe.mjs and run-coverage-probe.mjs in full and compare the three SHA-256 digests against SHA256SUMS.txt. In this directory with project Node 22 selected, save the fixed wrapper's preview and inspect its strict SSH arguments. Display only the digest metadata in chat.

```powershell
node .\run-coverage-probe.mjs --preview | Set-Content -Encoding utf8NoBOM .\root-preview.json
$coveragePreview = Get-Content -Raw .\root-preview.json | ConvertFrom-Json
$coveragePreview | Select-Object commandSha256,swiftSha256,probeSha256,timeoutMs,maxBuffer,automaticRetries
```

After operator admission, invoke once with the inspected command digest.

```powershell
node .\run-coverage-probe.mjs --run $coveragePreview.commandSha256
```

Review receipt/receipt.json for the SSH exit and raw stream hashes, receipt/summary.json for tool exits, EOF, scope, source and profile identities, and receipt/coverage-export.json for the raw LLVM mapping. The three version phases preserve Swift, llvm-profdata and llvm-cov output. The line control requires nonzero covered lines, a missed line, and counts above zero and exactly zero for the taken and untaken return locations respectively. If the line control holds but the branch denominator is zero, this toolchain exported line counts for a witnessed conditional with no reported branch denominator. The owner toolchain and fixture are distinct from hosted Xcode and launcher coverage.
