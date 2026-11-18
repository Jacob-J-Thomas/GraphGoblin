import hashlib
import json
from pathlib import Path
import sys
import yaml

candidate = Path(sys.argv[1])
folder = Path(sys.argv[2])
raw = candidate.read_bytes()
source = raw.decode("utf-8")
start = source.index("  repository-checks:\n")
end = source.index("  browser:\n", start)
jobs = source[start:end]
assert jobs.count("    steps:\n") == 3
wait = """      # QA-ONLY bounded window so the orchestrator can cancel with both lanes running.
      - name: QA cancellation window
        id: qa_cancel_window
        shell: bash
        timeout-minutes: 4
        run: |
          printf '%s\\n' 'QA488_CANCEL_WINDOW active'
          sleep 180
"""
extended = jobs.replace("    steps:\n", "    steps:\n" + wait, 2)
assert extended.replace(wait, "") == jobs
header = """# QA-ONLY disposable cancellation control, generated from the frozen corrected candidate.
# Branch codex/qa/gg-488-external-cancel. Do not merge this workflow.
name: QA 488 external cancellation

on:
  push:
    branches: [codex/qa/gg-488-external-cancel]

jobs:
"""
generated = (header + extended).encode("utf-8")
source_yaml = yaml.load(raw, yaml.BaseLoader)["jobs"]
generated_jobs = yaml.load(generated, yaml.BaseLoader)["jobs"]
assert list(generated_jobs) == ["repository-checks", "coverage", "gates"]
for lane in ("repository-checks", "coverage"):
    first = generated_jobs[lane]["steps"].pop(0)
    assert first["timeout-minutes"] == "4"
    assert first["run"].splitlines()[-1] == "sleep 180"
    assert generated_jobs[lane] == source_yaml[lane]
assert generated_jobs["gates"] == source_yaml["gates"]
artifact = folder / "qa-488-external-cancel.yml"
artifact.write_bytes(generated)
receipt = {
    "candidate_workflow_sha256": hashlib.sha256(raw).hexdigest(),
    "external_cancel_workflow_sha256": hashlib.sha256(generated).hexdigest(),
    "exact_source_sections": ["repository-checks", "coverage", "gates"],
    "only_job_injection": "One three-minute wait at the start of each lane, step cap four minutes",
    "branch": "codex/qa/gg-488-external-cancel",
}
(folder.parent / "external-cancel-control-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
