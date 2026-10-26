# Evidence not kept

The first browser run had two test-fixture failures, corrected before the second run. Error context is preserved in the adjacent .log.txt files. Playwright clears its disposable output directory on the next run; these trace archives are not retained.

- apps/web/test-results/model-effort-classifier-ke-efa62-r-visible-and-has-no-effort-chromium/trace.zip: 1351392 bytes; SHA-256 188842F6B4E15828F9EF69155AEADFC414EA043200592AA6C64406C4849389B2; not kept.
- apps/web/test-results/model-effort-a-saved-unsup-df431--refused-before-the-adapter-chromium/trace.zip: 17762 bytes; SHA-256 87C355663AE1B7DC971C666BF1F055F394EBE9BCAB05AB20D07488F9B3A2BC34; not kept.

- Second run apps/web/test-results/model-effort-a-saved-unsup-df431--refused-before-the-adapter-chromium/trace.zip: 1666941 bytes; SHA-256 A0AADE5E8F2877A83C14DECA61A35EF99EBE8E324A45FDE8898BDDE5178A2769; not kept. The admission assertion was corrected to check the public terminal failure before any provider request.

Baseline Playwright trace archives were replaced by subsequent test runs and were not kept; their sizes and hashes were not recorded. The baseline command log, reproduction source, editor text and screenshots are retained. No acceptance claim relies on those archives.

Console logs are normalized to UTF-8 with local home paths redacted as %USERPROFILE%. Raw reproduction source and PNG bytes are unchanged. Final retained-file hashes are recorded in SHA256SUMS.log.txt.
