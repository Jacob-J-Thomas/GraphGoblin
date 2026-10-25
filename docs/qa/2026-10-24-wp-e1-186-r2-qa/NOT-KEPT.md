# Captures not retained in QA evidence

Files above 1,000,000 bytes are left in the ignored .tmp/qa186/ directory for orchestrator disposal. They are not linked as inspectable report evidence. Digests identify the exact raw captures; summaries and assertions are retained separately.

| Temporary capture          |     Bytes | SHA-256                                                          | Reason                                                                                        |
| -------------------------- | --------: | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| baseline.tar               | 374609920 | ee763007193544f315d6c613ac71876fd75883c4a730a82bb2eb42811fe2cd59 | Above the 1,000,000-byte retained capture limit; remains only in ignored temporary workspace. |
| benchmark-after-full.json  |   2032966 | 3f7d95e6178ee679477e6eb44987bfde29471a2b9bf29e001b51e97cc2d50bb4 | Above the 1,000,000-byte retained capture limit; remains only in ignored temporary workspace. |
| benchmark-before-full.json |   2032227 | 6b060b2791152904cd4b9eebc34b19fedfa6098eaddb86f913c6ec62e2833367 | Above the 1,000,000-byte retained capture limit; remains only in ignored temporary workspace. |
| heavy-full.json            |   3733729 | be3b60cdcb25fcb8776805910ee6c1dadb610157c221521ead658150f263c502 | Above the 1,000,000-byte retained capture limit; remains only in ignored temporary workspace. |
| paused-full.json           |  32016871 | 95a6da325f5aa6b5a397671e503e8659f40c243e22ef1739945deeb1595e5e2d | Above the 1,000,000-byte retained capture limit; remains only in ignored temporary workspace. |
