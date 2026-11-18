// Usage (cwd = QA tree root): node <this> <out.json>
// Maps the corrected frozen manifest's implementation-root paths onto the QA tree and hashes them (read-only).
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const manifestPath =
  "C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ports-407-correction-01/corrected-frozen-sources.json";
const expectedManifestSha = "76c8737224be5c67ad792e556bb83bdfffb7cbf622cd20b770c7c0aafbf8c862";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifestBytes = fs.readFileSync(manifestPath);
const manifestSha = sha(manifestBytes);
const manifest = JSON.parse(manifestBytes.toString("utf8").replace(/^\uFEFF/, ""));
const marker = "gg-20261117-ports-407\\GraphGoblin\\";
const rows = manifest.map((e) => {
  const i = e.Path.indexOf(marker);
  if (i < 0) throw new Error(`unmapped ${e.Path}`);
  const rel = e.Path.slice(i + marker.length).split("\\").join("/");
  let actual = null;
  try {
    actual = sha(fs.readFileSync(rel)).toUpperCase();
  } catch {}
  return { path: rel, frozen: e.Hash, actual, match: actual === e.Hash };
});
const result = {
  at: new Date().toISOString(),
  cwd: process.cwd(),
  head: execSync("git rev-parse HEAD").toString().trim(),
  manifestPath,
  manifestSha,
  manifestShaMatchesRecorded: manifestSha === expectedManifestSha,
  entries: rows.length,
  mismatches: rows.filter((r) => !r.match).map((r) => r.path),
  rows,
};
fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
for (const r of rows) console.log(`${r.match ? "MATCH" : "DIFF "} ${r.path}${r.actual ? "" : " (absent)"}`);
console.log(`manifestSha ${manifestSha} recorded-match=${result.manifestShaMatchesRecorded} mismatches=${result.mismatches.length}`);
process.exit(result.mismatches.length === 0 && result.manifestShaMatchesRecorded && rows.length === 14 ? 0 : 1);
