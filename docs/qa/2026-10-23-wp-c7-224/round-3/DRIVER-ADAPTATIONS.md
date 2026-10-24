# Audit-driver adaptations

The baseline copies retain the two audit workflows and observations. Changes select this
worktree's capture directory, ports 5760/5761, `gg-wp-c7-224-` store prefixes and `.log.txt`
names. They run from this worktree with Node 22 against its built API. The original baseline
drivers are observational: exit 0 means the workflow completed, not that the bug was absent.
The three pre-fix engine assertions provide failing regression-test output as well.

The strict after-drivers add assertions to the same native workflows. The wake driver probes
cancel with a nonexistent run ID (404) and force with an invalid action (400), instead of
actually cancelling/forcing the parent whose required child it must observe. These demonstrate
HTTP/control-route reachability without preventing normal continuation. It asserts SSE stays
open while the script is blocked, status remains in an open drain, the child marker exists
before exit 0, the stream contains the terminal event, and restart sees completed work.
Actual cancellation/force behavior remains covered by the maintained shutdown tests.

The Event after-driver requires each racing request to have a run or a clean 503, verifies
refused keys were not recorded, physically restarts, retries every key, checks duplicate status
against its original outcome, and waits for all six runs to succeed. It never accepts an empty
202 as successful admission.

Both workflows also have maintained native cases in `apps/api/src/shutdown-process.test.ts`.
No private hooks, monkey-patching, live provider turns or owner data are used.
