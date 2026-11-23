# #434 reset ownership reporting — bounded QA evidence

Source `dc65a245a3c21a8dec6b975d9d1d2d63f8a59eaa`, batch base `8181f350028e284529c76b51927f32890afcb68a`. [Genuine final independent QA](final-independent/README.md) concludes **PASS with stated limits**. [Layout/source receipt](layout.json) binds the completed terminal and preserves the prior source stages. This packet is ready for evidence publication; it is not an integrated #409/#471 verdict or a formal/owner acceptance.

The immutable historical siblings remain [first held](434-first-held/README.md) and [current held correction](434-current/README.md). Every original byte and component seal is unchanged, including their dated pending states, online references and default exit 2 behavior. They remain historical records. Copy the whole root so their relative links resolve. The first provisional root is also preserved in an immutable private snapshot.

Final QA preserves run1 **280/282**, native controls **262/274**, corrected C1b **22/22**, scoped **11/11** and wider **205 passed/2 skipped**. All original red outcomes remain visible. The terminal and SUMMARY claim 15 nonpassing results, while their assertion breakdown identifies **14 (2+12)**; the [receipt](final-independent/receipt.json) explicitly leaves the claimed fifteenth unassigned. Native sharing violations and hard links remain distinguished from injected EPERM/EACCES and in-process contention.

**Future #409/#471 integrated QA remains required.** Standalone reset evidence does not exercise #409 API startup or the #471 native contention mechanism. Timing, Windows-only, scratch-hygiene and coverage limits are retained in the genuine final report. The current historical snapshot already contains a separately qualified prospective-combination pointer.

`node verify-evidence.mjs` performs only offline evidence replay and returns pass for this complete packet. `--integrity-only` is also supported. Both historical child defaults still return held/exit 2. The [root manifest](evidence-manifest.json) excludes itself and includes all component manifests. No product or QA driver runs during verification.
