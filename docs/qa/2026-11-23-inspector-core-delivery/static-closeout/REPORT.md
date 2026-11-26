# D242 archive-integrated local static gates

All **12 local static gates passed** on `847f0750cc354cd4510707c9faa2fda060b4c301`, tree `f4895587b638e2f043707edfd9add5bace26533d`. Wrapper session 6740 closed with exit 0. The separate Node probe selected v22.23.4 and passed. The runner then completed typecheck, lint, format, layers, migrations, tokens, dependencies, templates, licences, generated docs, contrast and high-severity audit once each through the pinned pnpm runtime. [Phase receipt](PHASE-RECEIPT.json)

Independent readback matched all 13 pairs of start and exit receipts and rehashed both streams for every command. The 12 pre-gate snapshots and unconditional final snapshot match the admitted source and all 18 exact mode/blob/physical-byte pins. Both raw linked index copies match `209db753c64ebd3520da3467b8a0d900ba1c9d18002141e974772bae7eff4171`. Staged entries, local main ref and common HEAD digest stayed equal, with a clean checkout and no common index. [Before](before.json) · [After](after.json)

The first closeout readback stopped on differing slash separators in the captured index pathname. Windows path normalization confirmed the same linked index, and exact snapshot and raw index comparisons still passed. No gate reran. [Readback correction](../i5-d242-local-static-closeout-preparation-01/READBACK-CORRECTION.md)

The earlier f642 contrast failure remains preserved. The archive-integrated contrast gate reported zero failing enforced pairs. Audit exited 0 at the high-severity threshold and reported 7 low and 13 moderate advisories. This closure covers the recorded local static gates. Hosted CI, signed merge, owner acceptance and deployment have separate evidence.
