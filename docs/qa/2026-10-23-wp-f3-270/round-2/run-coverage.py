"""Run the requested package gates serially, then isolate untouched failures once."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time

qa = Path(__file__).resolve().parent
while True:
    rows = [json.loads(line) for line in (qa / "commands.log.txt").read_text(encoding="utf-8").splitlines()]
    if any(row["name"] == "check-tokens" for row in rows):
        break
    time.sleep(1)
changed = set(subprocess.check_output(["git", "diff", "--name-only"], text=True).splitlines())
for package, directory in [("domain", "packages/domain"), ("contracts", "packages/contracts"), ("engine", "packages/engine"), ("adapter-codex", "packages/adapter-codex"), ("api", "apps/api"), ("web", "apps/web"), ("api-client", "packages/api-client")]:
    name = package + "-coverage"
    command = ["pnpm.cmd", "--filter", "@graphgoblin/" + package, "test:coverage", "--coverage.reportOnFailure"]
    if package == "web":
        command.append("--maxWorkers=1")
    code = subprocess.call([sys.executable, str(qa / "run-check.py"), name, *command])
    if code == 0:
        continue
    log = (qa / (name + ".log.txt")).read_text(encoding="utf-8")
    failed = sorted(set(re.findall(r"FAIL\s+(src/[^\s]+\.test\.[jt]sx?)", log)))
    for path in failed:
        if directory + "/" + path in changed:
            print("TOUCHED FAILURE requires investigation: " + directory + "/" + path, flush=True)
            continue
        isolated = package + "-isolated-" + path.replace("/", "-").replace(".", "-")
        subprocess.call([sys.executable, str(qa / "run-check.py"), isolated, "pnpm.cmd", "--filter", "@graphgoblin/" + package, "exec", "vitest", "run", path, "--maxWorkers=1"])
print("ALL COVERAGE GATES FINISHED", flush=True)
