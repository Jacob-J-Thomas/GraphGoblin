# Research - Licence ledger

Every dependency added to the repo gets a line here. CI enforces the allowlist in 11; this file is the human-readable record and the place to note anything unusual.

## Allowlist

MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0.

## Planned dependencies

| Dependency                                                                                                             | Licence    | Notes                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js                                                                                                                | MIT        | All packages and apps use Node >=22 at runtime                                                                                                   |
| zod                                                                                                                    | MIT        | `packages/contracts`, `packages/adapter-jev`, and `apps/api`, `apps/mcp`, `apps/plugin-codex`, `apps/web` runtime                                |
| ajv, ajv-formats, jsonata, liquidjs                                                                                    | MIT        | `packages/domain` runtime graph validation, expression evaluation, and templates                                                                 |
| @libsql/client, libsql                                                                                                 | MIT        | `packages/infrastructure` runtime SQLite; N-API binary, prebuilt for all Node versions; see `sqlite-libsql.md`                                   |
| croner                                                                                                                 | MIT        | `packages/infrastructure` runtime 10.x cron slots in `src/scheduler` (adopted in M6)                                                             |
| drizzle-orm                                                                                                            | Apache-2.0 | `packages/infrastructure` runtime database queries                                                                                               |
| @openai/codex-sdk                                                                                                      | Apache-2.0 | `packages/adapter-codex` runtime, pinned 0.160.0; spawns the Codex CLI                                                                           |
| @openai/codex (+ platform packages)                                                                                    | Apache-2.0 | Transitive runtime dependency of `@openai/codex-sdk` at 0.160.0; bundles the native CLI (~430 MB)                                                |
| @typesafe-ai/sdk                                                                                                       | MIT        | `packages/adapter-jev` runtime; pinned 0.6.0 with no runtime dependencies                                                                        |
| @fastify/swagger, fastify, fastify-type-provider-zod                                                                   | MIT        | `apps/api` runtime REST and OpenAPI validation                                                                                                   |
| @fastify/swagger-ui                                                                                                    | MIT        | `apps/api` runtime developer API docs at `/docs`                                                                                                 |
| @fastify/static                                                                                                        | MIT        | `apps/api` runtime serves the built web app under `/app/` when `GG_WEB_DIST` is set                                                              |
| pino                                                                                                                   | MIT        | `apps/api` runtime logging                                                                                                                       |
| openapi-fetch                                                                                                          | MIT        | `packages/api-client` runtime; one MIT helper dependency                                                                                         |
| @modelcontextprotocol/sdk                                                                                              | MIT        | `apps/mcp` runtime (1.31); transitive dependencies are MIT, ISC, or BSD                                                                          |
| @codemirror/lang-json, @codemirror/language, @codemirror/legacy-modes, @codemirror/state, @codemirror/view, codemirror | MIT        | `apps/web` runtime editors for templates, expressions, and JSON                                                                                  |
| @hookform/resolvers, react-hook-form                                                                                   | MIT        | `apps/web` runtime schema-driven forms with the Zod resolver                                                                                     |
| @tanstack/react-query, zustand                                                                                         | MIT        | `apps/web` runtime server state and editor, run-event, and PWA stores                                                                            |
| @xyflow/react                                                                                                          | MIT        | `apps/web` runtime canvas; paid Pro tier is examples and support only                                                                            |
| clsx                                                                                                                   | MIT        | `apps/web` runtime class names                                                                                                                   |
| idb-keyval                                                                                                             | Apache-2.0 | `apps/web` runtime IndexedDB mirror of unsaved drafts                                                                                            |
| react, react-dom                                                                                                       | MIT        | `apps/web` runtime UI                                                                                                                            |
| react-router                                                                                                           | MIT        | `apps/web` runtime client-side routing with basename `/app`                                                                                      |
| workbox-window                                                                                                         | MIT        | `apps/web` runtime service worker registration and prompt update flow                                                                            |
| pnpm, turbo                                                                                                            | MIT        | Repository package management and task orchestration; dev-only                                                                                   |
| typescript                                                                                                             | Apache-2.0 | Workspace packages and apps use it for builds and typechecking; dev-only                                                                         |
| @types/node                                                                                                            | MIT        | Node packages and apps use it for typechecking; dev-only                                                                                         |
| @types/react, @types/react-dom                                                                                         | MIT        | `apps/web` typechecking; dev-only                                                                                                                |
| tsx                                                                                                                    | MIT        | `apps/api` development server and `packages/api-client` type generation; dev-only                                                                |
| vite, @vitejs/plugin-react, vite-plugin-pwa, workbox-build                                                             | MIT        | `apps/web` build, PWA manifest, and generated service worker; dev-only                                                                           |
| tailwindcss, @tailwindcss/vite                                                                                         | MIT        | `apps/web` styling build; dev-only. Build-time transitive `lightningcss` is MPL-2.0 (already present through Vite); it never ships in the bundle |
| pino-pretty                                                                                                            | MIT        | `apps/api` development log formatting; dev-only                                                                                                  |
| vitest, @vitest/coverage-v8                                                                                            | MIT        | Workspace packages and apps use them for unit tests and coverage; dev-only                                                                       |
| @testing-library/dom, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event                   | MIT        | `apps/web` component tests; dev-only                                                                                                             |
| jsdom                                                                                                                  | MIT        | `apps/web` unit tests; dev-only                                                                                                                  |
| fake-indexeddb                                                                                                         | Apache-2.0 | `apps/web` IndexedDB tests in jsdom; dev-only                                                                                                    |
| @playwright/test                                                                                                       | Apache-2.0 | `apps/web` E2E tests (`test:e2e`); dev-only                                                                                                      |
| eslint, @eslint/js, eslint-config-prettier, typescript-eslint                                                          | MIT        | Repository lint config and workspace package/app linting; dev-only                                                                               |
| eslint-plugin-react-hooks                                                                                              | MIT        | Hooks lint rules in the repository; dev-only                                                                                                     |
| @eslint-react/eslint-plugin                                                                                            | MIT        | Repository JSX and DOM lint rules; dev-only; supports ESLint 10 where `eslint-plugin-react` does not                                             |
| dependency-cruiser                                                                                                     | MIT        | Repository dependency-layer checks; dev-only                                                                                                     |
| prettier                                                                                                               | MIT        | Repository formatting; dev-only                                                                                                                  |
| drizzle-kit                                                                                                            | Apache-2.0 | `packages/infrastructure` migration generation; dev-only                                                                                         |
| openapi-typescript                                                                                                     | MIT        | `packages/api-client` type generation; dev-only and pulls `@redocly/openapi-core` (MIT)                                                          |
| Geist, Geist Mono (fonts)                                                                                              | OFL-1.1    | Font files, not npm: `geist` 1.7.2 woff2 with `OFL.txt` in `apps/web/public/fonts/` (#7) and the design sample; npm allowlist unchanged          |
| Space Grotesk 2.000 (font)                                                                                             | OFL-1.1    | Font file, not npm: subset woff2 with `OFL-SpaceGrotesk.txt` in `apps/web/public/fonts/` (#40); see Font files below                             |
| Chakra Petch 1.000 (font)                                                                                              | OFL-1.1    | Font files, not npm: SemiBold and Bold, subset woff2 with `OFL-ChakraPetch.txt` (#40); see Font files below                                      |
| Atkinson Hyperlegible Next 2.001 (font)                                                                                | OFL-1.1    | Font file, not npm: subset woff2 with `OFL-AtkinsonHyperlegibleNext.txt` (#40); see Font files below                                             |
| OpenDyslexic 0.990 (font)                                                                                              | OFL-1.1    | Font files, not npm: upstream Regular and Bold woff2, unmodified (Reserved Font Name), with `OFL-OpenDyslexic.txt` (#40); see Font files below   |
| Inter 4.001 (font)                                                                                                     | OFL-1.1    | Font file, not npm: optical size fixed at 14, subset woff2 with `OFL-Inter.txt` (#40); see Font files below                                      |

## Font files

The faces Settings → Appearance → Font offers (#40) are vendored files in `apps/web/public/fonts/`, each with its licence text beside it; no npm package is added, so the npm allowlist is unchanged. Every one is SIL OFL 1.1, which allows bundling, modifying, and redistributing with the licence. A modified font may not use a Reserved Font Name (RFN), and the OFL FAQ (2.6) counts subsetting a web font as modification, so only faces without an RFN are subset.

| File                                               | Source (path at commit)                                                                                 | Change                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `SpaceGrotesk-Variable.woff2` (21 KiB)             | google/fonts `ofl/spacegrotesk/SpaceGrotesk[wght].ttf` at `2861cb7b`                                    | Subset                                     |
| `ChakraPetch-SemiBold.woff2` (9 KiB)               | google/fonts `ofl/chakrapetch/ChakraPetch-SemiBold.ttf` at `c011968d`                                   | Subset                                     |
| `ChakraPetch-Bold.woff2` (9 KiB)                   | google/fonts `ofl/chakrapetch/ChakraPetch-Bold.ttf` at `c011968d`                                       | Subset                                     |
| `AtkinsonHyperlegibleNext-Variable.woff2` (33 KiB) | google/fonts `ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf` at `66eef707`            | Subset                                     |
| `Inter-Variable.woff2` (46 KiB)                    | google/fonts `ofl/inter/Inter[opsz,wght].ttf` at `e1d64801`                                             | Optical size axis fixed at 14, then subset |
| `OpenDyslexic-Regular.woff2` (101 KiB)             | antijingoist/opendyslexic `compiled/OpenDyslexic-Regular.woff2` at `77bda89f` (also forge.hackers.town) | None (RFN "OpenDyslexic")                  |
| `OpenDyslexic-Bold.woff2` (106 KiB)                | antijingoist/opendyslexic `compiled/OpenDyslexic-Bold.woff2` at `77bda89f`                              | None (RFN "OpenDyslexic")                  |

The subset keeps Google Fonts' Latin range plus the arrows the app shows, fontTools' default OpenType features plus tabular figures, and every name record (copyright, licence, and URLs), with fontTools 4.66.1 (`pip install fonttools==4.66.1 brotli`). The instancer stamps the font's modified time, so `SOURCE_DATE_EPOCH` pins it to the Inter source commit's time; with it, both commands rebuild the shipped files byte for byte:

```sh
SOURCE_DATE_EPOCH=1717679533 fonttools varLib.instancer 'Inter[opsz,wght].ttf' opsz=14 -o Inter-opsz14.ttf   # Inter only, first
pyftsubset <source>.ttf --flavor=woff2 --layout-features+=tnum --name-IDs='*' --name-legacy --notdef-outline \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD'
```

SHA-256 of every shipped font file, and of the upstream file it is or was built from (fetched from the pinned commit, or from the `geist` 1.7.2 npm tarball, on 2026-10-05). The unmodified files equal their upstream byte for byte; the subset files are what the commands above produce from the upstream source:

| File                                      | SHA-256 of the shipped file                                        | Upstream file and its SHA-256                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `Geist-Variable.woff2`                    | `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8` | `geist` 1.7.2 `dist/fonts/geist-sans/Geist-Variable.woff2`: identical                                                  |
| `GeistMono-Variable.woff2`                | `fba8f577f38a2bbcbe818efa6348dd58f36303a10b8737c42fefad275be563ab` | `geist` 1.7.2 `dist/fonts/geist-mono/GeistMono-Variable.woff2`: identical                                              |
| `OpenDyslexic-Regular.woff2`              | `0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695` | `compiled/OpenDyslexic-Regular.woff2` at `77bda89f`: identical                                                         |
| `OpenDyslexic-Bold.woff2`                 | `b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf` | `compiled/OpenDyslexic-Bold.woff2` at `77bda89f`: identical                                                            |
| `SpaceGrotesk-Variable.woff2`             | `cacae3b69e6a42ec1abe64aa56e06a42eafc79595334721fa2079fedb5a64a36` | `SpaceGrotesk[wght].ttf` at `2861cb7b`: `acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72`             |
| `ChakraPetch-SemiBold.woff2`              | `f9aef47a359e6f2049762506e1593eb059a6998cb6d296c626217a245b3836f3` | `ChakraPetch-SemiBold.ttf` at `c011968d`: `45264de3204ddbd5fb3e14a2402acd5c630d16650ae5fc221d2c52da46a6734b`           |
| `ChakraPetch-Bold.woff2`                  | `29ffeb8cbb760c5e224a5352e3689a4285d38db517afd952d0ba7f27794a8b13` | `ChakraPetch-Bold.ttf` at `c011968d`: `65fbf76d95651697275e19db4d717c0e95a789ddd3476478b05292104db278a0`               |
| `AtkinsonHyperlegibleNext-Variable.woff2` | `229f28e5533a79ee06dc7a403909671bc14405bd0db2210b2dbf84dab16e9a0f` | `AtkinsonHyperlegibleNext[wght].ttf` at `66eef707`: `5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745` |
| `Inter-Variable.woff2`                    | `e998470b12b64b2cc1d8ca31ae60ee8dd76c503a2ba194a72d3321d46f049a87` | `Inter[opsz,wght].ttf` at `e1d64801`: `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031`               |

Full commits: google/fonts `2861cb7b12f90c0a294a12ed666e381e2211872f`, `c011968d86a629939a4fd8b62a3b18549db0d855`, `66eef70728ca29f28c31cdc5e7947f2c2de73e8d`, `e1d6480102fed30739fead0faee463101f892c8f`; antijingoist/opendyslexic `77bda89f3f2069c78d81d33de43b461c2de6c48e`. `OFL-OpenDyslexic.txt` is that commit's `OFL.txt`, byte for byte.

## Recorded alternatives and their licences

| Option                                               | Licence                    | Why noted                                                                               |
| ---------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| LangGraph.js, @langchain/langgraph-checkpoint-sqlite | MIT                        | Executor alternative; LangGraph Platform, Studio, and the CLI dev server are commercial |
| PGlite                                               | Apache-2.0                 | Database alternative                                                                    |
| DBOS Transact                                        | MIT                        | Durable execution alternative                                                           |
| Temporal TypeScript SDK                              | MIT                        | Durable execution alternative; server is also MIT                                       |
| Hatchet                                              | MIT                        | Task queue alternative                                                                  |
| @anthropic-ai/claude-agent-sdk, Claude Code          | Anthropic Commercial Terms | Post-1.0 harness; optional, user-installed, never vendored                              |
| @anthropic-ai/sdk                                    | MIT                        | Would be used by a direct Claude API decider post-1.0                                   |
| NestJS, Hono                                         | MIT                        | HTTP framework alternatives                                                             |
| SvelteKit, Svelte Flow                               | MIT                        | Frontend alternative                                                                    |
| Monaco editor                                        | MIT                        | Rejected for bundle size, not licence                                                   |
| Michroma, Orbitron (fonts)                           | OFL-1.1                    | #40 display candidates, rejected on width and legibility; Orbitron has an RFN           |
| IBM Plex Sans (font)                                 | OFL-1.1                    | #40 neutral candidate; its RFN "Plex" rules out a subset under the name, so Inter       |

## Rejected for licence reasons

| Project        | Licence                 | Note                                                  |
| -------------- | ----------------------- | ----------------------------------------------------- |
| n8n            | Sustainable Use License | Do not copy code or patterns verbatim                 |
| Restate server | BSL                     | Verify if ever reconsidered                           |
| Inngest server | Historically non-OSI    | SDKs are Apache-2.0; verify the server before any use |
| vm2            | MIT but unmaintained    | Rejected for security, not licence                    |
