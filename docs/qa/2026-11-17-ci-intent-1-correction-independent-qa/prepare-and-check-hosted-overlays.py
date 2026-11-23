import copy
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import yaml

checkout, author, packet = map(Path, sys.argv[1:4])
original = packet / "hosted-original"
overlay = packet / "hosted-overlay"
original.mkdir(exist_ok=True)
overlay.mkdir(exist_ok=True)
names = ["qa-496-invalid-prepare.yml", "qa-496-candidate-negative.yml"]
edits = {
    names[0]: (
        """          # QA-ONLY INJECTION: the checkout as runner temp, so the real init refuses.
          RUNNER_TEMP: ${{ github.workspace }}
        run: node tooling/scripts/windows-launcher-evidence.mjs init
""",
        """        # QA-ONLY INJECTION: override the inherited default in this PowerShell process.
        run: |
          $env:RUNNER_TEMP = $env:GITHUB_WORKSPACE
          node tooling/scripts/windows-launcher-evidence.mjs init
          exit $LASTEXITCODE
""",
    ),
    names[1]: (
        """            node tooling/scripts/windows-launcher-evidence.mjs init
            if ($LASTEXITCODE -ne 0) { throw "init failed for $case" }
""",
        """            node tooling/scripts/windows-launcher-evidence.mjs init | Out-Host
            $initCode = $LASTEXITCODE
            if ($initCode -ne 0) { throw "init failed for $case" }
""",
    ),
}

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

receipts = {}
for name in names:
    raw = (author / "hosted" / "workflows" / name).read_bytes()
    text = raw.decode("utf-8")
    previous, updated = edits[name]
    assert text.count(previous) == 1
    fixed = text.replace(previous, updated)
    (original / name).write_bytes(raw)
    (overlay / name).write_bytes(fixed.encode("utf-8"))
    diff = difflib.unified_diff(
        text.splitlines(keepends=True), fixed.splitlines(keepends=True), "original/" + name, "overlay/" + name,
    )
    (packet / (name + ".diff")).write_bytes("".join(diff).encode("utf-8"))
    receipts[name] = {"original": digest(raw), "overlay": digest(fixed.encode("utf-8"))}

def read_yaml(file):
    return yaml.load(file.read_bytes(), Loader=yaml.BaseLoader)

def normalize(job, kinds):
    model = copy.deepcopy(job)
    model["name"] = "Windows launcher"
    steps = model["steps"]
    observation = steps.pop()
    assert observation["name"] == "QA readback (prints facts, never fails)"
    assert observation["if"] == "always()"
    assert observation["env"]["ARTIFACT_ID"] == "${{ steps.upload.outputs.artifact-id }}"
    assert steps[-1].pop("id") == "upload"
    if "invalid-prepare" in kinds:
        expected_commands = "\n".join([
            "$env:RUNNER_TEMP = $env:GITHUB_WORKSPACE",
            "node tooling/scripts/windows-launcher-evidence.mjs init",
            "exit $LASTEXITCODE",
            "",
        ])
        assert "RUNNER_TEMP" not in steps[5]["env"]
        assert steps[5]["run"] == expected_commands
        steps[5]["run"] = "node tooling/scripts/windows-launcher-evidence.mjs init"
    if "install-fails" in kinds:
        assert steps[3]["run"] == "exit 1"
        steps[3]["run"] = "pnpm install --frozen-lockfile"
        assert steps[-1]["with"]["name"] == "qa496-not-run-windows-launcher-${{ github.run_attempt }}"
        steps[-1]["with"]["name"] = "windows-launcher-${{ github.run_attempt }}"
    if "negative" in kinds:
        assert steps[6]["run"] == "node --test tooling/scripts/windows-launcher.qa-negative.acceptance.mjs"
        assert steps[6]["name"] == "QA negative native acceptance"
        steps[6]["name"] = "Native Windows launcher acceptance"
        steps[6]["run"] = "pnpm test:windows-launcher"
        extras = {
            "QA_496_CANARY": "QA496-${{ github.run_id }}-${{ github.run_attempt }}",
            "GG_QA_496_ENV_CANARY": "QA496-${{ github.run_id }}-${{ github.run_attempt }}-ENV",
            "QA_496_PLAIN_ENV_CANARY": "QA496-${{ github.run_id }}-${{ github.run_attempt }}-PLAINENV",
        }
        for key, value in extras.items():
            assert steps[6]["env"].pop(key) == value
        assert steps[-1]["with"]["name"] == "qa496-negative-windows-launcher-${{ github.run_attempt }}"
        assert steps[-1]["with"].pop("retention-days") == "7"
        steps[-1]["with"]["name"] = "windows-launcher-${{ github.run_attempt }}"
    return model

candidate = read_yaml(checkout / ".github" / "workflows" / "ci.yml")["jobs"]["windows-launcher"]
invalid = read_yaml(overlay / names[0])["jobs"]
negative = read_yaml(overlay / names[1])["jobs"]
assert normalize(invalid["windows-launcher-invalid-prepare"], ["invalid-prepare"]) == candidate
assert normalize(invalid["windows-launcher-install-fails"], ["install-fails"]) == candidate
assert normalize(negative["windows-launcher-negative"], ["negative"]) == candidate
before = read_yaml(original / names[1])["jobs"]["evidence-refusal"]
after = negative["evidence-refusal"]
assert before["steps"][2]["run"].replace(*("".join(line[10:] for line in chunk.splitlines(keepends=True)) for chunk in edits[names[1]])) == after["steps"][2]["run"]
assert before["steps"][:2] == after["steps"][:2]
assert before["steps"][3:] == after["steps"][3:]
assert set(before) == set(after)
for value in after["steps"][3:5]:
    assert value["run"] == "node tooling/scripts/windows-launcher-evidence.mjs finalize"
    assert value["continue-on-error"] == "true"
for value in after["steps"][5:7]:
    assert value["uses"] == "actions/upload-artifact@v4"
    assert ".outputs.paths != ''" in value["if"]

# Retain exact parsed run bodies for PowerShell-only local controls.
scripts = packet / "hosted-shell-probes"
scripts.mkdir()
def write_script(name, source):
    (scripts / (name + ".ps1")).write_bytes(source.encode("utf-8"))

write_script("invalid-init-overlay", invalid["windows-launcher-invalid-prepare"]["steps"][5]["run"])
write_script("refusal-prepare-original", before["steps"][2]["run"])
write_script("refusal-prepare-overlay", after["steps"][2]["run"])
write_script("refusal-assert-overlay", after["steps"][-1]["run"])
negative_suite = overlay / "windows-launcher.qa-negative.acceptance.mjs"
subprocess.run(
    [sys.executable, "-I", str(author / "hosted" / "make-negative-acceptance.py"),
     str(checkout / "tooling" / "scripts" / "windows-launcher.acceptance.mjs"), str(negative_suite)],
    check=True,
)
suite_raw = negative_suite.read_bytes()
assert suite_raw == (author / "hosted" / "negative" / negative_suite.name).read_bytes()
assert suite_raw == (author / "native" / negative_suite.name).read_bytes()
receipts[negative_suite.name] = {"sha256": digest(suite_raw)}
(packet / "control-overlay-receipts.json").write_text(json.dumps(receipts, indent=2) + "\n")
print(json.dumps(receipts, indent=2))

