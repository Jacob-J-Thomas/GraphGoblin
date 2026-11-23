# D226 diagnostic member verification

**Accepted for the frozen v2 generator** at SHA-256 `7f3afa303764df1c45b580b0753c6dac34ba86c0bb7f0de8eb57024e21158acc`. The correction is confined to the loop that verifies members of the immutable public diagnostic seal. The generator continues to require positive sizes for ordinary root metadata references.

Root's real v1 invocation stopped before output or provider launch. The public diagnostic seal lists 26 files. One is empty, `qa-boundary-lint-corrected.log.txt`, with SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Passing this descriptor through v1's generic metadata pin produced `EXACT_PATH_BYTES_HASH_REFERENCE_REQUIRED`.

The first independent review missed that failure. Its substitute pin compared real file sizes and hashes but omitted the generic validator's positive-size rule. This closure uses the actual nested pin extracted from each generator together with its actual `completion_evidence` function. It confirms the v1 refusal, then accepts all 26 original descriptors under v2. The original v1 acceptance and source are preserved. [V1 reproduction](checks-01.json) · [V2 results](checks-02.json)

V2 accepts the empty regular file and still verifies every member's path, integer byte length and SHA-256. The 19 closure controls included refusal of a missing file, a boolean or negative size, size drift, digest drift at constant size, a directory, duplicate membership, wrong count, and paths outside the diagnostic directory. The top-level metadata pin still rejects the same zero-byte file. An AST comparison confirms all statements outside the diagnostic-member loop match v1. [Scope and integrity](verification.json)

The tests used synthetic files and the public diagnostic evidence. They invoked neither the real generator nor Git and accessed no product checkout, provider or private inputs. Root owns actual admission, the reservation and the next runtime result. The original general feature review ledger remains at one of three scans.

