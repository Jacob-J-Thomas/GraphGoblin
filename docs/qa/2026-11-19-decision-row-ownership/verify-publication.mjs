import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Evidence integrity only. This does not start the application or replay tests.
const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--original'))
  throw new Error('Usage: node verify-publication.mjs [--original]');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(absolute, base)
      : [path.relative(base, absolute).replaceAll('\\', '/')];
  });
const checks = [];
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'archive-provenance.json'), 'utf8'));
for (const entry of provenance.renames) {
  const bytes = fs.readFileSync(path.join(root, entry.publishedPath));
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
    throw new Error(`Archived original mismatch: ${entry.publishedPath}`);
  if (fs.existsSync(path.join(root, entry.originalPath)))
    throw new Error(`Duplicate original remains: ${entry.originalPath}`);
}
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
const originalChecks = [];
if (args.includes('--original')) {
  const { commit, packetPath } = provenance.originalSnapshot;
  const originalBytes = new Map();
  const readOriginal = (name) => {
    if (!originalBytes.has(name))
      originalBytes.set(
        name,
        execFileSync('git', ['cat-file', 'blob', `${commit}:${packetPath}/${name}`], {
          cwd: root,
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
    return originalBytes.get(name);
  };
  for (const seal of provenance.originalManifests) {
    const bytes = readOriginal(seal.path);
    if (sha256(bytes) !== seal.sha256 || bytes.length !== seal.bytes)
      throw new Error(`Original manifest mismatch: ${seal.path}`);
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.files.length !== seal.entries)
      throw new Error(`Original entry count mismatch: ${seal.path}`);
    const base = path.posix.dirname(seal.path);
    for (const entry of manifest.files) {
      const originalPath = path.posix.join(base, entry.path);
      const content = readOriginal(originalPath);
      if (content.length !== entry.bytes || sha256(content) !== entry.sha256)
        throw new Error(`Original byte mismatch: ${seal.path}: ${entry.path}`);
    }
    const prefix = `${packetPath}/${base === '.' ? '' : `${base}/`}`;
    const actual = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', '--full-tree', commit, '--', prefix],
      { cwd: root, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .map((name) => name.slice(prefix.length))
      .filter((name) => name !== path.posix.basename(seal.path))
      .sort();
    const expected = manifest.files.map((entry) => entry.path).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`Unexpected or missing original files: ${seal.path}`);
    originalChecks.push({
      manifest: seal.path,
      entriesVerified: manifest.files.length,
      sha256: sha256(bytes),
      commit,
    });
  }
}
console.log(
  JSON.stringify(
    {
      result: 'pass',
      checks,
      archivedOriginals: provenance.renames.length,
      localLinks,
      originalChecks,
    },
    null,
    2,
  ),
);
