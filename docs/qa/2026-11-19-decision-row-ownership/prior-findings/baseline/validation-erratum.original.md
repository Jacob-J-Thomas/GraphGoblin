# Baseline validation erratum

The sealed baseline report's statement that the earlier six validation requests retained duplicate-ID validation is unsupported and is retracted. Those POST /validate requests supplied no required definition body and returned HTTP400 request-schema errors. They do not establish semantic duplicate-edge validation. The six creation requests did return201 and remain valid evidence of fixture admission; the recorded browser/store ownership findings are unchanged.

The original baseline report, summary, API observations and manifest remain immutable. This note corrects their interpretation without rewriting sealed evidence. No absent API observation is filled by a UI error count or source reasoning.

A separate correct-body read-only comparison on the disposable f17cddc candidate is recorded in candidate-f17cddc/validation-correct-body.json if completed. Its results belong to that exact candidate only and do not retroactively qualify broken source95c759b7.
