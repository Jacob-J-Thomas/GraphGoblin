# Independent D240 B1 cancellation correction QA

**B1 bounded correction independently verified.** The identical seven-case fixture produced three cancellation/revisit failures and four passing retirement negatives on old head 308209, then passed 7/7 with zero skips on corrected head 458f6cb. Both were first behavioral runs at their admitted heads; the original failures remain intact.

| Phase | Immutable head / tree | Actual result |
| --- | --- | --- |
| Old | `30820901e97e2ba3af0e9796b39f14b5d421b99d` / `eab694eaaf05d3698d359f4983872d7c4c08fba1` | 3 failed, 4 passed, 0 skipped; exit 1 |
| Corrected | `458f6cb06eded5cfeb2cf243093b60521a46f676` / `09b29aabeef6ab7e4c4d53dc4f8d2b3b5444d5d6` | 7 passed, 0 failed, 0 skipped; exit 0 |

The executed independent fixture is byte-identical in both phases: SHA-256 `ff386e99e6e1c8a31590e6de29551bbe646d7377f433656697b1f96b26e2764c`, copied as `old/06-executed-fixture.tsx` and `corrected/04-executed-fixture.tsx`. Only fixture formatting preceded the old run; no logic change, behavioral retry, timeout increase or threshold change occurred. The case names and parametrization are identical. Old formatting/scoped lint and complete web typechecking passed; fresh complete web typechecking passed on the corrected head. Unchanged lint/format were not repeated.

## What changed in the outcomes

The three old failures were:

- Public QueryClient cancellation before a paused GET starts: the physical query retains its body object and update count, but the old helper clears the positive receipt.
- Public cancellation during the first retry-delay window after transport failure: the same revision survives, but its old receipt becomes 0.
- Actual useRun last-observer removal during retry delay, with an observed public cache revert, followed by offline remount: cached data survives while proof was retired.

All three corrected cases retain exactly the previous positive receipt. It remains below the existing loss boundary, and cancellation does not move that boundary or authorize recovery. The useRun positive additionally checks the offline remount and no extra GET. The public retry-delay checkpoint uses the first 1000 ms production delay; no wait-to-green or deadline change is used.

The four manual/refusal/body-object/update-count negatives pass at both heads. They cover already-retired proof, a different object, a different count, paused cancellation and attempted restoration of the old public state. They show no resurrection of retired proof in these schedules. They do not establish a universal defense against internal same-object/count/idle state reproduction. D240's accepted synthetic restoration limitation remains explicit.

## Source, index and dependency boundaries

Root alone fast-forwarded the disposable QA checkout between phases. `ROOT-REBIND.json` records the intentional index transition from `e05e6b78f0ba39dc7786e9cce2996fce839cd5960dc2ae900ef22f4469d6913f` to `6c49a9223faba9b61f6da8e73a82e357e61bab116283dbfa6cc552477d725276`. This is not reported as an unchanged index across the rebind. Within each phase, raw index, ordered staged entries, head/tree, all comparable descriptors and common-index absence remained unchanged. QA performed no Git/index mutation or helper edit.

The only tracked paths changed by root between the captured phases are the helper and its authored test file. Helper SHA-256 changed from `c5fd15d3d355bb2928bb196f7c36371b3588f1d639b63da110e8d2c6808ab0c5` to `227f962e9a71e45b6246213ef37b677eaff55267bff4ceadacb123be2f9a2401`; authored tests changed from `ac973020e0f797cff6eb81454cb5b5b2c4857b91a089502217e15f5f394a506b` to `a6c40321adc8dcfcc934c81bb57e5d92470dc5f3ebbbb21794097a0fa5a23e7e`. The queries hash and both untracked independent overlays were preserved. The prior independent overlay remains `cb45677d8be4b81165b86e2832309c67b81c7c04c617cf68bb1c04682a593292`.

**Inventory coverage qualification:** 41,003 is a tracked descriptor count, not 41,003 physical file hashes. The worktree omits 39,235 historical docs/qa paths under its sparse checkout. The current raw NUL-delimited Git path list establishes 1,768 non-QA paths, all physically present and hash-matching the corrected before/after inventories; there are no missing non-QA paths or hash drift. Per-phase descriptor equality includes the explicit null archive entries. The old 36-member packet is immutable; this paragraph and `COMPARISON.json` supersede any old shorthand claiming every tracked descriptor was a physical SHA. Omitted archive bytes were not materialized or claimed verified.

Node 22.23.4, selected resolved package/entry identities, package lock and the three recorded pnpm metadata files remained unchanged within and across phases. Existing task-local dependencies were used; no install/copy occurred. These are selected dependency boundaries, not complete installation identity. `COMPARISON.json` retains per-phase comparisons and the explicit root rebind.

## Evidence and limits

Each command has original stdout/stderr and actual exit receipts. Raw old/new test JSON, case selection, executed fixture bytes, source/module before/after inventories and the first failures are retained. The old manifest remains byte-identical at `a6aec3d1c3091e1424fb0321bb65979ef8982ab354a54e72b92d9ac3c3bd99ee`. The consolidated manifest includes that packet and all corrected-phase evidence.

The tests use real public TanStack cache/query behavior and actual useRun with repository FakeApi/custom HTTP transport and controlled online state. This proves the named core cancellation schedules only. No real listener, browser, provider operation, installation, full old 46 rerun, page/header suite or general review scan ran. No packet capture or universal network-absence claim is made. The UI/control contract, real-listener fallback eligibility and body shape, full web/repository gates, actual Claude named confirmation/review, current CI, final audit and signed delivery remain separately required. This packet does not complete owner acceptance or any UI criterion.

Primary evidence: `COMPARISON.json`, `ROOT-FREEZE.json`, `ROOT-REBIND.json`, `CURRENT-GIT-PATHS.z`, the immutable `old/` packet and all corrected raw receipts/JSON/inventories. After final sealing, the heavy slot is released to root; no further execution is queued by this QA.

