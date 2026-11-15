# PR #478 current-head CI

This packet records the first-attempt GitHub Actions readback for PR #478 after head `48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6` was published.

## Tested identity

- PR state at final readback: open.
- Candidate head: `48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6`, tree `10fa2793ec1c2ee63e45143a40af5d6ba1a93f0b`.
- Base: `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`.
- The five completed job logs show checkout of `refs/remotes/pull/478/merge` at synthetic merge `10164569c6260723495470479b065c52f5bdd0c9`. Its tree is `10fa2793ec1c2ee63e45143a40af5d6ba1a93f0b`; parents, in order, are base then head.
- CI workflow run `43676039784` (run 872) and routing run `43676039785` (run 271) both used attempt 1 and completed successfully. Final readback was captured at `2026-11-15T04:45:56Z`.

## Results

| Job                               | Result and timing (UTC)                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template image — `132696291664`   | PASS, 04:16:33–04:18:11. Built the distributed image and loaded all four shipped templates in a network-disabled, read-only container.                                                                                                                                                                                                    |
| Windows launcher — `132696291800` | PASS, 04:16:33–04:19:30. 14/14 acceptance tests passed; 0 failed, skipped, or cancelled. Test duration 79.117 s.                                                                                                                                                                                                                          |
| Browser — `132696291833`          | PASS, 04:16:33–04:40:22. Edge functional suite: 481 passed, one live-Codex-provider spec skipped, zero retries, one worker; 22.5 min. Browser coverage/exclusions step also passed.                                                                                                                                                       |
| Gates — `132696291852`            | PASS, 04:16:33–04:42:11. Acceptance, typecheck, lint, formatting, layers, migration no-op, design-token, dependency, template, 13-package coverage, licence, and generated-doc checks passed. Lowest package coverage was 95.00% lines and 90.55% branches. Dependency audit reported 21 vulnerabilities (8 low, 13 moderate; none high). |
| Routing — `132696291601`          | PASS, 04:16:33–04:18:40. Two Edge cases each measured three 5-second drags: 100 nodes / 200 edges had median routing p95 4.5 ms and frame p95 16.8 ms; 300 nodes / 600 edges had median routing p95 4.1 ms and frame p95 33.3 ms. All per-drag routing p95s met the normal PR limit (<16 ms), and both medians met <8 ms.                 |

The routing frame p95 is reported by the normal PR workflow but is not a normal PR gate. The 300-node value exceeds the separate manual <17 ms frame target; the historical [initial #478 CI packet](https://github.com/Jacob-J-Thomas/GraphGoblin/tree/48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6/docs/qa/2026-11-14-canvas-initial-ci) records a similar 33.2–33.3 ms 300-node frame result. This packet therefore makes no new-regression claim and no 60-fps claim.

These results establish only the listed first-attempt CI jobs for the synthetic merge commit. They do not record a merge or establish owner acceptance.

## Readbacks and raw logs

- [Final PR, run, job, and merge readback](final-readback.json)
- [Candidate identity record](ci-identity.json)
- Initial job snapshots: [CI](root-initial-jobs-43676039784.json), [routing](root-initial-jobs-43676039785.json)
- [Decoded logs and SHA-256 manifest](log-manifest.json)
- CI logs: [template image](workflow-43676039784/template-image-132696291664.log), [Windows launcher](workflow-43676039784/windows-launcher-132696291800.log), [browser](workflow-43676039784/browser-132696291833.log), [gates](workflow-43676039784/gates-132696291852.log)
- Routing log: [routing](workflow-43676039785/routing-132696291601.log)

The raw job logs are preserved as decoded UTF-8 text with their observed LF/CRLF sequences and leading BOMs. `.gitattributes` disables Git line-ending conversion for the logs and JSON metadata. SHA-256 checks are in `SHA256SUMS`.
