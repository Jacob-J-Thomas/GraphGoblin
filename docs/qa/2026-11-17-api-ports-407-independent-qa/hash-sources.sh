#!/usr/bin/env bash
# Usage: hash-sources.sh <out.json>  (run from QA tree root). Hashes QA-tree files at the frozen manifest's relative paths.
out="$1"
frozen="C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ports-407/final-sources.json"
node -e '
const fs=require("fs"),crypto=require("crypto");
const frozen=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const marker="gg-20261117-ports-407"+String.fromCharCode(92)+"GraphGoblin"+String.fromCharCode(92);
const rows=frozen.map(e=>{const i=e.Path.indexOf(marker); if(i<0) throw new Error("unmapped "+e.Path);
 const rel=e.Path.slice(i+marker.length).split(String.fromCharCode(92)).join("/");
 let actual=null; try{actual=crypto.createHash("sha256").update(fs.readFileSync(rel)).digest("hex").toUpperCase()}catch{}
 return {path:rel,frozen:e.Hash,actual,match:actual===e.Hash}});
const res={at:new Date().toISOString(),cwd:process.cwd(),head:require("child_process").execSync("git rev-parse HEAD").toString().trim(),rows};
fs.writeFileSync(process.argv[2],JSON.stringify(res,null,2));
for(const r of rows) console.log((r.match?"MATCH ":"DIFF  ")+r.path+(r.actual?"":" (absent)"));
' "$frozen" "$out"
