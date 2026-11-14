import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const sourceManifest = readJson("source-evidence-manifest.json");
const publicationManifest = readJson("publication-manifest.json");
const failures = [];
const checkFile = (relative, bytesExpected, hashExpected, label) => {
  const file = path.resolve(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    failures.push(label + ": missing file " + relative);
    return;
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length !== bytesExpected) failures.push(label + ": size mismatch " + relative);
  if (hash(bytes) !== hashExpected) failures.push(label + ": SHA-256 mismatch " + relative);
};
for (const item of sourceManifest.files) checkFile(item.path, item.bytes, item.sha256, "source copy");
for (const item of publicationManifest.files) checkFile(item.path, item.bytes, item.sha256, "publication");

const markdownFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && absolute.toLowerCase().endsWith(".md")) markdownFiles.push(absolute);
  }
}
walk(root);
let checkedLinks = 0;
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf8");
  const linkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    let destination = match[1].trim();
    if (destination.startsWith("<") && destination.endsWith(">")) destination = destination.slice(1, -1);
    destination = destination.split(/\s+/)[0];
    if (!destination || /^(?:[a-z]+:|\/\/)/i.test(destination) || destination.startsWith("#")) continue;
    const pathname = decodeURIComponent(destination.split("#")[0]);
    if (!pathname) continue;
    checkedLinks += 1;
    const resolved = path.resolve(path.dirname(file), pathname);
    if (!fs.existsSync(resolved)) failures.push("Markdown link missing in " + path.relative(root, file) + ": " + destination);
  }
}
if (fs.readFileSync(path.join(root, ".gitattributes"), "utf8") !== "* -text\r\n") {
  failures.push(".gitattributes does not match the scoped byte-preservation rule");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    sourceFilesVerified: sourceManifest.files.length,
    sourceBytesVerified: sourceManifest.totalBytes,
    publicationFilesVerified: publicationManifest.files.length,
    publicationBytesVerified: publicationManifest.totalBytes,
    publicationMarkdown: markdownFiles.map((file) => path.relative(root, file).replaceAll(path.sep, "/")),
    localRelativeLinksVerified: checkedLinks,
    result: "ok"
  }, null, 2));
}