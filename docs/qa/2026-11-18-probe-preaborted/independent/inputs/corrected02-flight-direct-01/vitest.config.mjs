export default {
  "root": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/inputs/corrected02-flight-direct",
  "cacheDir": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/cache/corrected02-flight-direct",
  "server": {
    "fs": {
      "allow": [
        "D:\\GraphGoblin-QA\\2026-11-18\\pr505-preaborted-independent-qa",
        "C:\\Users\\98jak\\.codex\\worktrees\\gg-20261117-probe-466\\GraphGoblin"
      ]
    }
  },
  "resolve": {
    "conditions": [
      "development"
    ],
    "alias": [
      {
        "find": "vitest",
        "replacement": "C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin/packages/adapter-codex/node_modules/vitest/dist/index.js"
      },
      {
        "find": "@graphgoblin/infrastructure/sqlite/testing",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/sqlite/testing/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/scheduler",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/scheduler/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/process",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/process/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/sqlite",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/sqlite/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/claude",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/claude/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/ollama",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/ollama/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/http",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/http/index.ts"
      },
      {
        "find": "@graphgoblin/contracts/testing",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/contracts/src/testing/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure/fs",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/fs/index.ts"
      },
      {
        "find": "@graphgoblin/engine/testing",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/engine/src/testing/index.ts"
      },
      {
        "find": "@graphgoblin/infrastructure",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/infrastructure/src/index.ts"
      },
      {
        "find": "@graphgoblin/adapter-codex",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-codex/src/index.ts"
      },
      {
        "find": "@graphgoblin/adapter-jev",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-jev/src/index.ts"
      },
      {
        "find": "@graphgoblin/api-client",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/api-client/src/index.ts"
      },
      {
        "find": "@graphgoblin/contracts",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/contracts/src/index.ts"
      },
      {
        "find": "@graphgoblin/domain",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/domain/src/index.ts"
      },
      {
        "find": "@graphgoblin/engine",
        "replacement": "D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/engine/src/index.ts"
      }
    ]
  },
  "test": {
    "include": [
      "*.test.ts"
    ],
    "environment": "node",
    "clearMocks": true,
    "restoreMocks": true,
    "pool": "forks",
    "execArgv": [
      "--expose-gc"
    ]
  }
};
