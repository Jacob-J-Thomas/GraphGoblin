// Read-only diagnosis of the C4 fidelity-gate failure (scratch only).
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const PKG = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin\\packages\\infrastructure';
const ts = createRequire(path.join(PKG, 'package.json'))('typescript');
const cfg = ts.readConfigFile(path.join(PKG, 'tsconfig.build.json'), ts.sys.readFile);
const p = ts.parseJsonConfigFileContent(cfg.config, ts.sys, PKG, undefined, path.join(PKG, 'tsconfig.build.json'));
const src = fs.readFileSync(path.join(PKG, 'src', 'claude', 'process.ts'), 'utf8');
const o = ts.transpileModule(src, { compilerOptions: p.options, fileName: 'process.ts', reportDiagnostics: true });
fs.writeFileSync(path.join(__dirname, 'candidate-transpiled.js'), o.outputText);
console.log(o.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')));
console.log('crlf in src', src.includes('\r\n'), 'crlf in out', o.outputText.includes('\r\n'));
