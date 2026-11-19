# README setup independent QA

The README at commit `73c30a424ed8cf6f6a5add920eaad0541508b04e` matches the tested checkout-install and first-run behavior. No unresolved material README issue was found after the author corrected the terminal badge and taskbar instructions. Product behavior was tested at public commit `10cdc55a8573e484ceb07a32fba9fe9f513a005f`; the candidate changes only `README.md`. The final README SHA-256 is `f15ecc3d1cec041f0443dd88ea7d2e65682e4237fd3dce49dbfb253782318a5d`.

A fresh public HTTPS clone was checked out at that exact product revision. Windows PowerShell 5.1 and Git Bash on Windows used Node 22.23.4 and pnpm 12.8.1, disposable stores and a private browser profile. Git Bash evidence does not establish native Linux or macOS behavior.

| Check | Result | Evidence |
| --- | --- | --- |
| Fresh checkout dependency installation and build | 801 packages installed; 12/12 cold build tasks succeeded, zero cache hits. Repeated installer runs used the same unchanged checkout. | [Provenance and results](results.json) |
| PowerShell installer, ready and logged-out cases | Exit 0 with `Install complete.`; exit 1 with sign-in guidance. | [Ready](evidence/windows-install-positive.log), [logged out](evidence/windows-install-negative-03.log) |
| Git Bash installer, ready and logged-out cases | Exit 0 and exit 1 respectively. | [Ready](evidence/git-bash-install-positive.log), [logged out](evidence/git-bash-install-negative.log) |
| Built preflight, actual bundled Codex CLI and empty isolated authentication directory | Exit 1, `Codex sign-in is missing or invalid. Run codex login, then retry preflight.` No login was attempted. | [Preflight](evidence/preflight-real-cli-isolated-auth-negative-02.log) |
| Invalid data path | Exit 1; names the non-directory data path and database creation failure. | [Preflight](evidence/preflight-data-negative.log) |
| Normal `pnpm.cmd start` and `/app/` | Real built gateway served the app on isolated IPv4 loopback. Shipped identity helper matched the health header; health PID, listener PID and data lock PID agreed. `/app/` opened Chat. | [Results](results.json) |
| README first-run path through the UI | `New loop name` → `Create` → `Publish` → `Open in Runs` → `Start run`; starter Trigger Start → Exit Done; terminal badge `succeeded`, outcome `success`, fully finalized, eight events and no inference. | [Editor](evidence/ui-06-editor.txt), [published](evidence/ui-08-published.txt), [run form](evidence/ui-10-run-form.txt), [terminal snapshot](evidence/ui-12-terminal.txt), [run](evidence/starter-run.json), [events](evidence/starter-events.json), [screenshot](evidence/starter-succeeded.png) |
| Safe shutdown | Matching instance drained with HTTP 202 and no active runs; listener, gateway and wrapper PIDs disappeared; both writer locks released; private browser closed. | [Cleanup](evidence/cleanup.json), [browser close](evidence/browser-close.txt) |
| Compose and optional launcher documentation | Compose configuration validation exited 0. README commands and launcher pin/focus behavior agree with installer source, guide 01 and existing repository acceptance documentation. | [Source bindings](results.json) |

The positive readiness checks used a deliberately synthetic Codex CLI fixture. It answered only version/help/login-status probes and refused every other operation; its complete observed command set is recorded in `results.json`. This establishes installer/preflight control flow, not real provider readiness. The install, dependency resolution, build, built gateway, browser UI, database and starter execution were real. No provider turn, paid run or personal authentication access occurred.

Container image build/startup was not exercised: Docker Desktop's Linux-engine named pipe was absent, and the daemon was not started or reconfigured. Optional desktop/taskbar installation was source-checked only; no PWA, owner shortcut, pin or installed launcher was changed. The prior native receipt at `docs/qa/windows-launcher-2026-11-07/README.md` is historical evidence, not a new native acceptance run. Successful real-provider inference, native macOS/Linux setup and post-install desktop/taskbar interaction remain outside this packet.

Initial harness failures and corrections are disclosed in [attempt notes](attempts.md). The test checkout has no tracked diff. Generated dependencies, build outputs, browser artifacts and private diagnostics remain in the private QA area. This publication copy contains no personal paths, master keys, login data or shutdown tokens.
