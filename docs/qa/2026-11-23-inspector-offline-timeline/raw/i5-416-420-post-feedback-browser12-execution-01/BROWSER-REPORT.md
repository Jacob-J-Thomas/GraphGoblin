# Post-feedback native browser evidence

One native Playwright run against a0ce7b7 and the fresh built web passed 11 of 12 cases and exited 1. The four selected specs used one worker, zero retries and tracing. All five listener cases, four authored availability cases, bounded history and G2 passed. G1 alone failed its strict whole-page assertions. All 12 trace ZIPs and all 12 G1 measurement and PNG pairs are retained.

The controlled B3 script-consent case passed. The browser opened Recover script with Resume enabled. Going offline made the Last observed notice visible and hid the old dialog. Reconnect delivered the matching controlled GET, hid the notice and left the old dialog hidden. All three traced controlled run responses were finalized with observedSeq and script failureSeq both 6. The 21-entry browser request attachment contains only reads. No run POST appears in this case trace. The underlying owned API returned the real waiting run, and the fixture fulfilled the matching browser GET with a schema-valid failed projection. This exercised browser consent across offline and online in one context. It did not execute a script or exercise a second tab.

The 12 Playwright traces record only ephemeral loopback HTTP origins. The built and isolated disposable distributions matched the fresh manifest after the run, and source, overlays, dependency metadata and index snapshots matched. Process closure evidence covers the direct command and native teardown, with no separate descendant inventory.

## G1 three-way comparison

Cell format is document width / body width / outside visible text ranges / number-type overlaps / number clipping / type clipping / sequence font px / type font px.

| Viewport | Text scale | Sequence | Main baseline | Prior 2231400 | Current a0ce7b7 |
| ---: | ---: | ---: | --- | --- | --- |
| 1440 | 1 | 10593 | 1440/1440/0/1/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 |
| 1440 | 1 | 123456 | 1440/1440/0/1/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 |
| 1440 | 1 | 123456789012345 | 1440/1440/0/1/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 | 1440/1440/0/0/0/0/12/12.5 |
| 1440 | 2 | 10593 | 1440/1440/0/1/0/0/24/25 | 1440/1440/0/0/0/0/24/25 | 1440/1440/0/0/0/0/24/25 |
| 1440 | 2 | 123456 | 1440/1440/0/1/0/0/24/25 | 1440/1440/0/0/0/0/24/25 | 1440/1440/0/0/0/0/24/25 |
| 1440 | 2 | 123456789012345 | 1440/1440/0/1/0/0/24/25 | 1440/1440/0/0/0/0/24/25 | 1440/1440/0/0/0/0/24/25 |
| 320 | 1 | 10593 | 320/320/0/1/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 |
| 320 | 1 | 123456 | 320/320/0/1/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 |
| 320 | 1 | 123456789012345 | 320/320/0/1/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 | 320/320/0/0/0/0/12/12.5 |
| 320 | 2 | 10593 | 453/453/31/1/0/0/24/25 | 453/453/26/0/0/0/24/25 | 453/453/26/0/0/0/24/25 |
| 320 | 2 | 123456 | 453/453/31/1/0/0/24/25 | 453/453/26/0/0/0/24/25 | 453/453/26/0/0/0/24/25 |
| 320 | 2 | 123456789012345 | 453/453/31/1/0/0/24/25 | 453/453/26/0/0/0/24/25 | 453/453/26/0/0/0/24/25 |

The current measurements match the prior candidate on all eight metrics in all 12 cells. Both candidate runs retain the sequence/type improvement from one overlapping pair to zero per cell. The three 320 px samples at 200% text still exceed the strict 321 px allowance with 453 px document and body widths, and each has 26 outside text ranges. The earlier main baseline had the same widths and 31 ranges at those cells. The separate #563 disposition covers the pre-existing whole-page reflow defect. The current strict result remains failed.
