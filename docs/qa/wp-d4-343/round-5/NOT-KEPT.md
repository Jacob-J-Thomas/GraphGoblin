# Captures not kept

Captures above 1,000,000 bytes and raw trace archives with embedded local paths are not retained. Sizes and SHA-256 hashes identify the omitted bytes.

- `before-test-results/events-refresh-Events-admi-13694-ilters-and-pages-again-240--chromium/trace.zip`: 17245 bytes; SHA-256 `7482f8dfa4dee08a27b093ffd5a908540c05c2e446dd311fb51b21caaf9c2746`.

## Raw Playwright output folders (not committed by the orchestrator)

These folders hold Playwright test output whose generated paths exceed the Windows path limit, so they cannot be committed or checked out on a default Windows clone. The README and logs keep their results; the files are identified here.

- `before-test-results/.last-run.json`: 96 bytes; SHA-256 `e6f9c142b2814dea84f6cdaeafc9291a4e8ca83431a30eee006bf91aa8f8bb71`.
- `before-test-results/events-refresh-Events-admi-13694-ilters-and-pages-again-240--chromium/error-context.md`: 8076 bytes; SHA-256 `2e85ca62bf682c6bb9428f7942c6aeab06a8cb80f1024f7de95f438f76210cdd`.
- `events-test-results/.last-run.json`: 45 bytes; SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
- `responsive-screens-test-results/.last-run.json`: 45 bytes; SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
- `responsive-screens-test-results/responsive-responsive-dark-b680d-at-360-768-1024-and-1440-px-chromium/attachments/scroll-width-table-052fc82bf4cea8849af3e801728815bc2c0fe170.md`: 2231 bytes; SHA-256 `078dd4396bb463651edd803e4258949615a7bdd1e6fbaee70d3ccc867b0b3130`.
- `responsive-screens-test-results/responsive-responsive-dark-b680d-at-360-768-1024-and-1440-px-chromium/attachments/scroll-widths-c013f831254ab7ea10d2595d1b43399896abeabd.json`: 9167 bytes; SHA-256 `79728bc3a227fe9e0007791f07f45c88274f22a737d93a7b57bc84808425f762`.
- `responsive-screens-test-results/responsive-responsive-dark-b680d-at-360-768-1024-and-1440-px-chromium/scroll-widths.json`: 9167 bytes; SHA-256 `79728bc3a227fe9e0007791f07f45c88274f22a737d93a7b57bc84808425f762`.
- `responsive-screens-test-results/responsive-responsive-dark-b680d-at-360-768-1024-and-1440-px-chromium/scroll-widths.md`: 2231 bytes; SHA-256 `078dd4396bb463651edd803e4258949615a7bdd1e6fbaee70d3ccc867b0b3130`.
- `responsive-screens-test-results/responsive-responsive-ligh-0e15b-at-360-768-1024-and-1440-px-chromium/attachments/scroll-width-table-455cfbc8a0e87a6cb81acaab5efba606abac29f8.md`: 2231 bytes; SHA-256 `e9abfdcac7932d34a412edae332b6872863cd34e2a1c9255c3dea9c45f7ddd09`.
- `responsive-screens-test-results/responsive-responsive-ligh-0e15b-at-360-768-1024-and-1440-px-chromium/attachments/scroll-widths-9a0e8001801d896355a938979bb6c1d49314fdb7.json`: 9251 bytes; SHA-256 `ebeec357d7244a5d09920eb25e11c2be01f12c18541dc5f0356b716b311b5fa6`.
- `responsive-screens-test-results/responsive-responsive-ligh-0e15b-at-360-768-1024-and-1440-px-chromium/scroll-widths.json`: 9251 bytes; SHA-256 `ebeec357d7244a5d09920eb25e11c2be01f12c18541dc5f0356b716b311b5fa6`.
- `responsive-screens-test-results/responsive-responsive-ligh-0e15b-at-360-768-1024-and-1440-px-chromium/scroll-widths.md`: 2231 bytes; SHA-256 `e9abfdcac7932d34a412edae332b6872863cd34e2a1c9255c3dea9c45f7ddd09`.
- `responsive-touch-test-results/.last-run.json`: 45 bytes; SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
- `responsive-touch-test-results/responsive-responsive-dark-70e5d-controls-are-at-least-44-px-chromium/attachments/touch-target-sizes-92bc8471b2b1404a9bd0dcd178047f3e7761d766.json`: 1401 bytes; SHA-256 `71d6098ee1cc91fa6f507fa742814e6784633b74e1299c071d0cc76eac6d5866`.
- `responsive-touch-test-results/responsive-responsive-dark-70e5d-controls-are-at-least-44-px-chromium/touch-targets.json`: 1401 bytes; SHA-256 `71d6098ee1cc91fa6f507fa742814e6784633b74e1299c071d0cc76eac6d5866`.
- `responsive-touch-test-results/responsive-responsive-ligh-d8b9d-controls-are-at-least-44-px-chromium/attachments/touch-target-sizes-a04586b0141309e9ce44bac1e344ff97eb0ace42.json`: 1414 bytes; SHA-256 `b04bfc615860d2934d80a372c72fceb0071c012fc1f3e6b281b1cdb459f36881`.
- `responsive-touch-test-results/responsive-responsive-ligh-d8b9d-controls-are-at-least-44-px-chromium/touch-targets.json`: 1414 bytes; SHA-256 `b04bfc615860d2934d80a372c72fceb0071c012fc1f3e6b281b1cdb459f36881`.
