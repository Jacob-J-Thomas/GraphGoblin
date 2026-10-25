# Changed ranges for #185

Every changed range in an existing file is listed, including the shared #186 SSE and #116 history surfaces. New task evidence is owned by this work package. No open-PR shutdown, trigger-admission, deadline or inspector-page implementation is changed.

| File                                                                                                                                      | New line ranges                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [apps/api/src/adversarial.test.ts](../../../apps/api/src/adversarial.test.ts)                                                             | 557-558                                                     |
| [apps/api/src/edges.test.ts](../../../apps/api/src/edges.test.ts)                                                                         | 340-343, 395, 399-402                                       |
| [apps/api/src/finalization.test.ts](../../../apps/api/src/finalization.test.ts)                                                           | new file, 1-110                                             |
| [apps/api/src/routes/runs.ts](../../../apps/api/src/routes/runs.ts)                                                                       | 228-234                                                     |
| [apps/api/src/sse-bounds.test.ts](../../../apps/api/src/sse-bounds.test.ts)                                                               | 32-36, 70-74, 103-107, 192-195, 203-205                     |
| [apps/api/src/sse-catchup.test.ts](../../../apps/api/src/sse-catchup.test.ts)                                                             | 57-61, 122-126, 180-183, 239-242, 282-285, 327-329          |
| [apps/api/src/sse-completion.test.ts](../../../apps/api/src/sse-completion.test.ts)                                                       | 109-110, 144, 180, 222, 254                                 |
| [apps/api/src/sse.ts](../../../apps/api/src/sse.ts)                                                                                       | 33-34, 63, 85, 93, 247-257, 375-378                         |
| [apps/mcp/src/describe.ts](../../../apps/mcp/src/describe.ts)                                                                             | 133                                                         |
| [apps/mcp/src/tools.ts](../../../apps/mcp/src/tools.ts)                                                                                   | 80-81, 185, 237-238                                         |
| [apps/mcp/src/units.test.ts](../../../apps/mcp/src/units.test.ts)                                                                         | 217-220                                                     |
| [apps/mcp/src/webhook-delivery.test.ts](../../../apps/mcp/src/webhook-delivery.test.ts)                                                   | 10-15, 61, 71-76, 107-109, 111-112, 115-147, 150, 169       |
| [apps/web/e2e/webhook-delivery.spec.ts](../../../apps/web/e2e/webhook-delivery.spec.ts)                                                   | 1, 6, 21, 62-64, 91-114, 116-145, 147-160, 162-186, 188-204 |
| [apps/web/src/api/queries.ts](../../../apps/web/src/api/queries.ts)                                                                       | 21-25, 138-141                                              |
| [apps/web/src/runs/follow-run-attempts.test.ts](../../../apps/web/src/runs/follow-run-attempts.test.ts)                                   | 28, 50-51, 188, 216-217, 219, 221                           |
| [apps/web/src/runs/follow-run-attempts.ts](../../../apps/web/src/runs/follow-run-attempts.ts)                                             | 64-66                                                       |
| [apps/web/src/runs/inspector/DeliveryPanel.tsx](../../../apps/web/src/runs/inspector/DeliveryPanel.tsx)                                   | 1, 6, 8-13, 15                                              |
| [apps/web/src/runs/useRunEvents.ts](../../../apps/web/src/runs/useRunEvents.ts)                                                           | 181-182                                                     |
| [CHANGELOG.md](../../../CHANGELOG.md)                                                                                                     | 7-8                                                         |
| [docs/05-execution-engine.md](../../../docs/05-execution-engine.md)                                                                       | 131-141                                                     |
| [docs/07-api-and-streaming.md](../../../docs/07-api-and-streaming.md)                                                                     | 196, 317-321, 340-350, 360-373, 425                         |
| [docs/09-frontend-and-pwa.md](../../../docs/09-frontend-and-pwa.md)                                                                       | 95-104, 267                                                 |
| [docs/decisions/ADR-0043-bounded-webhook-return-delivery.md](../../../docs/decisions/ADR-0043-bounded-webhook-return-delivery.md)         | 132-136                                                     |
| [docs/decisions/ADR-0050-bounded-sse-replay.md](../../../docs/decisions/ADR-0050-bounded-sse-replay.md)                                   | 40-42                                                       |
| [docs/decisions/ADR-0057-execution-and-delivery-finalization.md](../../../docs/decisions/ADR-0057-execution-and-delivery-finalization.md) | new file, 1-66                                              |
| [docs/guide/03-run-and-observe.md](../../../docs/guide/03-run-and-observe.md)                                                             | 224, 237                                                    |
| [docs/guide/05-mcp-and-codex-plugin.md](../../../docs/guide/05-mcp-and-codex-plugin.md)                                                   | 70                                                          |
| [packages/api-client/openapi.json](../../../packages/api-client/openapi.json)                                                             | 4978-4982, 13843-13847                                      |
| [packages/api-client/src/generated/schema.ts](../../../packages/api-client/src/generated/schema.ts)                                       | 3929-3930, 6012-6013                                        |
| [packages/api-client/src/sse.ts](../../../packages/api-client/src/sse.ts)                                                                 | 235-236                                                     |
| [packages/api-client/src/wait.test.ts](../../../packages/api-client/src/wait.test.ts)                                                     | 14-16, 478-534                                              |
| [packages/api-client/src/wait.ts](../../../packages/api-client/src/wait.ts)                                                               | 100-106, 127                                                |
| [packages/contracts/src/run.ts](../../../packages/contracts/src/run.ts)                                                                   | 211-215                                                     |
| [packages/engine/src/ports.ts](../../../packages/engine/src/ports.ts)                                                                     | 79                                                          |
| [packages/engine/src/testing/fakes.ts](../../../packages/engine/src/testing/fakes.ts)                                                     | 297-298, 303-304                                            |
| [packages/infrastructure/src/sqlite/delivery-runs.test.ts](../../../packages/infrastructure/src/sqlite/delivery-runs.test.ts)             | 368-379                                                     |
| [packages/infrastructure/src/sqlite/run-decoding.ts](../../../packages/infrastructure/src/sqlite/run-decoding.ts)                         | 33                                                          |
| [packages/infrastructure/src/sqlite/run-row.ts](../../../packages/infrastructure/src/sqlite/run-row.ts)                                   | 9, 35                                                       |
