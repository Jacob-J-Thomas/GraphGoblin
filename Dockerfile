# GraphGoblin container image: the API with the web app under /app/ and the Codex CLI.
#
# Single user on a trusted network: see docs/11-security-and-distribution.md and
# docs/guide/01-install-and-first-run.md. Codex credentials are never baked in; mount the host's
# Codex login (~/.codex -> /home/node/.codex) or set OPENAI_API_KEY at run time.
#
#   docker build -t graphgoblin .
#   docker compose up -d

ARG NODE_IMAGE=node:22-bookworm-slim

# --- build -------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
# The pnpm major pinned by package.json "packageManager".
RUN npm install --global pnpm@12.8.1 && pnpm --version
WORKDIR /src
# Only what the build reads; .dockerignore also drops build output, local data, and secrets
# inside these paths (checked by tooling/scripts/dockerignore.test.mjs).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json tsconfig.json ./
COPY tooling ./tooling
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
# Only the API, its workspace dependencies, and the web app.
RUN pnpm exec turbo run build --filter=@graphgoblin/api... --filter=@graphgoblin/web
# A self-contained API with production dependencies only (workspace packages copied in).
RUN pnpm --filter @graphgoblin/api deploy --prod --legacy /out/apps/api \
  && mkdir -p /out/apps/web \
  && cp -r apps/web/dist /out/apps/web/dist

# --- runtime -----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    GG_HOST=0.0.0.0 \
    GG_PORT=4747 \
    GG_DATA_DIR=/data \
    GG_WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build --chown=root:root /out/ /app/
# `codex` on PATH, from the platform binary that @openai/codex-sdk pulled in, so `codex login`,
# `codex login status`, and the preflight work inside the container.
RUN codex_js="$(find /app/apps/api/node_modules -path '*/@openai/codex/bin/codex.js' | head -n 1)" \
  && test -n "$codex_js" \
  && printf '#!/bin/sh\nexec node %s "$@"\n' "$codex_js" > /usr/local/bin/codex \
  && chmod 755 /usr/local/bin/codex \
  && codex --version \
  && mkdir -p /data /home/node/.codex \
  && chown node:node /data /home/node/.codex
USER node
VOLUME /data
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GG_PORT||4747)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
