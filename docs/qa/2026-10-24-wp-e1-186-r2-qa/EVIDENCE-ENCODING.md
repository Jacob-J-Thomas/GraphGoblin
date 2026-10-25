# Evidence text encoding

PowerShell command redirection initially emitted UTF-16LE. The first evidence-preparation pass mistakenly read those logs as UTF-8. The affected logs are listed in [encoding-normalization.json](encoding-normalization.json). Their ASCII command output, counts, errors and paths have been restored by removing the introduced NULs; some decorative non-ASCII reporter glyphs may be lost. These normalized logs are readable evidence, not claimed byte-exact original process captures.

Node-produced JSON results, scripts and screenshots did not pass through that UTF-16 conversion. JSON payloads/assertions retain their values, with local user path prefixes redacted to %USERPROFILE%. The requested source diff was regenerated directly from Git as bytes. Digests in NOT-KEPT.md apply to the original omitted raw captures, which were not modified. The final artifact manifest hashes the actual retained files after normalization and Markdown formatting.
