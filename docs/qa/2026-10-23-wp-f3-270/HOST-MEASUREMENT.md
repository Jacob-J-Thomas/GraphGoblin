# Validation host measurement

Read-only snapshots from `Get-Process node | Measure-Object -Property WorkingSet -Sum`
returned 117 Node processes with combined working sets of 12,743,442,432 bytes, then
90 processes with 11,826,663,424 bytes. These are summed process working sets, not a
measurement of exclusive physical memory. Raw terminal snapshots were not kept.

Broad suites hit multiple unchanged timeout/performance assertions. Reducing this
worker's suite concurrency did not remove all failures. The measurements establish
host load, not proof that load caused every failure. The existing failures remain
unresolved; no test timeout, coverage threshold or exclusion was weakened.

The initial broad API, web and infrastructure runs were interrupted after failures
accumulated. Their partial logs are retained. Final runs use two workers and enable
coverage reporting on failure, so a nonzero test result remains a failure even when
coverage exceeds the package thresholds.

A later one-second psutil sample reported 100% CPU utilization across 12 logical CPUs,
68,662,202,368 total memory bytes and 26,223,337,472 available bytes (61.8% used).
The raw result was transcribed here; its terminal capture was not kept. This supports
CPU contention during validation, not a claim that memory exhaustion caused failures.
