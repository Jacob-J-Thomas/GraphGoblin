# Independent review-correction QA

The correction was tested on Windows with Node 22.23.4. The working-tree launcher source SHA-256 was `198d226e2ca5253796613a53b05b9247949ed8e63dc86cdab540faf2d2d22bee`. The acceptance file SHA-256 was `73941795eb8da79dcf552fd51bae7c699e1e360cd84a106735fbf56749d2a215`.

Four selected native CLI cases passed. The launcher refused an oversized identity result and retained the last known ownership path, refusal reason and safety instructions across timed-out, failed and malformed ownership rechecks. The timeout case completed in 4.19 seconds with a four-second configured release wait.

Two temporary source mutations demonstrated regression coverage.

- Removing only the stdout overflow guard caused the overflow test to fail. The helper starts with a valid identity, then emits 300,000 spaces and a suffix that falls outside the capture cap. The retained prefix trims to the valid identity, so the mutated launcher exited 0 where the test required a refusal.
- Restoring the previous ownership recheck exception handler caused both deterministic retry tests to fail at the retained safety-guidance assertion. One recheck exited 7 and the other emitted malformed output.

The [replay](qa-correction.mjs) copies the acceptance suite and launcher into separate disposable worktree directories. It compiles each variant and runs the selected native CLI tests on ephemeral ports. [Raw test output](qa-correction.json).
