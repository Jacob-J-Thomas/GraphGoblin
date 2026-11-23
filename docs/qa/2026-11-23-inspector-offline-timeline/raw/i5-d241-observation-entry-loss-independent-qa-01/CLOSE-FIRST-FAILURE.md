Read-only evidence reader first invocation exited1 at close.py:57. Its message-format assertion expected JSON-quoted fields inside a textual Vitest failure message. The actual JSON failureMessages entry is `AssertionError: expected { text: '', visible: false, …(1) } to match object { …(2) }`. Raw stderr independently includes the full object diff. The original reader is preserved as close.first-reader.py; only this format expectation is corrected. No fixture/product/runtime/behavior rerun or result changed.

Observed original output:

```text
Traceback (most recent call last):
  File "G:\ggq\delivery-evidence\2026-11-17-five-intents\i5-d241-observation-entry-loss-independent-qa-01\close.py", line 57, in <module>
    assert '\"text\": \"\"' in messages and '\"visible\": false' in messages
                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```
