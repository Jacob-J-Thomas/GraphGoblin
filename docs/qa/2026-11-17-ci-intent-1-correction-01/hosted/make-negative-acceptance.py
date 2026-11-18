"""Generate the QA-ONLY negative-control copy of the Windows launcher acceptance suite (#496).

Never published to the candidate. Applies anchored injections to the candidate suite:
  - stdout, store-like file, key-like file, environment and linked-directory canaries;
  - a deliberate installer child failure (exit 7) whose stderr carries the env canary;
  - an oversized child output stopped by execFile's maxBuffer, and a child killed by timeout;
  - an oversized, schema-invalid record that must be rejected without being written;
  - a forced unverified release for the junction alias, so the junction to the checkout is
    retained and its disposition must be reported without traversal;
  - 1,100 extra records at the end to force the overflow/omission path.

Usage: python -I make-negative-acceptance.py <candidate-acceptance.mjs> <output.mjs>
"""
import sys

INJECTIONS = [
    (
        "const execute = ciEvidence.observeExecFile(promisify(execFile));\n",
        "const execute = ciEvidence.observeExecFile(promisify(execFile));\n"
        "// QA-ONLY NEGATIVE CONTROL (#496): injected failures and canaries. Never publish.\n"
        "const QA = process.env.QA_496_CANARY ?? 'QA496-CANARY-UNSET';\n"
        "console.log(`QA stdout canary ${QA}-STDOUT`);\n",
    ),
    (
        "    ciEvidence.fixture('installer', base);\n",
        "    ciEvidence.fixture('installer', base);\n"
        "    await writeFile(join(base, 'qa-store-canary.db'), `${QA}-STORE`);\n"
        "    await writeFile(join(base, 'qa-gateway-key.txt'), `${QA}-KEY`);\n"
        "    await execute(\n"
        "      process.execPath,\n"
        "      ['-e', 'process.stderr.write(String(process.env.GG_QA_496_ENV_CANARY)); process.exit(7)'],\n"
        "      { timeout: 10_000 },\n"
        "    );\n",
    ),
    (
        "    ciEvidence.fixture('contention', base);\n",
        "    ciEvidence.fixture('contention', base);\n"
        "    await execute(process.execPath, ['-e', 'process.stdout.write(\"o\".repeat(3 * 1024 * 1024))']).catch(\n"
        "      () => undefined,\n"
        "    );\n"
        "    await execute(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 500 }).catch(\n"
        "      () => undefined,\n"
        "    );\n"
        "    ciEvidence.record('child', {\n"
        "      case: 'lock-contention',\n"
        "      subtest: 0,\n"
        "      diagnostic: `${QA}-RECORD-${'x'.repeat(5000)}`,\n"
        "    });\n",
    ),
    (
        "      if (roundFailure) throw roundFailure;\n    }\n  } catch (error) {\n    failure = error;\n",
        "      if (roundFailure) throw roundFailure;\n    }\n"
        "    if (kind === 'junction') {\n"
        "      releaseVerified = false;\n"
        "      stage = 'direct-release';\n"
        "      throw Object.assign(new Error('QA-only unverified release'), { code: 'EQAUNVERIFIED' });\n"
        "    }\n"
        "  } catch (error) {\n    failure = error;\n",
    ),
    (
        "    ciEvidence.fixture('logs', base);\n",
        "    ciEvidence.fixture('logs', base);\n"
        "    const qaLinked = await mkdtemp(join(tmpdir(), 'qa496-linked-'));\n"
        "    await writeFile(join(qaLinked, 'linked-canary.txt'), `${QA}-LINKED`);\n"
        "    await symlink(qaLinked, join(base, 'qa-linked-directory'), 'junction');\n"
        "    await writeFile(join(base, 'qa-link-source.txt'), `${QA}-HARDLINK`);\n"
        "    await link(join(base, 'qa-link-source.txt'), join(base, 'qa-link-hard.txt'));\n",
    ),
    (
        "    console.log(JSON.stringify({ evidence: 'windows-launcher-bounded-logs', artifacts: base }));\n",
        "    for (let index = 0; index < 1100; index++)\n"
        "      ciEvidence.record('cleanup', { action: 'gateway-drain', result: 'drained', count: null });\n"
        "    console.log(JSON.stringify({ evidence: 'windows-launcher-bounded-logs', artifacts: base }));\n",
    ),
]


def main(source, output):
    with open(source, encoding="utf-8") as handle:
        text = handle.read()
    for anchor, replacement in INJECTIONS:
        if text.count(anchor) != 1:
            raise SystemExit(f"anchor not unique: {anchor[:60]!r} ({text.count(anchor)})")
        text = text.replace(anchor, replacement)
    with open(output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(f"wrote {output} with {len(INJECTIONS)} QA-only injections")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
