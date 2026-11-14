# PR #474 first CI formatting failure

The first CI run on `ba3086b8` passed build, process acceptance, typecheck and lint, then stopped at formatting two archived raw Markdown files. Later gates did not run. See the [original decoded job log](gates.log) and [failure and repair record](record.json).

Both artifacts now use `.md.txt` names; their bytes and hashes are unchanged. The publication manifest points to those names. Historical prepared manifests retain their original paths. Product code, test assertions, thresholds and formatter exclusions did not change. Current-head CI remains required.

[CI run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43621306507) · [job](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43621306507/job/132527398274)
