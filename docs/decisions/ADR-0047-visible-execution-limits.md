# ADR-0047: Visible execution guardrails and explicit unlimited mode

Status: limits design accepted in orchestrator review; no-default deadline decided by D-027. Implementation verification and independent QA remain separate.
Date: 2026-10-21.

Execution controls concern graph repetition and elapsed time, never cost, tokens,
subscription usage or provider-turn counts. Preserve format 4's per-gate passes;
do not reintroduce the retired shared iteration counter.

Keep maxNodeVisits default 10; add runDeadlineSeconds with no deadline by default
(`nullable().default(null)`, D-027). Visits and authored repeat maxPasses accept null for
explicit Unlimited with a plain warning. The deadline uses a neutral No run deadline
choice; choosing Limited suggests 3,600 seconds, which the author can change. Settings
reads the same schema defaults. Both loop limits are pinned and visible in the inspector.

The original finite one-hour default was rejected: omitted settings on existing loops
and runs would introduce a new hidden stop for overnight human waits, day-long heartbeats
and polling workflows. No existing loop or run gains a deadline. A finite deadline is
always authored; 3,600 is a UI suggestion, never an owner-approved default.

The elapsed clock starts at first execution and includes waits, pauses and downtime.
Durable timers and checks around node execution prevent late results from replacing
a timeout. Cancel remains distinct. A one-off SQL migration pins existing limits from
their immutable definitions, preserving damaged JSON for existing diagnostics.

Remove Claude's hidden 100-turn and ten-minute inference ceilings. Explicit node/run
signals govern inference. Output/protocol resource bounds remain typed failures;
no successful silent truncation of the final result is permitted. The 16,384-character
message/reasoning and tool-output item detail excerpts bound durable storage and inspector
detail, without truncating the final result or stopping execution. External provider
limits remain failures and cannot be disabled by GraphGoblin.

Preserve HARNESS_TRANSPORT_FAILED at run level. A positive retriable transport failure
that F4 classifies definitely-not-submitted gets at most one automatic retry, retaining
its exact task. No generic, quota, auth, timeout, protocol or uncertain work retry.
#270 owns structured-completion deadlines; #335 remains deferred allowance recovery.
