"""Inventory check for the #488/#496 workflow change (QA-only, external to the repository).

Compares the base and candidate .github/workflows/ci.yml and asserts the invariants of the
admitted contract. Prints a JSON report and exits non-zero on any violation.

Usage: python -I workflow-inventory.py <base-ci.yml> <candidate-ci.yml>
"""
import json
import sys

import yaml


def load(path):
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def step_key(step):
    return step.get("run") or step.get("uses")


def main(base_path, candidate_path):
    base, cand = load(base_path), load(candidate_path)
    problems, facts = [], {}

    def require(condition, message):
        if not condition:
            problems.append(message)

    # PyYAML reads the bare `on` key as boolean True.
    require(base.get(True) == cand.get(True), "workflow triggers changed")
    require(base["concurrency"] == cand["concurrency"], "concurrency changed")
    require(base["name"] == cand["name"], "workflow name changed")

    jobs = cand["jobs"]
    facts["jobs"] = {key: job.get("name") for key, job in jobs.items()}
    for unchanged in ("browser", "template-image"):
        require(base["jobs"][unchanged] == jobs[unchanged], f"{unchanged} job changed")

    gates_base = base["jobs"]["gates"]["steps"]
    coverage_only = {
        "pnpm --filter @graphgoblin/web exec playwright install --with-deps chromium",
        "pnpm exec turbo run test:coverage --concurrency=1",
    }
    upload_base = [s for s in gates_base if s.get("uses", "").startswith("actions/upload-artifact")]
    repo_expected = [
        s for s in gates_base
        if s not in upload_base and s.get("run") not in coverage_only
    ]

    repo = jobs["repository-checks"]
    require(repo.get("name") == "Repository checks", "repository-checks display name")
    require(repo.get("runs-on") == "ubuntu-latest", "repository-checks runner")
    require(repo.get("timeout-minutes") == 30, "repository-checks timeout")
    require(repo["steps"] == repo_expected,
            "repository-checks steps differ from the base Gates steps without coverage")
    require("needs" not in repo and "if" not in repo, "repository-checks must be independent")
    facts["repositoryChecksCommands"] = [step_key(s) for s in repo["steps"]]

    cov = jobs["coverage"]
    require(cov.get("name") == "Coverage", "coverage display name")
    require(cov.get("runs-on") == "ubuntu-latest", "coverage runner")
    require(cov.get("timeout-minutes") == 30, "coverage job timeout")
    require("needs" not in cov and "if" not in cov, "coverage must be independent")
    cov_keys = [step_key(s) for s in cov["steps"]]
    facts["coverageCommands"] = cov_keys
    setup = [step_key(s) for s in gates_base[:5]]
    require(cov_keys[:5] == setup, "coverage setup differs from the base checkout/pnpm/node/install/build")
    for step, original in zip(cov["steps"][:5], gates_base[:5]):
        require(step == original, f"coverage setup step changed: {step_key(original)}")
    by_run = {s.get("run"): s for s in cov["steps"] if s.get("run")}
    for command in coverage_only:
        require(command in by_run, f"coverage lacks {command}")
    if all(command in by_run for command in coverage_only) and "pnpm build" in cov_keys:
        chromium = cov_keys.index(
            "pnpm --filter @graphgoblin/web exec playwright install --with-deps chromium")
        tests = cov_keys.index("pnpm exec turbo run test:coverage --concurrency=1")
        require(cov_keys.index("pnpm build") < chromium < tests,
                "coverage order build -> chromium -> tests")
        test_step = by_run["pnpm exec turbo run test:coverage --concurrency=1"]
        require(test_step.get("timeout-minutes") == 25, "coverage step cap must be 25 minutes")
        require(test_step.get("id") == "coverage", "coverage step id")
        require("continue-on-error" not in test_step, "coverage step must not continue on error")
    uploads = [s for s in cov["steps"] if s.get("uses", "").startswith("actions/upload-artifact")]
    require(len(uploads) == 1, "one coverage upload")
    upload = uploads[0]
    require(upload.get("if") == "always()", "coverage upload must always be attempted")
    require(upload["with"]["name"] == "coverage", "coverage artifact name")
    require(upload["with"]["path"] == upload_base[0]["with"]["path"], "coverage artifact paths")
    require(upload["with"].get("if-no-files-found") == "warn", "missing reports warn")
    facts["coverageUpload"] = upload["with"]

    # Every base Gates command runs exactly where the contract puts it.
    for step in gates_base:
        key = step_key(step)
        in_repo = key in facts["repositoryChecksCommands"]
        in_cov = key in cov_keys
        if step in upload_base:
            continue
        if key in coverage_only:
            require(in_cov and not in_repo, f"{key} must run only in Coverage")
        elif step in gates_base[:5]:
            require(in_cov and in_repo, f"{key} must set up both lanes")
        else:
            require(in_repo and not in_cov, f"{key} must run only in Repository checks")

    for job_key, job in jobs.items():
        for step in job["steps"]:
            require("continue-on-error" not in step, f"{job_key} has continue-on-error")
        require("continue-on-error" not in job, f"{job_key} job continues on error")

    gates = jobs["gates"]
    require(gates.get("name") == "Gates", "stable Gates display name")
    require(gates.get("needs") == ["repository-checks", "coverage"], "Gates needs both lanes")
    require(gates.get("if") == "${{ always() }}", "Gates must always be evaluated")
    require(gates.get("timeout-minutes") == 2, "Gates aggregate timeout")
    require(gates.get("permissions") == {}, "Gates aggregate holds no token permissions")
    require(len(gates["steps"]) == 1 and "uses" not in gates["steps"][0], "Gates: one script, no checkout")
    env = gates["steps"][0].get("env", {})
    require(env == {"REPOSITORY_CHECKS": "${{ needs.repository-checks.result }}",
                    "COVERAGE": "${{ needs.coverage.result }}"}, "Gates reads both results via env")
    require("${{" not in gates["steps"][0]["run"], "Gates script must not interpolate expressions")

    win_base, win = base["jobs"]["windows-launcher"], jobs["windows-launcher"]
    for field in ("name", "runs-on", "timeout-minutes", "env"):
        require(win_base[field] == win[field], f"windows-launcher {field} changed")
    native = [s for s in win["steps"] if s.get("run") == "pnpm test:windows-launcher"]
    require(len(native) == 1, "native command unchanged and present once")
    for original in win_base["steps"][:5]:
        matches = [s for s in win["steps"] if step_key(s) == step_key(original)]
        require(len(matches) == 1, f"windows step missing: {step_key(original)}")
        extra = {k: v for k, v in matches[0].items() if k not in original}
        require(set(extra) <= {"id"}, f"windows step {step_key(original)} gained {sorted(extra)}")
    up = [s for s in win["steps"] if s.get("uses", "").startswith("actions/upload-artifact")]
    require(len(up) == 1, "one windows upload")
    w = up[0]["with"]
    require(w.get("include-hidden-files") is False, "hidden files explicitly excluded")
    require(w.get("if-no-files-found") == "error", "missing bundle is an error")
    require(w.get("name") == "windows-launcher-${{ github.run_attempt }}", "attempt-specific name")
    require(w.get("path") == "${{ steps.finalize.outputs.paths }}", "exact finalized paths only")
    require(".tmp" not in json.dumps(win), "no .tmp path in the windows job")
    facts["windowsSteps"] = [s.get("name") or s.get("uses") for s in win["steps"]]
    facts["windowsUpload"] = w

    report = {"ok": not problems, "problems": problems, "facts": facts}
    print(json.dumps(report, indent=2))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
