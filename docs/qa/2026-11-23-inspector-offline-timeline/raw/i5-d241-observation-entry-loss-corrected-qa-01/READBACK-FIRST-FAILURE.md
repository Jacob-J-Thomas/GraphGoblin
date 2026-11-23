The first read-only closure reader exited1 at close.py:56 because it excluded only status=pending when selecting active cases. Actual Vitest JSON marks the61 filtered cases skipped; the two active cases are passed. The command runner had already counted both pending/skipped correctly and preserved the proper2/61 result. Original reader is kept as close.first-reader.py. Only this evidence-parser filter changes to passed/failed; no behavioral program, fixture, assertion, timing or result changed or reran.

Observed initial output:

```text
Traceback (most recent call last):
  File "G:\ggq\delivery-evidence\2026-11-17-five-intents\i5-d241-observation-entry-loss-corrected-qa-01\close.py", line 56, in <module>
    assert len(active_fresh) == 2 and all(case['status'] == 'passed' for case in active_fresh)
           ^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```
