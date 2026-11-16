# Private staged-path correction

This evidence records a narrow correction to the frozen #436 launcher candidate. The private `--validate-install` and `--stage-shortcut` modes now require fully qualified Windows paths for the staged config, shortcut, and final EXE. The check accepts drive-absolute paths and UNC paths with a nonempty server and share; it rejects drive-relative paths such as `C:folder\file` and current-drive-root-relative paths such as `\folder\file`. `Path.GetFullPath` remains in place for final-EXE normalization after the guard.

The ordinary launcher configuration validation, public PowerShell parameters, and `scripts/install-windows-launcher.ps1` are unchanged. Existing positive assertions for the installed shortcut target and config arguments remain in the focused test. The regression cases validate the installed config successfully by its absolute path, then check both rejected path forms for config, staged shortcut, and final EXE. Each rejection must emit the fixed refusal, preserve the installed/source/managed shortcut bytes and empty store, and leave no staged link.

## Source snapshots

The `before/` copies match the frozen six-file candidate hashes recorded in the original candidate source manifest; that historical manifest was not changed. The `after/` copies are final source snapshots; focused execution preceded the documented formatting-only MJS change. `Launcher.cs.diff` and `windows-launcher.acceptance.mjs.diff` show only this correction relative to those copies.

| File                                              | Frozen candidate SHA-256                                           | Corrected SHA-256                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/windows-launcher/Launcher.cs`               | `e1171d840ff332e22826194edbef251e5d46688c2af3ff6bc3dc0f76c6e60091` | `1adc34b4f5188dac9ba1568c1763dcad801dccc464115fd7123c4d35671c9d68` |
| `tooling/scripts/windows-launcher.acceptance.mjs` | `9e8572882ebbb602bf3af153edf6f9685ffdc1dc372a7f209292ad69e8aa39ba` | `f2ec7e5f885934e200ac720f3a5c2a2b07e5b1adae87097dcedf420b2973a561` |

## Checks

- `pnpm.cmd exec node --test --test-name-pattern="Windows PowerShell 5.1 installer" tooling/scripts/windows-launcher.acceptance.mjs` — passed 1/1 on Node `v22.23.4`. This focused group compiles the launcher fixture with the installed .NET Framework compiler and exercises the Windows PowerShell 5.1 installer group; it is not the full acceptance suite.
- `pnpm.cmd exec eslint tooling/scripts/windows-launcher.acceptance.mjs` — passed.
- The first scoped Prettier check found formatting in the edited test. The formatter was applied after the focused run; final scoped ESLint and Prettier checks passed. Tests were not repeated for that formatting-only change.
- `git diff --check -- apps/windows-launcher/Launcher.cs tooling/scripts/windows-launcher.acceptance.mjs` — passed.

The check receipts and original command outputs are retained here. No full build, coverage run, full suite, or independent Opus regression was run in this task. Opus C11b was not an independent test result; the local focused group now includes a drive-relative and root-relative final-EXE refusal regression. Independent review of these corrected bytes remains pending.

See `source-copy-map.json` for source/destination provenance and `SHA256SUMS.txt` for the packet inventory.
