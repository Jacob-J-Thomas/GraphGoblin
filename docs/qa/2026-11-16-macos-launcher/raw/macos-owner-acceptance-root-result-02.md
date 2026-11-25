# Owner Mac engineering acceptance 02

Candidate `370a12b5784252356807bfc7676f65f6cb19b5e0`, tree `2207dd91338e0bc3ffdb4f8fc81531eb0ae08b3c`, owner product build `db37bfdf935746039f9030c4d49b10fb`.

The acceptance run `b5423e10d95f472a91a67e784d6d954d` failed with `read ECONNRESET` during verified drain after eight checkpoints passed. Its catch/finally saw `ECONNREFUSED`. Preserve the original exit 1 / SSH exit 2 and full receipts in `macos-owner-acceptance-execution-02/receipts/acceptance-b5423e10d95f472a91a67e784d6d954d`. This is not a ninth-checkpoint pass.

Passed checkpoints cover public installation, unrelated listener preservation, occupied keyless-store refusal, concurrent cold convergence, warm reuse and query-secret log exclusion, physical Darwin log contention, managed API key admission, and same-path replacement with real held-store timeout diagnostics. No Finder/Dock interaction was exercised.

Root fully inspected both read-only probe sources in `macos-owner-acceptance-drain-diagnosis-01` and invoked the exact command hash `09d273828e1c2895da80e0eba95cd4acb8006a78be06eb2b4693e52532ca570f` once at 20:58:27 UTC. SSH exited 0; stdout 22,796 bytes SHA-256 `dcaa6b0e67dd937a482a83cc248df29b0ae6a679f22b8a1dca8dfa00b0567df5`, empty stderr. The probe made no stop, retry, signal or filesystem mutation on the Mac.

Both bracketed observations found original PID 44374 absent, ports 62277 and 62278 refusing connections with no lsof listeners, and both original lease paths and their reclaim paths absent. The installed replacement app and final receipt retained their exact recorded identity and hashes. The private gateway log matched the previously captured prefix and recorded POST `/system/shutdown` request `req-x` completed with status 202. Its raw bytes are retained with SHA-256 `aad5a5e77dd8ccb3de44d2afbb6b2463e315235bee8d7dd71daf2f4a74bd2c7d`.

This establishes subsequent process/listener/lease release and a server-side 202 record. The original run did not persist whether its client had received the complete POST response before the reset; do not claim that distinction is proven. A bounded harness correction will retain POST uncertainty as failure, treat a reset during later health polling as unresolved rather than released, and record client-response and release milestones. No product defect is established by this failure.

The retained fixture is unchanged. Independent Claude behavior QA may proceed against the same immutable product build after its own fresh admission checks. Owner interactive acceptance and final review remain separate.
