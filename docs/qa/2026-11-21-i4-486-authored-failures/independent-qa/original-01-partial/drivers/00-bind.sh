#!/usr/bin/env bash
# Independent source and build binding for #486 QA. Read-only on the checkout except tsc emitting
# into a scratch outDir. Usage: bash 00-bind.sh <attempt-dir>
set -u
OUT="$1"; mkdir -p "$OUT"
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
S=/g/ggq/qa-scratch/i4-486-independent-01
export TEMP=$(cygpath -w $S/tmp) TMP=$(cygpath -w $S/tmp)
mkdir -p $S/tmp
REB=$S/rebuild-bind-$(date +%s); mkdir -p $REB
CO=/g/ggq/gg-i4-486-qa/GraphGoblin
cd $CO
{
  echo "node=$(node --version)"
  echo "head=$(git rev-parse HEAD)"
  echo "tree=$(git rev-parse 'HEAD^{tree}')"
  echo "porcelain_lines=$(git status --porcelain 2>/dev/null | wc -l)"
  echo "diff_files=$(git diff --name-only 02351e2fb932b3be44e7cc3fb3943a61d568226c HEAD | wc -l)"
} > "$OUT/identity.txt"
git diff --name-only 02351e2fb932b3be44e7cc3fb3943a61d568226c HEAD > "$OUT/diff-names.txt"
TSC=$(cygpath -w $CO/node_modules/typescript/bin/tsc)
for p in packages/contracts packages/domain packages/engine packages/infrastructure packages/adapter-codex packages/api-client apps/api apps/mcp; do
  n=$(basename $p)
  (cd $p && node "$TSC" -p tsconfig.build.json --outDir "$(cygpath -w $REB/$n)" --tsBuildInfoFile "$(cygpath -w $REB/$n.tsbuildinfo)"; echo "$n tsc_exit=$?") >> "$OUT/tsc.txt" 2>&1
done
python - "$OUT" "$REB" <<'EOF'
import os, sys, json, hashlib
out, reb = sys.argv[1], sys.argv[2]
co = 'G:/ggq/gg-i4-486-qa/GraphGoblin'
os.chdir(co)
freeze = json.load(open('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-source-freeze-01/receipt.json'))
src = []
for f in freeze['files']:
    b = open(f['path'], 'rb').read()
    src.append({'path': f['path'], 'sha256': hashlib.sha256(b).hexdigest(), 'bytes': len(b),
                'match': hashlib.sha256(b).hexdigest() == f['sha256'] and len(b) == f['bytes']})
names = set(open(os.path.join(out, 'diff-names.txt')).read().split())
m = {'contracts': 'packages/contracts', 'domain': 'packages/domain', 'engine': 'packages/engine',
     'infrastructure': 'packages/infrastructure', 'adapter-codex': 'packages/adapter-codex',
     'api-client': 'packages/api-client', 'api': 'apps/api', 'mcp': 'apps/mcp'}
cmp = {}
for p, d in m.items():
    base = os.path.join(reb, p); tot = 0; diff = []; missing = []
    for r, _, fs in os.walk(base):
        for fn in fs:
            if not (fn.endswith('.js') or fn.endswith('.d.ts')): continue
            a = os.path.join(r, fn); rel = os.path.relpath(a, base); b = os.path.join(d, 'dist', rel); tot += 1
            if not os.path.exists(b): missing.append(b); continue
            if open(a, 'rb').read() != open(b, 'rb').read(): diff.append(b)
    cmp[p] = {'compared': tot, 'different': diff, 'missing': missing}
dist = {}
for d in ['packages/contracts/dist', 'packages/domain/dist', 'packages/engine/dist', 'packages/infrastructure/dist',
          'packages/adapter-codex/dist', 'packages/api-client/dist', 'apps/api/dist', 'apps/mcp/dist', 'apps/web/dist']:
    for r, _, fs in os.walk(d):
        for fn in fs:
            pth = os.path.join(r, fn).replace('\\', '/')
            if fn.endswith('.tsbuildinfo'): continue
            dist[pth] = hashlib.sha256(open(pth, 'rb').read()).hexdigest()
agg = hashlib.sha256('\n'.join(f'{k} {v}' for k, v in sorted(dist.items())).encode()).hexdigest()
res = {'sourceFiles': len(src), 'sourceMatches': sum(1 for s in src if s['match']),
       'diffNamesEqualFreeze': names == set(f['path'] for f in freeze['files']),
       'rebuildComparison': cmp, 'distFiles': len(dist), 'distAggregateSha256': agg}
json.dump(res, open(os.path.join(out, 'binding.json'), 'w'), indent=1)
json.dump(src, open(os.path.join(out, 'source-hashes.json'), 'w'), indent=1)
json.dump(dist, open(os.path.join(out, 'dist-manifest.json'), 'w'), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in res.items() if k != 'rebuildComparison'}))
print({k: (v['compared'], len(v['different']), len(v['missing'])) for k, v in cmp.items()})
EOF
