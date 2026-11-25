// Static cross-check: every user-visible copy literal asserted by the presentation tests
// must exist verbatim in Presentation/PresentationCopy.swift. Usage: node copycheck.js <apps/macos-launcher>
const fs = require("fs");
const path = require("path");
const root = process.argv[2];

function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === '"') {
      let j = i + 1;
      let s = "";
      let depth = 0;
      while (j < src.length) {
        const c = src[j];
        if (c === "\\" && src[j + 1] === "(") { depth++; s += "\\("; j += 2; continue; }
        if (c === "\\") { s += c + src[j + 1]; j += 2; continue; }
        if (depth > 0 && c === ")") { depth--; s += c; j++; continue; }
        if (depth === 0 && c === '"') break;
        s += c;
        j++;
      }
      out.push(s);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const prodLits = literals(read("Presentation/PresentationCopy.swift"));
const prod = new Set(prodLits);
const BACKSLASH = String.fromCharCode(92);
const interpolation = new RegExp(BACKSLASH + BACKSLASH + "\\([^)]*\\)", "g");
const norm = (s) => s.replace(interpolation, "<P>");
const prodNorm = new Set(prodLits.map(norm));
console.log("production literals:", prodLits.length);

const tests = [
  "Tests/Presentation/OutcomeCopyTests.swift",
  "Tests/Presentation/AttemptLifecycleTests.swift",
  "Tests/Presentation/BrowserHandoffTests.swift",
  "Tests/Presentation/ShowLogTests.swift",
  "Tests/Presentation/AppKitControlTests.swift",
];
const labels = /^(Quit GraphGoblin|Hide|Quit|OK|Close|File|Copy Address|Show Log in Finder|Launch in progress)$/;
let plain = 0;
let interpolated = 0;
const missing = [];
for (const f of tests) {
  for (const s of literals(read(f))) {
    const hasInterp = s.includes(BACKSLASH + "(");
    const isCopy = /[’…]/.test(s) || labels.test(s) || (hasInterp && /GraphGoblin|browser|Port /.test(s));
    if (!isCopy) continue;
    // Rendered forms of the port-conflict template `Something is using \(subject), ...`.
    const subjectForms = ["port 4747", "port " + BACKSLASH + "(port)", "GraphGoblin’s port"];
    const asTemplate = (t) => {
      let out = t;
      for (const form of subjectForms) out = out.split(form).join("<P>");
      return norm(out);
    };
    // Fragments asserted with contains(): must occur inside some production literal.
    const isFragment = (t) => prodLits.some((p) => p.includes(t));
    if (hasInterp) {
      interpolated++;
      if (!prodNorm.has(norm(s)) && !prodNorm.has(asTemplate(s))) missing.push(`${f}: ${s}`);
    } else {
      plain++;
      if (!prod.has(s) && !prodNorm.has(asTemplate(s)) && !isFragment(s)) missing.push(`${f}: ${s}`);
    }
  }
}
console.log("plain copy literals checked:", plain, "| interpolated checked:", interpolated, "| missing:", missing.length);
for (const m of missing) console.log("  MISSING " + m);
process.exitCode = missing.length === 0 ? 0 : 1;
