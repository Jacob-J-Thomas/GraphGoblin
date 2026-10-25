# Evidence not kept

The complete stdout of the first final MCP coverage attempt was inadvertently overwritten by the continuing original runner using the same filename. Original size and SHA-256 are unavailable. Its exit-code-1 record remains in final-results.jsonl; the observed result was 50 passed and one five-second timeout in apps/mcp/src/mcp.test.ts:393, the multi-control input/signal/pause/resume/cancel case. The current final-coverage-mcp.log.txt is the later 51-test pass, not that failure. This loss is disclosed rather than reconstructed as raw evidence.

An interrupted web worker and a lock-rejected contender shared the final web log filename. The retained lock error is also copied as coverage-web-collision.log.txt. Do not infer two separate lock errors from the clean runner metadata reason. The valid final package result is coverage-web-clean.log.txt.

No retained capture exceeds 1,000,000 bytes; the final artifact inventory records measured size and SHA-256. No oversized capture was discarded.
