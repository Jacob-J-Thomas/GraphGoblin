# Windows acceptance evidence correction

Independent Claude Code Opus 5.5 xhigh operator QA passed both corrections on `9ae40884bad2cb28ccb4b962b8ee3cab81835c68`, compared with the held `107c0c4a9715b988b1342f6bf004ce4af344362b`. The two builds used identical product ownership code. [Source and original report hashes](source-bindings.json).

| Check                         | Result                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refusal classification        | 20/20 expected outcomes matched. The corrected assertion rejected a retained compound cleanup failure and accepted clean expected refusals. Genuine, distinct filesystem failures remained visible.            |
| Recorder and finalization CLI | 42/42 expected outcomes matched. Success required consistent, complete contender, owner and cleanup observations. Failed and partial runs retained downloadable evidence.                                      |
| Hosted observation controls   | 8/8 expected outcomes matched. The unchanged 298-observation hosted corpus also replayed under both helpers with byte-identical final results.                                                                 |
| Maintained tests              | 40/40 evidence tests and 60/60 lock tests passed.                                                                                                                                                              |
| Real Windows launcher suite   | 23/25 passed. Directory symlink creation failed under this host's permissions, which also failed its parent case. All three ordinary ownership trials passed with one live owner and four clean refusals each. |

The first recorder run matched 40/42 expectations. The operator had expected the old helper to accept two duplicate-total cases that its existing rules already refused. The original results and corrected expectations are both retained in [the per-case results](results.json).

The prior Windows failure recording was replayed. This QA did not independently observe a new occurrence of that failure or establish the operating-system cause of either historical incident. Source-matched cases, retained native evidence and new native observations are distinguished in the original operator report. Current-target CI, bounded correction review and the coordinator's merge decision are separate gates.
