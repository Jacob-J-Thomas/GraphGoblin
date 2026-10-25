# Source and run provenance

Base: `456fcd613abb05701dcd8bcccfef410541716e68`. `source-manifest-final.json` captures the final runtime used by package coverage and build. Verification found only the browser selector correction and final documentation wording changes after it; runtime source is unchanged. `source-manifest-verified.json` records the selector correction. `source-manifest-complete.json` includes the final docs/07, docs/09 and two guide corrections. `RANGES.md` and `implementation.patch.txt` describe every existing-file change. New API tests and ADR-0057 are named in each source inventory.

`NORMALIZATION.json` records original and normalized byte lengths and SHA-256 for evidence text converted to UTF-8 or having local paths normalized. `ARTIFACTS.json` is the final retained-artifact inventory. Intermediate failures remain available; README identifies invalid attempts and overwritten output. No pass erases an earlier timeout/failure.
