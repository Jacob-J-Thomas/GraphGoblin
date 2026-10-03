# ADR-0001 - TypeScript monorepo for backend, frontend, and MCP server

Date: 2026-10-02. Status: Accepted.

## Context

The product's core artefact is a set of node schemas that the editor renders, the API validates, and the executor interprets. The harness for 1.0, Codex, ships a TypeScript SDK only. The MCP reference SDK is TypeScript. The owner's background is .NET and they value strict layer separation.

## Decision

One pnpm monorepo in TypeScript on Node 22 LTS. Layers are separate packages with declared dependencies, `exports` maps, TS project references, and dependency-cruiser rules enforced in CI. This reproduces the .NET class-library separation model.

## Consequences

- One schema language, Zod, serves validation, OpenAPI, editor forms, and types.
- Harness SDKs are consumed natively.
- The team must be disciplined about package boundaries; the tooling makes violations fail the build rather than relying on convention.

## Alternatives considered

- Python backend with a TypeScript frontend: strongest LangGraph ecosystem, but no Codex SDK and two schema languages.
- .NET backend: familiar to the owner, but no agent SDKs or LangGraph; would need a Node sidecar for harness nodes.
