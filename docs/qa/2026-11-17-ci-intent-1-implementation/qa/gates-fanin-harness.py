"""Executes the candidate's actual Gates and Coverage-status scripts (QA-only, external).

The `run` text is taken from the workflow YAML, not restated. Each script runs under the same
bash invocation GitHub uses for `shell: bash` (`bash --noprofile --norc -eo pipefail {0}`) with
the env values GitHub would supply. The `if: always()` job expression itself can only be
established by a hosted run; this harness proves the script's decision for every result value.

Usage: python -I gates-fanin-harness.py <ci.yml> <scratch-dir> [--mutate]
  --mutate replaces `&&` with `||` in the Gates condition to prove the harness detects a
  permissive aggregate (expected to report failures).
"""
import itertools
import json
import os
import subprocess
import sys

import yaml

RESULTS = ["success", "failure", "cancelled", "skipped", ""]
BASH = os.environ.get("GG_QA_BASH", "bash")


def run_script(script, env, scratch, name):
    path = os.path.join(scratch, name + ".sh")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(script)
    summary = os.path.join(scratch, name + ".summary.md")
    open(summary, "w").close()
    completed = subprocess.run(
        [BASH, "--noprofile", "--norc", "-eo", "pipefail", path],
        env={**os.environ, **env, "GITHUB_STEP_SUMMARY": summary},
        capture_output=True, text=True, cwd=scratch, check=False)
    with open(summary, encoding="utf-8") as handle:
        return completed.returncode, completed.stdout, handle.read()


def main(workflow, scratch, mutate=False):
    with open(workflow, encoding="utf-8") as handle:
        jobs = yaml.safe_load(handle)["jobs"]
    gates = jobs["gates"]["steps"][0]
    script = gates["run"]
    if mutate:
        script = script.replace('= success ] && [', '= success ] || [')
    rows, problems = [], []
    for repo, cov in itertools.product(RESULTS, RESULTS):
        env = {"REPOSITORY_CHECKS": repo, "COVERAGE": cov}
        code, stdout, summary = run_script(script, env, scratch, f"gates-{repo or 'missing'}-{cov or 'missing'}")
        expected = 0 if (repo, cov) == ("success", "success") else 1
        shown = [repo or "missing", cov or "missing"]
        rows.append({"repositoryChecks": shown[0], "coverage": shown[1], "exit": code})
        if code != expected:
            problems.append(f"Gates exit {code} for {shown}, expected {expected}")
        if f"| Repository checks | `{shown[0]}` |" not in summary or f"| Coverage | `{shown[1]}` |" not in summary:
            problems.append(f"summary lacks results for {shown}")
        if expected == 1 and "::error title=Gates::" not in stdout:
            problems.append(f"no error annotation for {shown}")

    status_rows = []
    status = next(s for s in jobs["coverage"]["steps"] if s.get("name") == "Coverage report status")
    for outcome in ["success", "failure", "cancelled", "skipped", ""]:
        for reports in (0, 2):
            directory = os.path.join(scratch, f"coverage-{outcome or 'missing'}-{reports}")
            for index in range(reports):
                target = os.path.join(directory, "packages", f"p{index}", "coverage")
                os.makedirs(target, exist_ok=True)
                open(os.path.join(target, "coverage-summary.json"), "w").close()
            os.makedirs(directory, exist_ok=True)
            code, stdout, summary = run_script(
                status["run"], {"COVERAGE_OUTCOME": outcome}, directory, "status")
            partial = "partial and establish no passing gate" in summary
            status_rows.append({"outcome": outcome or "missing", "reports": reports, "exit": code,
                                "partialNote": partial})
            if code != 0:
                problems.append(f"status step failed for {outcome!r}/{reports}")
            if partial != (outcome != "success"):
                problems.append(f"partial note wrong for {outcome!r}")
            if f"Package summaries retained: {reports}." not in summary:
                problems.append(f"report count wrong for {outcome!r}/{reports}")
    report = {"mutated": mutate, "ok": not problems, "problems": problems,
              "gates": rows, "coverageStatus": status_rows}
    print(json.dumps(report, indent=2))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2], "--mutate" in sys.argv[3:]))
