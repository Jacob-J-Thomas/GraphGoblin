# D242 linked-index drift readback

The drift is **not precisely stat-only**. All 42,433 entry paths, modes, blob IDs, stages, assume-valid flags and intent-to-add flags match the preserved closure index. Exactly one entry, `docs/qa/design-contrast.md`, cleared skip-worktree (`true` to `false`) and its extended-entry flag. Raw entry flags changed `401a` to `001a`; extended flags changed `4000` to `0000`. Its mode remains `100644`, blob remains `1957f5e21c6abad9f4a1f778ea3c62189ac675d3`, and stage remains 0. No staged-content change was observed.

That entry's cached ctime and mtime changed from zero to 1795442147 seconds plus 640564000 nanoseconds; cached size changed from 0 to 94,552 bytes. Device, inode, uid and gid remain zero. Removal of the two-byte extended flag shifts the path two bytes earlier and increases zero padding by two bytes; the entry stays the same length. The complete change comprises 47 bytes within this entry and 20 checksum bytes. No changed byte falls elsewhere.

Both files are valid Git index version 3 with valid SHA-1 trailers. The header and sole TREE extension are byte-identical. The TREE payload is 164,372 bytes, SHA-256 `053d1b6ef5c4aeb75f879efa7b86a0fa57d8f8e704801aa37825fb03be3ae610`.

The old 6,399,084-byte raw index SHA is `7398ff37f5c1e757d1ecdfea8e0a1db456d9f6bd5053f94887d1417c89fd7d7d`; current SHA is `5097f228a1207a5db75ca1154c0f6d5afb37940772c57b00e54685ef984b2dbc`. The current index was read twice identically at capture and re-read after parsing; its bytes and mtime remained unchanged. This identifies the current pin, not permission to reset it or acceptance of its changed sparse-checkout flag.

`audit-index.py` reproducibly parses only the preserved raw evidence copies. `REPORT.json` is the final structured result and contains corrected numeric field counts. The earlier `PARSE-SUMMARY.json` is retained as an initial parser receipt: its field-count display mistakenly contained the per-field delta objects rather than counts; its raw/semantic observations are preserved, and it is superseded by REPORT.json. Complete old/current semantic records, the changed stat fields and both raw originals are retained.

Cause remains **unestablished**. Cached stat values and capture timestamps do not identify which process caused the change. No Git command, product-source read, source/index write, restore, update, staging, formatting, test or process action was performed. The original controller closure was not edited. Root decides whether and how to qualify the current pin and sparse-checkout flag before proceeding.
