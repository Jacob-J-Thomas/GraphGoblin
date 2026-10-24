# Whole-repository format scan did not complete

`pnpm.cmd format:check` ran with Node 22 and printed `Checking formatting...` but
produced no completion result during the extended scan. The worker interrupted it;
this is not an accepted format-gate pass. The first capture attempt was also interrupted
and its raw output was not kept; the retained second attempt is format-check.log.txt.

All changed source and Markdown files were passed through the repository's Prettier
configuration. A separate changed-file `prettier --check --ignore-unknown` diagnostic is
retained as format-changed.log.txt. It does not replace the required whole-repository
gate. No formatter configuration, exclusion or package script was changed.

A final scan after all worker-owned coverage jobs finished also remained at
`Checking formatting...`. Ctrl-C did not stop the native child. Its exact worktree
command and cwd were verified, then only that formatter PID was stopped. The
command exited -1; this is not an accepted pass. See format-check-final.log.txt.
