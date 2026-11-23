# D240 old-helper regression evidence

The focused Vitest file ran once with Node `v22.23.4`, one worker and zero retries. With the unchanged D236 helper, 22 tests passed and three failed, for 25 active tests and no skips. Vitest exited 1. All 21 original cases and the new positive retry case passed. [Command receipt](01-old-helper.receipt.json) · [Raw stdout](01-old-helper.stdout) · [Raw stderr](01-old-helper.stderr)

| Public schedule | Observed old-helper result |
| --- | --- |
| Cancel a warm paused refetch before the GET | The reverted query retained its exact body and update count, and the network mock was untouched. The receipt's `committed` dropped from 52 to zero while loss stayed 53. |
| Cancel between a transport failure and the application's default retry | A single request failed and the cache still had the same body/count after cancellation. The receipt's `committed` dropped from 54 to zero while loss stayed 56. |
| Unmount and remount the last real `useRun` observer offline | The existing provider and cache remained mounted. The paused refresh reverted to idle on unmount with zero observers. Remount paused again with one observer and no new GET. The same cache revision survived, but the returned receipt went from 61 to zero. |
| Let a default transport retry succeed | The same body gained a new update count and the committed read advanced past the loss boundary. |

The pre/post source hashes match. The original helper was `c5fd15d3d355bb2928bb196f7c36371b3588f1d639b63da110e8d2c6808ab0c5`; `queries.ts` was `ddde12b11ca03fcd3d777db09d6787756d5b8d92de74e169cfed54312c434b36`. The regression file executed at `f4ea26570ddb03a4729d708bd20fa34c073fd981ec8bbad5642e16ebe423596e`. The old-candidate reference is the frozen D236 head. This runner checked file hashes directly. [Executed test source](executed-test-source.ts.txt)

The negative result confirms D240/B1, including the actual unmount cancellation schedule in the installed TanStack version. Root now owns the helper correction and scheduling of corrected evidence. The heavy slot was released after this single command completed.

