"""Generate QA-ONLY disposable #488 control workflows from the frozen candidate ci.yml.

Each variant triggers only on a push to its own throwaway branch and keeps the candidate's
Repository checks / Coverage / Gates text except for the single documented injection. The
fan-in control reuses the candidate Gates step verbatim over stub jobs whose results are
success, failure, skipped and cancelled (job timeout). Never merge any of these.

Usage: python -I make-488-controls.py <candidate-ci.yml> <output-dir>
"""
import os
import re
import sys

import yaml

TRIGGER = re.compile(r"^on:\n(?:  .*\n)+", re.M)


def jobs_section(text, keep):
    head, body = text.split("\njobs:\n", 1)
    blocks = re.split(r"(?m)^(?=  [a-z][a-z0-9-]*:\n)", body)
    kept = [block for block in blocks if block.split(":", 1)[0].strip() in keep]
    return head + "\njobs:\n" + "".join(kept)


def variant(text, branch, keep, old=None, new=None, name=None):
    text = TRIGGER.sub(f"on:\n  push:\n    branches: [{branch}]\n", text, count=1)
    text = text.replace("name: CI\n", f"name: {name}\n", 1)
    text = jobs_section(text, keep)
    if old is not None:
        if text.count(old) != 1:
            raise SystemExit(f"anchor not unique in {branch}: {old[:50]!r}")
        text = text.replace(old, new)
    yaml.safe_load(text)
    return "# QA-ONLY disposable #488 control generated from the frozen candidate ci.yml. Never merge.\n" + text


COVERAGE = "        run: pnpm exec turbo run test:coverage --concurrency=1\n"
PARTIAL = (
    "mkdir -p packages/contracts/coverage && "
    "printf '{\"total\":{\"lines\":{\"pct\":0}},\"qa\":\"benign partial report\"}' "
    "> packages/contracts/coverage/coverage-summary.json"
)


def main(candidate, output):
    with open(candidate, encoding="utf-8") as handle:
        text = handle.read()
    lanes = {"repository-checks", "coverage", "gates"}
    variants = {
        "qa-488-coverage-fails-early.yml": variant(
            text, "qa/gg-488-coverage-fails-early", lanes, COVERAGE,
            f"        run: |\n          {PARTIAL}\n          echo 'QA injected coverage failure'\n          exit 1\n",
            "QA 488 coverage fails early"),
        "qa-488-coverage-step-timeout.yml": variant(
            text, "qa/gg-488-coverage-step-timeout", lanes,
            "        timeout-minutes: 25\n" + "        # Each Vitest package owns its worker pool; avoid multiplying pools on the CI host.\n" + COVERAGE,
            "        timeout-minutes: 1\n" + f"        run: |\n          {PARTIAL}\n          sleep 180\n",
            "QA 488 coverage step timeout"),
        "qa-488-static-fails.yml": variant(
            text, "qa/gg-488-static-fails", lanes,
            "      - name: Reset acceptance\n",
            "      - name: QA injected static failure\n        run: exit 1\n\n      - name: Reset acceptance\n",
            "QA 488 static lane fails"),
    }
    gates = yaml.safe_load(text)["jobs"]["gates"]["steps"][0]
    script = gates["run"]
    indented = "".join("          " + line + "\n" if line else "\n" for line in script.splitlines())
    stubs = {
        "stub-success-a": "    steps:\n      - run: echo success\n",
        "stub-success-b": "    steps:\n      - run: echo success\n",
        "stub-failure": "    steps:\n      - run: exit 1\n",
        "stub-skipped": "    if: ${{ false }}\n    steps:\n      - run: echo never\n",
        "stub-cancelled": "    timeout-minutes: 1\n    steps:\n      - run: sleep 150\n",
    }
    pairs = {
        "gates-success-success": ("stub-success-a", "stub-success-b"),
        "gates-success-failure": ("stub-success-a", "stub-failure"),
        "gates-skipped-success": ("stub-skipped", "stub-success-b"),
        "gates-success-cancelled": ("stub-success-a", "stub-cancelled"),
    }
    fanin = [
        "# QA-ONLY disposable #488 fan-in control. The aggregate step is the candidate Gates step",
        "# verbatim, with its two needs remapped to stub jobs. Never merge.",
        "name: QA 488 Gates fan-in control", "", "on:", "  push:",
        "    branches: [qa/gg-488-fanin]", "", "permissions: {}", "", "jobs:",
    ]
    for key, body in stubs.items():
        fanin.append(f"  {key}:\n    runs-on: ubuntu-latest\n{body.rstrip()}")
    for key, (first, second) in pairs.items():
        fanin.append(
            f"  {key}:\n    name: {key}\n    needs: [{first}, {second}]\n    if: ${{{{ always() }}}}\n"
            "    runs-on: ubuntu-latest\n    timeout-minutes: 2\n    permissions: {}\n    steps:\n"
            f"      - name: {gates['name']}\n        shell: bash\n        env:\n"
            f"          REPOSITORY_CHECKS: ${{{{ needs.{first}.result }}}}\n"
            f"          COVERAGE: ${{{{ needs.{second}.result }}}}\n"
            f"        run: |\n{indented.rstrip()}")
    variants["qa-488-fanin.yml"] = "\n".join(fanin) + "\n"
    yaml.safe_load(variants["qa-488-fanin.yml"])
    os.makedirs(output, exist_ok=True)
    for name, content in variants.items():
        with open(os.path.join(output, name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        print(f"wrote {name}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
