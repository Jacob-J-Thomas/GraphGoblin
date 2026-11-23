# #466 probe-directory test lifecycle

Claude Code ran Claude Opus 5.5 at xhigh effort for the implementation and correction. An OpenAI GPT agent ran the independent Windows behavior QA.

1. [Initial implementation](../2026-11-17-probe-466-implementation/README.md) established ownership of the fake CLI and probe cleanup. Its 7/7 focused run and adapter coverage apply to the original candidate.
2. [Initial independent QA](../2026-11-17-probe-466-qa-initial/README.md) reproduced the five-second Vitest deadline and verified that cleanup finished before the successor. Its double-fault case found that a case-root removal error concealed the late body error.
3. [Implementation correction](../2026-11-17-probe-466-correction/README.md) preserves both errors. The added regression fails against the original helper and passes against the correction.
4. [Corrected independent QA](../2026-11-17-probe-466-qa-final/README.md) verified all three errors in the real Vitest output, confirmed that the successor passed, and passed the nine-case focused suite.

Opposite-family formal review, required CI at the publication head, and the final audit remain pending. Dependency audit issue #503 remains open.
