# Owner Mac drain diagnosis

Acceptance b5423e10d95f472a91a67e784d6d954d passed eight checkpoints. Its two successful pre-control identity observations identify PID 44374 with birth Mon Nov 16 14:50:03 2026. The driver then reported read ECONNRESET during verified-drain. Its final identity recheck reached ECONNREFUSED on 62277. Neither observation alone identifies which HTTP call reset, establishes a 202 seen by the client, or confirms both leases released.

Run once after root reads both sources and inspects the rendered command. Use the project Node 22.23.4.

    node run-drain-diagnosis.mjs --preview
    node run-drain-diagnosis.mjs --run 09d273828e1c2895da80e0eba95cd4acb8006a78be06eb2b4693e52532ca570f

The launcher uses the existing explicit-key, strict-known-host SSH options and a new exclusive local receipt directory. Local wall limit 25 seconds. The two concurrent read-only probe rounds use a three-second native command cap and 1.5-second HTTP cap. SSH output is bounded at 12 MiB to retain the two 4 MiB gateway and two 256 KiB launcher slots at maximum base64 size. The remote process verifies the pinned Node hash, account and architecture.

The probe checks the recorded PID birth and argv, IPv4 GET /healthz and native LISTEN on ports 62277 and 62278, plus lstat of the two exact leases and reclaim names at the known fixture path. It verifies the retained replacement bundle, receipt, required files and hashes before reading bounded private logs. Raw slots are preserved individually under receipt/ with the structured readback and original SSH streams. The report lists logged shutdown requests and responses and identifies prefixes from the earlier bounded diagnostic captures.

An access record for POST /system/shutdown with status 202 establishes a server-side record. It does not by itself prove the acceptance client received it. Correlate the request ID and later process/port/lease observations. If the original owner and its both leases changed or disappeared, preserve exact observations and avoid inferring a control outcome from absence alone. This preparation contains no product or acceptance harness change.
