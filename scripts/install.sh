#!/usr/bin/env bash
# Install GraphGoblin from this checkout: check prerequisites, install, build, create the data
# directory, and run the first-run preflight.
#
# Safe to run again: every step is idempotent. Needs no root. Exits non-zero when a prerequisite
# is missing, a step fails, or a preflight check fails.
#
#   bash scripts/install.sh
#
# Environment: GG_DATA_DIR (default ~/.graphgoblin), GG_HOST, GG_PORT, and every other GG_*
# variable the server reads (docs/guide/01-install-and-first-run.md).
set -euo pipefail

MIN_NODE_MAJOR=22
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '==> %s\n' "$1"; }
warn() { printf '    warning: %s\n' "$1" >&2; }
fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

step 'Checking Node.js'
command -v node >/dev/null 2>&1 || fail "Node.js ${MIN_NODE_MAJOR} or newer is required: https://nodejs.org/"
node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if [ "${node_major}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node.js ${node_version} is too old; install ${MIN_NODE_MAJOR} or newer."
fi
printf '    Node.js %s\n' "${node_version}"

step 'Checking pnpm'
command -v pnpm >/dev/null 2>&1 ||
  fail "pnpm is required. Enable it with 'corepack enable' (ships with Node.js), or see https://pnpm.io/installation"
printf '    pnpm %s\n' "$(pnpm --version)"

step 'Checking the Codex CLI login'
if command -v codex >/dev/null 2>&1; then
  if status="$(codex login status 2>&1)"; then
    printf '    %s\n' "${status}"
  else
    warn "${status}"
    warn "Run 'codex login' as this user before starting runs."
  fi
else
  warn "no 'codex' on PATH. Install the Codex CLI and run 'codex login' as this user;"
  warn 'the API runs turns through the CLI bundled with the SDK, which uses that login.'
fi

cd "${ROOT}"

step 'Installing dependencies (pnpm install --frozen-lockfile)'
pnpm install --frozen-lockfile || fail 'pnpm install failed.'

step 'Building (pnpm build)'
pnpm build || fail 'pnpm build failed.'

default_data_dir="${HOME}/.graphgoblin"
data_dir="${GG_DATA_DIR:-${default_data_dir}}"
step "Creating the data directory ${data_dir}"
mkdir -p "${data_dir}"
data_dir="$(cd "${data_dir}" && pwd)"

step 'Running the first-run preflight'
preflight=0
GG_DATA_DIR="${data_dir}" node apps/api/dist/main.js --preflight || preflight=$?

host="${GG_HOST:-127.0.0.1}"
port="${GG_PORT:-4747}"
prefix=''
if [ -n "${GG_DATA_DIR:-}" ]; then
  prefix="GG_DATA_DIR='${data_dir}' "
fi

cat <<EOF

Start GraphGoblin from the repository root with either of:
    ${prefix}pnpm start
    ${prefix}node apps/api/dist/main.js
Then open http://${host}:${port}/app/

Requiring API keys (GG_REQUIRE_API_KEY=true)? Create the first key with:
    node apps/api/dist/main.js --create-api-key <name> [--scopes a,b]

EOF

if [ "${preflight}" -ne 0 ]; then
  fail 'a preflight check failed; fix it (see the table above) and run this script again.'
fi
printf 'Install complete.\n'
