# D240 implementation-debugging outcome addendum — draft

This records ordinary implementation debugging within the existing D240 scope;
it creates no decision ID, gate waiver, owner approval or delivery increment.
Initial formatted UI `6924` produced 159 pass/5 fail/0 skip; all first outputs remain.
Actual Opus 5.5/xhigh's correction handoff closed 09:14:02 UTC. Root accepted its
process/source-control readback and admitted checks only. Corrected execution,
independent QA and review remain **PENDING**.

**Queued-mutation fixtures.** Three tests changed default onMutate after their
mutation observers already held options, so their queued barrier never ran;
they failed before exercising gate/failure change or zero-POST assertions.
The correction uses the public MutationCache callback, awaited before mutationFn,
and releases held work in finally. This makes the intended queue observable
without weakening queued/NOT_SENT/failure identity/draft/zero-POST checks.
Changing production send guards for these fixture-only failures, dropping the
queue assertion, raising timeouts or adding retries were declined. Whether
all corrected tests execute as intended is still pending.

**Reconnect initial-SSE boundary.** The first focused run observed two
additional GETs against an exact-one recovery assertion. The root hypothesis,
now source-supported by the author, is the initial two-event SSE batch/live
refresh crossing the held-read setup. The corrected fixture observes the
Timeline's two events, two initial run GETs and idle before holding the pre-loss
read. It retains one post-loss recovery read, zero POSTs and stale-until-qualified
commit. An arbitrary sleep, relaxing the count to two, weakening loss authority
or changing legitimate production refresh solely to satisfy the fixture were
declined. Runtime causality and corrected counts remain **PENDING**; the source
explanation is not itself execution evidence.

**Timeline same-window focus.** Home failed to focus the first visible row in
the three-row paused list. Source diagnosis found that an unchanged anchor
could leave the focus effect without a commit. Actual Opus authored the small
production correction: request focus before updating active state; avoid a
pending request when the requested target is already focused. The added
regression repeats Home and then types in the sequence field to detect focus
being stolen on a later render. The original keyboard, selection, single Tab
stop/window/history budgets stay required. A passing corrected result and real
browser geometry/keyboard acceptance are **PENDING**; none is inferred here.

[Initial raw focused report](raw/i5-416-420-author-focused-01/REPORT.md)
· [Root named correction brief](raw/i5-416-420-max-correction-admission-01/BRIEF.md)
· [Actual correction handoff](raw/i5-416-420-actual-max-correction-01/ordinary-handoff.md)
· [Checks-only source binding](raw/i5-416-420-corrected-checks-01/BINDING.json)

The original core CHANGES_REQUIRED/B1 correction and later bounded Fable ACCEPT,
S2 first failed oracle/native-body qualification, accepted synthetic restoration
limit and parked #561 retain their own records. Compare `committed > loss` after
recovery; nonzero loss alone does not prove an active outage. All UI/action,
listener/browser, coverage/static, opposing review, current CI, final MAX,
signed merge and consolidated owner accept/rework/QA gates remain.
