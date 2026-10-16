# Frozen starting-point drafts

These four format-3 draft exports come from commit `b5f02cc` (`apps/api/templates/{starter,implementation,review,qa}/draft.json`), before evaluator and exit conversion. Only JSON formatting is normalized. They are ordinary independent starting points, not configured template instances.

`conversion.test.ts` checks the complete converted candidates against golden snapshots and compares their trigger and former exit configs directly with the drafts currently shipped in `apps/api/templates`. Trigger configs automatically rename `subtype` to `type`, preserving every other field. Original node IDs and edge IDs are retained; generated retry routes, pass limits, terminal outcomes and return mappings match E1. The tests also check the frozen parser, current parser and domain graph validator.
