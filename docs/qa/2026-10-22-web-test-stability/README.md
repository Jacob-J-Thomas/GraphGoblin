# Web test stability evidence

The original [before](before.md) and [after](after.md) records describe round 1.
The [round 2 report](round2.md) records the next audit response; the
[round 3 report](round3.md) records the observation and provenance follow-up. Later rounds
retain their own transcripts under a round prefix; earlier passes do not erase
earlier failures or establish that a subsequent revision passes.

[Original provenance](evidence-provenance.json) and
[round 2 provenance](round2-evidence-provenance.json) distinguish capture bytes
from committed bytes. Existing `originalSha256` values hash the source capture
before documented redaction, where available. Existing `retainedSha256` values
hash the retained capture after redaction, before Git normalization. These
historical hashes and the original redaction notes are preserved unchanged.
They do not claim to hash a Git blob or a later checkout's representation.

Every entry also records `committedSha256`, the SHA-256 of its committed byte
representation, and `committedGitBlob`, Git's blob object ID for those bytes.
`captureHashScope` labels the historical fields; `gitNormalization` describes
the file's transformation. The repository attribute `* text=auto eol=lf`
converts CRLF pairs to LF for text Git normalizes. Files Git classifies as
binary, including some older UTF-16 or mixed-encoding logs, retain every byte.
Lone carriage returns and other bytes are preserved.

Round 3 verifies these fields by reading `git ls-files --eol`, normalizing the
working-tree buffers byte by byte where Git treats the file as text, and
hashing that result. `git hash-object --no-filters --stdin` supplies its blob
ID. A separate `git hash-object --path=<path> <path>` applies Git's own clean
conversion; the two IDs must agree. For all 139 historical entries, both the
computed ID and the complete normalized buffer must also equal the existing
HEAD blob. This bridges the historical captures to the committed artifacts
without replacing capture hashes or reformatting the captures.

Raw QA JSON, YAML and JavaScript/TypeScript evidence remains excluded from
Prettier; Markdown stays formatted. Formatter preservation and Git's text
normalization are separate operations. No index write or commit is performed
by these verification commands. New round evidence predicts the bytes the
orchestrator will commit using the same Git clean-conversion comparison.
