# #436 bound baseline skipped after an ordinary Windows test failure

Run 895 completed the build, then the ordinary Windows launcher suite failed one test. GitHub skipped the admitted #436 step. The checksum-corrected binder, driver and ETW session did not start. No installer cases ran. [Hosted Windows job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43804982239/job/133093664323)

## First failure

The ordinary suite reported 16 pass, 1 fail and 0 skip. Its checkout-alias test passed for the real junction and directory symlink. The failing top-level test was `independent API processes never share ownership while reclaiming a reused PID`, declared at `tooling/scripts/windows-launcher.acceptance.mjs:1017`.

Each of its three recorded trials had one acquisition and four refusals. The acquisition PIDs were 1492, 6988 and 3996. In trial 3, refused PID 952 reported `EPERM: operation not permitted, unlink` on `graphgoblin.lock.reclaim\f329e56b-7b4b-4fa1-a1da-8aa04ff7a766.json`. That message did not match the test's accepted ownership-refusal diagnostics, so the ordinary suite exited 1. The trial records show a single acquired owner per trial and preserve the unexpected refusal. The cause of the unlink error was unobserved. The ordinary artifact step found no uploadable files in its configured path, so the full job log is the retained ordinary-test evidence.

## Identity and archived scope

Actions run 43804982239, attempt 1, Windows job 133093664323 checked out actual merge `190ef604417887325ab557edd31884cbed68cd26`, tree `382dcd6fa76f8b04a914787e08d9291d1672d088`. The first parent was actual post-#435 main `be633141be5a0cd2b4f960a46761fabbf2cb82c7`; the second was carrier head `36048e8f40cda520c2ec7b5865d3ff8c5bae6624`. Independent committed-object readback matched all 60 test carrier paths, the reviewed workflow and 18 raw packet files including both seals. The prepared driver and execution seals were `ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a` and `b134339e89f697440e3884b771143db2538d26453791a5cfdea4f36488132495`.

Artifact 14198461124 is a 628-byte ZIP, SHA-256 `44c9aaf780900553f6afee930111223d3db32200ea3d6a2d309b3a06f13dc4e7`, containing only the 790-byte build receipt. The receipt records Node 22.23.4, real build exit 0, and the same index SHA-256 before and after build. Complete runtime binding, fresh Unicode link identity or metadata, refusal and collision results, and ETW observations are unavailable because the #436 step was skipped.

The decoded Windows log is 80,100 bytes, with leading BOM and final CRLF preserved, SHA-256 `de04cc1c09cd0254d5d0d1c36596ef5030b4eba9b8727f59da4a1ab11a216c51`. Raw GitHub responses, ZIP, build receipt and independent readback are sealed with this report. This readback triggered no retry or product changes.
