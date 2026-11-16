# #436 installer implementation handoff

This packet preserves the six-path candidate and its focused implementation checks. The detailed handoff is copied byte-for-byte as [implementation-report.md.txt](implementation-report.md.txt); its original links retain source-folder context.

## Source and narrow checks

The unchanged baseline carrier is head `36048e8f40cda520c2ec7b5865d3ff8c5bae6624`, tree `382dcd6fa76f8b04a914787e08d9291d1672d088`, based on main/product parent `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. The six candidate changes are frozen source snapshots, not changes committed at that head. [candidate-source.json](candidate-source.json) records their exact hashes; [source-copy-map.json](source-copy-map.json) maps each copied file and lists omitted fixtures and duplicate intermediate runs.

The two initial Windows PowerShell 5.1 test failures are retained: the first hit a parser error on an inline hashtable assignment; the next failed when the Node-spawned shell could not resolve `Get-FileHash`. The captured exception is included. The frozen PS 5.1 group later exited 0 in 6.547 seconds, with its positive and three negative controls passing.

The final focused PowerShell 7 installer smoke and composed publisher rollback checks also exited 0. The smoke covered first install and same-path `-NoShortcuts` replacement with relative Node/PWA paths. The rollback check observed a real Windows sharing violation (`0x80070020`) after the first replacement, reported `restored`, and read back both original byte strings. It does not measure public-installer timing.

The handoff reports scoped ESLint, Prettier, PowerShell 7 syntax and six-path `git diff --check` passing. Machine-readable command receipts and outputs for ESLint and Prettier are included. These focused checks do not represent a whole-repository build, coverage run, independent native regression suite, full hosted matrix, or current-candidate acceptance. Full hosted matrix, process observation and rollback remain outside this local evidence set. The [separate old-source baseline packet](../2026-11-16-installer-validation-baseline/README.md) shows the 32-case reproduction; this packet does not change its meaning.

## Retained evidence

- [First PS 5.1 failure](failures/native-installer-first.json) · [TAP/CLIXML log](failures/native-installer-first.log)
- [Second PS 5.1 failure](failures/native-installer-ps51-correction.json) · [log](failures/native-installer-ps51-correction.log) · [captured exception](failures/diagnostic-exception.txt)
- [Frozen PS 5.1 run](checks/native-installer-frozen.json) · [TAP](checks/native-installer-frozen.log)
- [Frozen PS 7 smoke](checks/installer-smoke-ps7-frozen.json) · [output](checks/installer-smoke-ps7-frozen.log) · [driver script](checks/installer-smoke-ps7.ps1)
- [Frozen rollback check](checks/rollback-focused-frozen.json) · [result](checks/rollback-focused-frozen.log) · [script](checks/rollback-focused.ps1)
- [Scoped lint](checks/scoped-lint.json) · [output](checks/scoped-lint.log) · [format check](checks/scoped-format.json) · [output](checks/scoped-format.log)

All six source snapshots are under [source/](source/). [SHA256SUMS.txt](SHA256SUMS.txt) hashes each file in this packet.
