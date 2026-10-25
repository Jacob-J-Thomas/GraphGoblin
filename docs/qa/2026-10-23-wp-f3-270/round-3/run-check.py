"""Capture one task-local command without PowerShell stderr rewriting."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
qa = Path(__file__).resolve().parent
name, *command = sys.argv[1:]
profile = str(Path.home())
def redact(text):
    return text.replace(profile.replace("\\", "\\\\"), "%USERPROFILE%").replace(profile, "%USERPROFILE%").replace(profile.replace("\\", "/"), "%USERPROFILE%").replace(profile[2:], "%USERPROFILE%")
started = time.monotonic()
with (qa / (name + ".log.txt")).open("w", encoding="utf-8") as log:
    header = json.dumps({"command": command, "cwd": redact(os.getcwd())})
    log.write(header + "\n")
    log.flush()
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for raw in child.stdout:
        line = redact(raw.decode("utf-8", errors="replace"))
        log.write(line)
        log.flush()
        print(line, end="", flush=True)
    code = child.wait()
    result = {"command": command, "exitCode": code, "seconds": round(time.monotonic() - started, 3)}
    log.write("\n" + json.dumps(result) + "\n")
with (qa / "commands.log.txt").open("a", encoding="utf-8") as index:
    index.write(json.dumps({"name": name, **result}) + "\n")
print("RESULT " + name + " " + str(code), flush=True)
sys.exit(code)
