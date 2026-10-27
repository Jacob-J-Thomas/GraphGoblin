import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { CodexHarness } = await import(
  pathToFileURL(
    resolve(process.argv[3] ?? "packages/adapter-codex/dist/index.js"),
  )
);
const count = Number(process.argv[2] ?? 200000);
const heap = () => {
  global.gc();
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
};
console.log(JSON.stringify({ phase: "before", events: 0, heapMiB: heap() }));
const thread = {
  runStreamed: async () => ({
    events: (async function* () {
      yield { type: "thread.started", thread_id: "memory-probe" };
      yield { type: "turn.started" };
      for (let i = 1; i <= count; i++) {
        yield {
          type: "item.updated",
          item: { id: "progress", type: "reasoning", text: String(i) },
        };
        if (i % 50000 === 0) {
          await new Promise(setImmediate);
          console.log(
            JSON.stringify({ phase: "active", events: i, heapMiB: heap() }),
          );
        }
      }
      yield {
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
      };
    })(),
  }),
};
const session = new CodexHarness({
  clientFactory: () => ({
    startThread: () => thread,
    resumeThread: () => thread,
  }),
}).start(
  {
    workingDirectory: process.cwd(),
    options: { sandbox: "read-only", approval: "never" },
    turn: { prompt: "Controlled progress stream, no provider call" },
  },
  new AbortController().signal,
);
const drain = (async () => {
  for await (const event of session.events) {
    void event;
  }
})();
await session.result;
await drain;
console.log(
  JSON.stringify({ phase: "completed", events: count, heapMiB: heap() }),
);
await session.cancel();
await new Promise(setImmediate);
console.log(
  JSON.stringify({
    phase: "cancel-after-completion",
    events: count,
    heapMiB: heap(),
  }),
);
