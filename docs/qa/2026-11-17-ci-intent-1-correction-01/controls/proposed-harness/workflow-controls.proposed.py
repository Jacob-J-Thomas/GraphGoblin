import hashlib
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import yaml

checkout = Path(sys.argv[1])
output_dir = Path(__file__).resolve().parent
workflow_name = ".github/workflows/ci.yml"
workflow = (checkout / workflow_name).read_bytes()
base = subprocess.check_output(["git", "show", "HEAD:" + workflow_name], cwd=checkout)
baseline = yaml.load(base, Loader=yaml.BaseLoader)
current = yaml.load(workflow, Loader=yaml.BaseLoader)
jobs = current["jobs"]
prior = baseline["jobs"]
repo, cov, gates = (jobs[name] for name in ("repository-checks", "coverage", "gates"))
coverage_steps = {
    "Install Chromium for tooling browser measurements",
    "Unit tests with coverage thresholds",
    "Upload coverage reports",
}
base_static = [step for step in prior["gates"]["steps"] if step.get("name") not in coverage_steps]
assert len(base_static) == 24
assert repo["steps"] == base_static
assert "needs" not in repo and "needs" not in cov
assert repo["timeout-minutes"] == cov["timeout-minutes"] == "30"
assert jobs["browser"] == prior["browser"]
assert jobs["template-image"] == prior["template-image"]
assert {k: v for k, v in current.items() if k != "jobs"} == {
    k: v for k, v in baseline.items() if k != "jobs"
}
assert cov["steps"][:4] == base_static[:4]
base_named = {step.get("name"): step for step in prior["gates"]["steps"]}
cov_named = {step.get("name"): step for step in cov["steps"]}
assert cov_named["Build"] == base_named["Build"]
for name in coverage_steps:
    after = cov_named[name]
    if name == "Upload coverage reports":
        assert after["with"]["if-no-files-found"] == "warn"
        assert base_named[name]["with"]["if-no-files-found"] == "ignore"
        effective = {**after, "with": {**after["with"], "if-no-files-found": "ignore"}}
        assert effective == base_named[name]
    else:
        assert {k: v for k, v in after.items() if k not in ("id", "timeout-minutes")} == base_named[name]
assert cov_named["Unit tests with coverage thresholds"]["timeout-minutes"] == "25"
assert gates["name"] == "Gates"
assert gates["needs"] == ["repository-checks", "coverage"]
assert gates["if"] == "${{ always() }}"
assert gates["timeout-minutes"] == "2" and gates["permissions"] == {}
assert len(gates["steps"]) == 1 and "uses" not in gates["steps"][0]
assert gates["steps"][0]["env"] == {
    "REPOSITORY_CHECKS": "${{ needs.repository-checks.result }}", "COVERAGE": "${{ needs.coverage.result }}"
}
assert cov_named["Coverage report status"]["if"] == "always()"
assert cov_named["Coverage report status"]["env"] == {"COVERAGE_OUTCOME": "${{ steps.coverage.outcome }}"}

bash = r"C:\Program Files\Git\bin\bash.exe"
states = ("success", "failure", "cancelled", "skipped", "")
fan_in, summary = [], []
def run_exact(script, variables, folder):
    (folder / "step.sh").write_bytes(script.encode("utf-8"))
    result = subprocess.run(
        [bash, "--noprofile", "--norc", "-e", "-o", "pipefail", "step.sh"],
        cwd=folder, env={**os.environ, **variables, "GITHUB_STEP_SUMMARY": "summary.md"},
        text=True, capture_output=True, check=False, timeout=10,
    )
    markdown = (folder / "summary.md").read_text()
    (folder / "summary.md").unlink()
    return result.returncode, result.stdout.strip(), markdown

with tempfile.TemporaryDirectory(prefix="i1-workflow-qa-") as temp:
    folder = Path(temp)
    for static_result, coverage_result in itertools.product(states, repeat=2):
        code, stdout, markdown = run_exact(gates["steps"][0]["run"], {
            "REPOSITORY_CHECKS": static_result, "COVERAGE": coverage_result,
        }, folder)
        assert (code == 0) == (static_result == coverage_result == "success")
        assert f"| Repository checks | {chr(96)}{static_result or 'missing'}{chr(96)} |" in markdown
        assert f"| Coverage | {chr(96)}{coverage_result or 'missing'}{chr(96)} |" in markdown
        fan_in.append(dict(repository=static_result, coverage=coverage_result, code=code, stdout=stdout))
    path = folder / "tooling" / "coverage" / "coverage-summary.json"
    path.parent.mkdir(parents=True)
    for state in states:
        if state in ("success", "failure"):
            path.write_text("{}")
        else:
            path.unlink(missing_ok=True)
        code, stdout, markdown = run_exact(cov_named["Coverage report status"]["run"],
            {"COVERAGE_OUTCOME": state}, folder)
        assert code == 0
        assert ("partial" in markdown) == (state != "success")
        assert ("retained: 1." in markdown) == (state in ("success", "failure"))
        summary.append(dict(state=state, code=code, stdout=stdout, markdown=markdown))

windows = jobs["windows-launcher"]
old_windows = prior["windows-launcher"]
named = {step.get("id"): step for step in windows["steps"] if "id" in step}
assert [step["run"] for step in windows["steps"] if step.get("id") in ["install", "build", "native"]] == [
    step["run"] for step in old_windows["steps"] if "run" in step
]
assert windows["timeout-minutes"] == old_windows["timeout-minutes"]
upload = windows["steps"][-1]
assert upload["if"] == "${{ always() && steps.finalize.outputs.paths != '' }}"
assert upload["uses"] == "actions/upload-artifact@v4"
assert upload["with"] == {
    "name": "windows-launcher-${{ github.run_attempt }}",
    "path": "${{ steps.finalize.outputs.paths }}",
    "if-no-files-found": "error", "include-hidden-files": "false"
}

def native_pipeline(failing_step, cancelled=False):
    outcomes = {}
    by_name = dict(named, upload=upload)
    slots = [(step.get("id") or "upload") for step in windows["steps"][3:]]
    condition = {
        "${{ !cancelled() && steps.build.outcome == 'success' }}":
            lambda: not cancelled and outcomes.get("build") == "success",
        "${{ always() && steps.evidence.outputs.dir != '' }}":
            lambda: outcomes.get("evidence") == "success",
        "${{ always() && steps.finalize.outputs.paths != '' }}":
            lambda: outcomes.get("finalize") == "success",
        # PROPOSED (author-side, #496 correction 01): the corrected job's two new conditions.
        # Setup steps before slot 3 are modeled as successful, as in the original harness.
        "${{ !cancelled() && steps.node.outcome == 'success' }}":
            lambda: not cancelled,
        "${{ always() && steps.evidence.outcome == 'success' }}":
            lambda: outcomes.get("evidence") == "success",
    }
    for item in slots:
        when = by_name[item].get("if")
        if not when:
            # Default status is success(), per GitHub's documented expression semantics.
            run = not cancelled and "failure" not in outcomes.values()
        else:
            run = condition[when]()
        outcomes[item] = ("failure" if item == failing_step else "success") if run else "skipped"
    return outcomes

expected = {
    "nominal": (None, "success", "success"),
    "prepare-fails": ("evidence", "success", "skipped"),
    "install-fails": ("install", "skipped", "success"),
    "build-fails": ("build", "skipped", "success"),
    "native-fails": ("native", "failure", "success"),
    "finalize-refuses": ("finalize", "success", "skipped"),
}
pipeline = {}
for case, (failure, native, upload_expected) in expected.items():
    outcomes = native_pipeline(failure)
    pipeline[case] = dict(outcomes=outcomes,
        pass_contract=outcomes["native"] == native and outcomes["upload"] == upload_expected)
receipt = {
    "source": {"workflow_sha256": hashlib.sha256(workflow).hexdigest(),
               "baseline_sha256": hashlib.sha256(base).hexdigest()},
    "matrix": {"repository_exact_steps": len(base_static), "gates_pairs": len(fan_in),
               "coverage_report_cases": len(summary), "windows_cases": len(pipeline)},
    "gates": fan_in, "coverage_summary": summary, "windows_status_model": pipeline,
    "reference": "https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions",
}
(output_dir / "workflow-controls.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt["matrix"]))
for case, data in pipeline.items():
    print(case, data)
sys.exit(0 if all(case["pass_contract"] for case in pipeline.values()) else 1)


