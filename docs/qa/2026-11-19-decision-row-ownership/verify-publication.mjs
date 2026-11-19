import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Evidence integrity only. This does not start the application or replay tests.
const root = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(absolute, base)
      : [path.relative(base, absolute).replaceAll('\\', '/')];
  });
const checks = [];
for (const name of [
  'prior-findings/first-formal/publication-manifest.json',
  'prior-findings/publication-manifest.json',
  'independent/publication-manifest.json',
  'publication-manifest.json',
]) {
  const absolute = path.join(root, name);
  const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const base = path.dirname(absolute);
  for (const entry of manifest.files) {
    const target = path.resolve(base, entry.path);
    if (!target.startsWith(base + path.sep))
      throw new Error(`Out-of-scope manifest path: ${entry.path}`);
    const bytes = fs.readFileSync(target);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new Error(`Byte mismatch: ${name}: ${entry.path}`);
  }
  const actual = inventory(base).filter((p) => p !== path.basename(name));
  const expected = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected))
    throw new Error(`Unexpected or missing files: ${name}`);
  checks.push({
    manifest: name,
    entriesVerified: manifest.files.length,
    sha256: sha256(fs.readFileSync(absolute)),
  });
}

let localLinks = 0;
for (const name of inventory(root).filter((p) => p.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    const [relative, fragment] = href.split('#');
    const target = path.resolve(root, path.dirname(name), decodeURIComponent(relative));
    if (!fs.existsSync(target)) throw new Error(`Missing link: ${name}: ${href}`);
    if (fragment && fs.statSync(target).isFile()) {
      const contents = fs.readFileSync(target, 'utf8');
      const anchors = [...contents.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
        m[1]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .trim()
          .replace(/\s/g, '-'),
      );
      if (!anchors.includes(decodeURIComponent(fragment)))
        throw new Error(`Missing anchor: ${name}: ${href}`);
    }
    localLinks++;
  }
}
console.log(JSON.stringify({ result: 'pass', checks, localLinks }, null, 2));
