"""Generate QA-ONLY disposable #496 hosted controls from the frozen corrected candidate ci.yml.

Every job below is the candidate's `windows-launcher` job text copied verbatim, with only the
anchored, commented QA injections listed here. Never merge any output; root alone publishes them
on `codex/qa/` branches created from the EXACT frozen corrected candidate commit.

qa-496-invalid-prepare.yml  (branch codex/qa/gg-496-invalid-prepare)
  windows-launcher-invalid-prepare: the Prepare step's RUNNER_TEMP is the checkout, so the real
    `init` refuses (inside-checkout) before creating anything. Expected: install and build
    success; prepare failure; the exact native command runs and keeps its own outcome; finalize
    and upload skipped; job failure; no artifact in the run.
  windows-launcher-install-fails: Install exits 1. Expected: build and native skipped; prepare
    success; finalize success with status not-run; an artifact with manifest.json and
    result.json only; job failure.
qa-496-candidate-negative.yml  (branch codex/qa/gg-496-candidate-negative)
  windows-launcher-negative: the native step runs the generated QA negative suite with canaries.
  evidence-refusal: finalize must refuse a planted hard link and a manifest with an unknown
    field, uploading nothing and leaving the outside canary unchanged.

Usage: python -I make-496-controls.py <candidate-ci.yml> <output-dir>
"""
import os
import sys

import yaml

HEADER = "# QA-ONLY disposable #496 control generated from the frozen corrected candidate ci.yml. Never merge.\n"


def windows_job(text):
    start = text.index("  windows-launcher:\n")
    end = text.index("\n  repository-checks:\n", start)
    return text[start:end + 1]


def inject(text, old, new):
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique ({text.count(old)}): {old[:70]!r}")
    return text.replace(old, new)


def renamed(job, key, name):
    return inject(job, "  windows-launcher:\n    name: Windows launcher\n", f"  {key}:\n    name: {name}\n")


UPLOAD = "      - name: Upload native evidence\n        if:"
UPLOAD_ID = "      - name: Upload native evidence\n        id: upload\n        if:"


def readback(label):
    return (
        "      - name: QA readback (prints facts, never fails)\n"
        "        if: always()\n"
        "        shell: pwsh\n"
        "        env:\n"
        "          PREPARE: ${{ steps.evidence.outcome }}\n"
        "          INSTALL: ${{ steps.install.outcome }}\n"
        "          BUILD: ${{ steps.build.outcome }}\n"
        "          NATIVE: ${{ steps.native.outcome }}\n"
        "          FINALIZE: ${{ steps.finalize.outcome }}\n"
        "          STATUS: ${{ steps.finalize.outputs.status }}\n"
        "          PATHS: ${{ steps.finalize.outputs.paths }}\n"
        "          ARTIFACT_ID: ${{ steps.upload.outputs.artifact-id }}\n"
        "          ARTIFACT_DIGEST: ${{ steps.upload.outputs.artifact-digest }}\n"
        "        run: |\n"
        "          $temp = @(Get-ChildItem -LiteralPath $env:RUNNER_TEMP -Force -Filter 'windows-launcher-evidence-*' | ForEach-Object Name)\n"
        "          $checkout = @(Get-ChildItem -LiteralPath $env:GITHUB_WORKSPACE -Force -Filter 'windows-launcher-evidence-*' | ForEach-Object Name)\n"
        f"          [ordered]@{{ evidence = '{label}'; prepare = $env:PREPARE; install = $env:INSTALL; build = $env:BUILD; native = $env:NATIVE; finalize = $env:FINALIZE; status = $env:STATUS; paths = $env:PATHS; artifactId = $env:ARTIFACT_ID; artifactDigest = $env:ARTIFACT_DIGEST; runnerTempEvidence = $temp; checkoutEvidence = $checkout }} | ConvertTo-Json -Compress\n"
    )


def document(name, branch, comment, jobs):
    text = (
        HEADER + comment + f"name: {name}\n\non:\n  push:\n    branches: [{branch}]\n\n"
        "permissions:\n  contents: read\n\njobs:\n" + "".join(jobs)
    )
    yaml.safe_load(text)
    return text


PREPARE_RUN = (
    "          GG_TEST_EVIDENCE_EVENT_BASE: ${{ github.event.pull_request.base.sha }}\n"
    "        run: node tooling/scripts/windows-launcher-evidence.mjs init\n"
)
NATIVE = (
    "      - name: Native Windows launcher acceptance\n"
    "        id: native\n"
)
NATIVE_RUN = (
    "          GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR: ${{ steps.evidence.outcome == 'success' && steps.evidence.outputs.dir || '' }}\n"
    "        run: pnpm test:windows-launcher\n"
)
ARTIFACT = "          name: windows-launcher-${{ github.run_attempt }}\n"

REFUSAL = """  # Finalize must refuse a planted hard link and a manifest carrying an unknown field, without
  # writing, following or uploading. Expected: both finalize steps fail with the named refusal,
  # no upload step runs, no result.json appears, the outside canary is unchanged, and the
  # assertion step (and so this job) succeeds.
  evidence-refusal:
    name: Evidence refusal control
    runs-on: windows-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - name: Prepare two evidence folders and plant a hard link and a manifest field
        id: evidence
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $folders = foreach ($case in 'hardlink', 'manifest') {
            $env:GITHUB_OUTPUT_SAVED = $env:GITHUB_OUTPUT
            $env:GITHUB_OUTPUT = Join-Path $env:RUNNER_TEMP "qa496-$case-output.txt"
            node tooling/scripts/windows-launcher-evidence.mjs init
            if ($LASTEXITCODE -ne 0) { throw "init failed for $case" }
            $values = @{}
            Get-Content -LiteralPath $env:GITHUB_OUTPUT | ForEach-Object { if ($_ -match '^(dir|id)=(.*)$') { $values[$Matches[1]] = $Matches[2] } }
            $env:GITHUB_OUTPUT = $env:GITHUB_OUTPUT_SAVED
            [pscustomobject]@{ case = $case; dir = $values.dir; id = $values.id }
          }
          $outside = Join-Path $env:RUNNER_TEMP 'qa496-outside-store.db'
          [IO.File]::WriteAllText($outside, "QA496-$env:GITHUB_RUN_ID-HARDLINK-CANARY")
          New-Item -ItemType HardLink -Path (Join-Path $folders[0].dir 'observations.ndjson') -Target $outside | Out-Null
          $manifest = Join-Path $folders[1].dir 'manifest.json'
          $text = [IO.File]::ReadAllText($manifest)
          [IO.File]::WriteAllText($manifest, $text.Insert(1, "`n  `"path`": `"QA496-$env:GITHUB_RUN_ID-MANIFEST-CANARY`","), [Text.UTF8Encoding]::new($false))
          "hardlink_dir=$($folders[0].dir)", "hardlink_id=$($folders[0].id)", "manifest_dir=$($folders[1].dir)", "manifest_id=$($folders[1].id)" | Add-Content -LiteralPath $env:GITHUB_OUTPUT
      - name: Finalize must refuse the hard link
        id: finalize_hardlink
        continue-on-error: true
        env:
          GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR: ${{ steps.evidence.outputs.hardlink_dir }}
          GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID: ${{ steps.evidence.outputs.hardlink_id }}
          GG_TEST_EVIDENCE_INSTALL_OUTCOME: success
          GG_TEST_EVIDENCE_BUILD_OUTCOME: success
          GG_TEST_EVIDENCE_NATIVE_OUTCOME: success
        run: node tooling/scripts/windows-launcher-evidence.mjs finalize
      - name: Finalize must refuse the manifest field
        id: finalize_manifest
        continue-on-error: true
        env:
          GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR: ${{ steps.evidence.outputs.manifest_dir }}
          GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID: ${{ steps.evidence.outputs.manifest_id }}
          GG_TEST_EVIDENCE_INSTALL_OUTCOME: success
          GG_TEST_EVIDENCE_BUILD_OUTCOME: success
          GG_TEST_EVIDENCE_NATIVE_OUTCOME: skipped
        run: node tooling/scripts/windows-launcher-evidence.mjs finalize
      - name: Upload must be skipped (hard link)
        if: ${{ always() && steps.finalize_hardlink.outputs.paths != '' }}
        uses: actions/upload-artifact@v4
        with:
          name: qa496-refusal-hardlink-must-not-exist-${{ github.run_attempt }}
          path: ${{ steps.finalize_hardlink.outputs.paths }}
          retention-days: 1
      - name: Upload must be skipped (manifest)
        if: ${{ always() && steps.finalize_manifest.outputs.paths != '' }}
        uses: actions/upload-artifact@v4
        with:
          name: qa496-refusal-manifest-must-not-exist-${{ github.run_attempt }}
          path: ${{ steps.finalize_manifest.outputs.paths }}
          retention-days: 1
      - name: Assert refusals without writes
        if: always()
        shell: pwsh
        env:
          HARDLINK_DIR: ${{ steps.evidence.outputs.hardlink_dir }}
          MANIFEST_DIR: ${{ steps.evidence.outputs.manifest_dir }}
          HARDLINK_OUTCOME: ${{ steps.finalize_hardlink.outcome }}
          MANIFEST_OUTCOME: ${{ steps.finalize_manifest.outcome }}
          HARDLINK_PATHS: ${{ steps.finalize_hardlink.outputs.paths }}
          MANIFEST_PATHS: ${{ steps.finalize_manifest.outputs.paths }}
        run: |
          $ErrorActionPreference = 'Stop'
          $hardlink = @(Get-ChildItem -LiteralPath $env:HARDLINK_DIR -Force | ForEach-Object Name | Sort-Object)
          $manifest = @(Get-ChildItem -LiteralPath $env:MANIFEST_DIR -Force | ForEach-Object Name | Sort-Object)
          $outside = Get-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'qa496-outside-store.db') -Raw
          $report = [ordered]@{ evidence = 'qa-496-refusal'; hardlink = $env:HARDLINK_OUTCOME; manifest = $env:MANIFEST_OUTCOME; hardlinkPaths = $env:HARDLINK_PATHS; manifestPaths = $env:MANIFEST_PATHS; hardlinkEntries = $hardlink; manifestEntries = $manifest; outsideUnchanged = ($outside -eq "QA496-$env:GITHUB_RUN_ID-HARDLINK-CANARY") }
          $report | ConvertTo-Json -Compress
          if ($env:HARDLINK_OUTCOME -ne 'failure' -or $env:MANIFEST_OUTCOME -ne 'failure' -or $env:HARDLINK_PATHS -ne '' -or $env:MANIFEST_PATHS -ne '' -or ($hardlink -contains 'result.json') -or ($manifest -contains 'result.json') -or -not $report.outsideUnchanged) { throw 'Refusal control failed.' }
"""


def main(candidate, output):
    with open(candidate, encoding="utf-8") as handle:
        text = handle.read()
    job = windows_job(text)

    invalid = renamed(job, "windows-launcher-invalid-prepare", "Windows launcher invalid prepare")
    invalid = inject(invalid, PREPARE_RUN, PREPARE_RUN.replace(
        "        run:",
        "          # QA-ONLY INJECTION: the checkout as runner temp, so the real init refuses.\n"
        "          RUNNER_TEMP: ${{ github.workspace }}\n        run:"))
    invalid = inject(invalid, UPLOAD, UPLOAD_ID)
    invalid += readback("qa-496-invalid-prepare")

    install = renamed(job, "windows-launcher-install-fails", "Windows launcher install fails")
    install = inject(install, "        id: install\n        run: pnpm install --frozen-lockfile\n",
                     "        id: install\n        # QA-ONLY INJECTION: install fails.\n        run: exit 1\n")
    install = inject(install, ARTIFACT, "          name: qa496-not-run-windows-launcher-${{ github.run_attempt }}\n")
    install = inject(install, UPLOAD, UPLOAD_ID)
    install += readback("qa-496-install-fails")

    negative = renamed(job, "windows-launcher-negative", "Windows launcher negative evidence")
    negative = inject(negative, NATIVE, "      - name: QA negative native acceptance\n        id: native\n")
    negative = inject(negative, NATIVE_RUN, NATIVE_RUN.replace(
        "        run: pnpm test:windows-launcher\n",
        "          QA_496_CANARY: QA496-${{ github.run_id }}-${{ github.run_attempt }}\n"
        "          GG_QA_496_ENV_CANARY: QA496-${{ github.run_id }}-${{ github.run_attempt }}-ENV\n"
        "          QA_496_PLAIN_ENV_CANARY: QA496-${{ github.run_id }}-${{ github.run_attempt }}-PLAINENV\n"
        "        # QA-ONLY INJECTION: the generated negative suite instead of the exact command.\n"
        "        run: node --test tooling/scripts/windows-launcher.qa-negative.acceptance.mjs\n"))
    negative = inject(negative, ARTIFACT, "          name: qa496-negative-windows-launcher-${{ github.run_attempt }}\n")
    negative = inject(negative, "          include-hidden-files: false\n",
                      "          include-hidden-files: false\n          retention-days: 7\n")
    negative = inject(negative, UPLOAD, UPLOAD_ID)
    negative += readback("qa-496-negative-upload")

    outputs = {
        "qa-496-invalid-prepare.yml": document(
            "QA 496 invalid prepare and not-run evidence", "codex/qa/gg-496-invalid-prepare",
            "# Branch codex/qa/gg-496-invalid-prepare from the EXACT frozen corrected candidate commit,\n"
            "# adding only this file.\n",
            [invalid, install]),
        "qa-496-candidate-negative.yml": document(
            "QA 496 candidate negative evidence", "codex/qa/gg-496-candidate-negative",
            "# Branch codex/qa/gg-496-candidate-negative from the EXACT frozen corrected candidate commit,\n"
            "# adding only this file and tooling/scripts/windows-launcher.qa-negative.acceptance.mjs\n"
            "# (generated by make-negative-acceptance.py from that candidate's suite).\n",
            [negative, REFUSAL]),
    }
    os.makedirs(output, exist_ok=True)
    for name, content in outputs.items():
        with open(os.path.join(output, name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        print(f"wrote {name}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
