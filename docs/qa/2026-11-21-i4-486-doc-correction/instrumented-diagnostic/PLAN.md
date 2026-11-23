# Bounded browser diagnostic

Base: `29e165e14fdda138300ba2a34585ddd47268b475`, new worktree `G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin`, branch `codex/gg-i4-553-browser-diagnostic`.

Execute one instrumented instance of the exact failing PWA case. Only if it does not reproduce, execute one sequence containing its three immediately preceding PWA cases and the target. Keep the existing 60-second timeout, zero retries, all assertions and update deadlines. Record failure before finally and cleanup failure separately; do not convert either to a pass.

Observation only: attempt-correlated page/worker protocol stages, safe acknowledgements, held/pending scoped locks, worker activation/controller events and low-frequency snapshots. Record only opaque identifiers, states, scoped pathnames and protocol outcome/reason. No audio, message content, credentials or owner stores.

Runtime: Node 22.23.4, pnpm.cmd 12.8.1. Reuse G:/.pnpm-store with independent node_modules, frozen offline install, no browser download. Existing msedge 158.0.4370.33 matches the failed CI's browser version/channel, but Windows vs Linux and diagnostic timing effects remain limits. TEMP/TMP/cache/artifacts stay in this new G packet.

Budget: one install (scripts disabled), one existing web build command (owner and Goblin), at most two diagnostic invocations, no automatic retries. Expected 10–20 minutes, G storage at most 3 GiB; C downloads zero. Stop on a valid reproduced failure and hand off causal evidence. No production fix, source commit, CI rerun or GitHub publication.

Retain baseline/patch/output bindings, commands, exit codes, timestamps, raw logs, all instrumentation failures, exact task PIDs and cleanup results, then SHA256-seal the packet. Original failed CI remains failed regardless of local observations.
