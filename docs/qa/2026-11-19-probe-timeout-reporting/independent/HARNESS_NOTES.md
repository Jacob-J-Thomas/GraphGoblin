# Harness and scope

This compact component retains only six relevant new runs. No historical run corpus was copied. Full external preparation and source-export metadata remain in the parent packet; actual replay paths are retained in commands and configs.

The established public Vitest 5.0.3 Node API driver was reused under project Node 22.23.4. Existing isolated dependencies have the same frozen dependency-lock hash as the held production export. No install or package-store operation occurred. Source modules came from the separate immutable QA export, while every test helper and maintained assertion came from exact snapshot 02.

The midbody cases select the maintained `without an abort` combined-fault row. QA first awaits the real builtin import, then deliberately withholds its already-available value until 650ms after the genuine default 5000ms enclosing deadline. No test/hook timeout or retry was configured. This is an artificial suspension at that precise await boundary, not evidence that the real import naturally blocks for five seconds.

In the identity countercontrol, QA creates a fresh Error after the real timeout, assigns the original name, message and stack strings to it, records strict object inequality, then throws it before the local fault mock is installed. Both errors must remain even though their complete reporter strings are identical. The successor therefore checks that the local mock was either restored or never installed, in addition to empty case resources and restored environment. The original-reason variant returns the held import value normally, so the maintained nested guard throws the actual original abort reason; that duplicate must be suppressed.

The F2 controls invoke real `Vitest.cancelCurrentRun('keyboard-input')` from a beforeEach handshake and prove that the enclosing signal is already aborted before entry. Acceptance checks each selected assertion's actual skipped status and zero work/errors. The interrupted process still exits 1. Normal negative controls also exit 1 but have genuine failed tests; the ordinary focused suite exits 0.

Vitest's nanoid temp entry is present during the worker and disappears on `vitest.close()`. The wrapper's own temp root is removed only after observation. The deliberate root-removal-fault control retains one empty case root until the successor records it, then disposes it externally after all process/resource receipts. No owner process or author checkout was operated.

There was no new source repair, adversarial/general review, live-provider call, remote write, Git/index change or publication. The coordinator separately gates any publication on the final author source matching this exact snapshot.
