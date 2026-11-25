const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = 'G:/ggq/gg-mac-d237-qa/GraphGoblin';
const req = createRequire(path.join(root, 'apps/api/package.json'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const packages = ['vitest', 'typescript', 'zod'].map((name) => {
  const entry = req.resolve(name);
  let directory = path.dirname(fs.realpathSync(entry));
  while (!fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory);
  const manifest = path.join(directory, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return { name, version: pkg.version, entry: fs.realpathSync(entry), entrySha256: sha(entry), manifest, manifestSha256: sha(manifest) };
});
const files = ['pnpm-lock.yaml', 'apps/api/src/data-dir-lock.ts', 'apps/api/src/data-dir-lock-failures.test.ts', 'apps/api/dist/data-dir-lock.js', 'apps/api/dist/data-dir-lock.js.map'].map((relative) => ({ path: relative, sha256: sha(path.join(root, relative)) }));
const report = { utc: new Date().toISOString(), root, node: { path: process.execPath, version: process.version, platform: process.platform, arch: process.arch, sha256: sha(process.execPath) }, packages, files, limitation: 'Selected runtime/package/build-output identity only, not complete installation or native macOS identity.' };
fs.writeFileSync(path.join(__dirname, 'RUNTIME-IDENTITY.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
