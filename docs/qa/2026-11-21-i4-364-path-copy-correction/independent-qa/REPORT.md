# #364 path-copy documentation QA: PASS

Independently compared committed parent `c9d23dd1a996cde40d285c1ce103b8c8291cb3ab` with frozen head `67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40`
(tree `bb0bd9a31e1d873c88778ff11b78b9ad46fd5c8e`), the actual working file and the ClaudeHarness constructor default.

Only `docs/guide/07-troubleshooting.md` changed in the commit, and only line168 changed
in that file. Parent bytes contain exactly one forbidden ASCII control, BACKSPACE
`08`, in the executable path. It becomes literal backslash+b `5c62`. The new backtick
code span is `%USERPROFILE%\.local\bin\claude.exe`, exactly matching the constructor's
USERPROFILE/default-home root and `.local`, `bin`, `claude.exe` components. Backslashes
are literal characters inside that code span. No forbidden ASCII controls remain in
the whole guide (TAB/LF/CR are permitted; other C0 controls and DEL were checked).

Every other line is byte-identical. After that precise path replacement, all table
cell values remain byte-identical; only edge padding in the repaired row differs.
The replacement adds 1 byte; formatter padding removes 2 spaces,
so the complete file is 86657 → 86656 bytes. The author's report says one
padding space was removed; the committed byte calculation establishes two. This is
an evidence-count wording discrepancy, not an additional content or source defect.

The author's before/after/pre-format artifacts exactly match the independent committed
byte observations, and all 13 listed author artifact hashes verify. Before SHA-256:
`df578ac99506704201c256fcfe6d3d26a2705d122af889957379e4d8e1754bee`. After SHA-256: `fd08def3e8c16bfc7415081a41875780523f7f5fbb903e8e24f39b252241732f`.

The whole-commit path delta is the guide alone. Runtime harness and the D203 five
files retain exact Git blob/mode entries; the complete old `docs/qa` subtree has the
same tree ID in parent/head. Source is clean at the exact frozen head, and physical
index/status/head/tree snapshots are unchanged across this inspection. No earlier
sealed preparation or source/index/master was edited.

This is independent static documentation QA of root's repair. No runtime, browser,
product test, build, provider/model or GitHub execution was performed, and no runtime
QA or whole-PR approval is claimed. All three general scans remain consumed; bounded
Fable review and remaining current delivery/coordinator gates stay with root.
Exact observations and source/index bindings are in `observations.json`.
