"""Red controls for workflow-inventory.py: each mutation of the candidate must be reported.

Usage: python -I workflow-inventory-red-controls.py <base-ci.yml> <candidate-ci.yml> <scratch-dir>
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MUTATIONS = {
    "drop Chat restart": ("      - name: Chat restart acceptance\n        run: pnpm test:chat-restart\n\n", ""),
    "change coverage concurrency": ("test:coverage --concurrency=1", "test:coverage --concurrency=2"),
    "drop audit": ("      - name: Dependency audit\n        run: pnpm audit --audit-level=high\n", ""),
    "audit continues on error": (
        "        run: pnpm audit --audit-level=high\n",
        "        run: pnpm audit --audit-level=high\n        continue-on-error: true\n",
    ),
    "skippable Gates": ("    if: ${{ always() }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 2",
                        "    if: ${{ !cancelled() }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 2"),
    "Gates needs one lane": ("needs: [repository-checks, coverage]", "needs: [repository-checks]"),
    "coverage step uncapped": ("        timeout-minutes: 25\n", ""),
    "browser retries": ("--retries=0 --workers=1", "--retries=1 --workers=1"),
    "hidden upload opt-in": ("include-hidden-files: false", "include-hidden-files: true"),
    "coverage upload only on success": (
        "      - name: Upload coverage reports\n        if: always()",
        "      - name: Upload coverage reports\n        if: success()",
    ),
}


def main(base, candidate, scratch):
    with open(candidate, encoding="utf-8") as handle:
        source = handle.read()
    results = {}
    for name, (old, new) in MUTATIONS.items():
        assert source.count(old) == 1, (name, source.count(old))
        path = os.path.join(scratch, name.replace(" ", "-") + ".yml")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(source.replace(old, new))
        run = subprocess.run(
            [sys.executable, "-I", os.path.join(HERE, "workflow-inventory.py"), base, path],
            capture_output=True, text=True, check=False)
        report = json.loads(run.stdout)
        results[name] = {"exit": run.returncode, "problems": report["problems"]}
    detected = all(r["exit"] == 1 and r["problems"] for r in results.values())
    print(json.dumps({"allDetected": detected, "results": results}, indent=2))
    return 0 if detected else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
