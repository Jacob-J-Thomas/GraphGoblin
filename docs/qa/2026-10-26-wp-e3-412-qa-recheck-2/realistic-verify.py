"""Read-only follow-up for 14-realistic: the phase C check "retained workspaces are untouched"
indexed retained[3:263], which includes three template runs (indexes 260-262) that never have a
temp workspace, so that FAIL is a script error. This rechecks the intended set and lists every
non-retained entry left in the workspaces root. Usage: python -I realistic-verify.py <base>"""
import json
import os
import sys

base = sys.argv[1]
runs = json.load(open(os.path.join(base, "runs.json"), encoding="utf-8"))
retained = runs["retained"]
approved = set(runs["approved"])
ws = os.path.join(base, "data", "workspaces")
temp_retained = retained[6:260] + retained[-3:]
present = sum(os.path.isdir(os.path.join(ws, i)) for i in temp_retained)
print(f"retained temp-workspace runs (indexes 6-259 and the 3 shared-transcript runs) with their workspace present: {present}/{len(temp_retained)}")
print("template runs 260-262 have a temp workspace:", [os.path.isdir(os.path.join(ws, i)) for i in retained[260:263]])
print("phase C/D approved runs (indexes 0-5) workspaces present:", [os.path.isdir(os.path.join(ws, i)) for i in retained[0:6]])
for entry in sorted(os.listdir(ws)):
    if entry in retained:
        continue
    kind = "approved (kept)" if entry in approved else "not a run"
    print(" non-retained entry:", entry, kind, sorted(os.listdir(os.path.join(ws, entry)))[:5])
