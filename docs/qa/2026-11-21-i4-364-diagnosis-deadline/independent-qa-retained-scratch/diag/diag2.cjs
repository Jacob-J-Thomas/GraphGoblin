// Read-only diagnosis 2 for the C4 fidelity gate (scratch only): which emit reproduces dist bytes.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PKG = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin\\packages\\infrastructure';
const ts = createRequire(path.join(PKG, 'package.json'))('typescript');
const configPath = path.join(PKG, 'tsconfig.build.json');
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
const p = ts.parseJsonConfigFileContent(cfg.config, ts.sys, PKG, undefined, configPath);
const file = path.join(PKG, 'src', 'claude', 'process.ts');
const src = fs.readFileSync(file, 'utf8');
const built = fs.readFileSync(path.join(PKG, 'dist', 'claude', 'process.js'));
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
// (b) transpileModule with module ESNext.
const b = ts.transpileModule(src, { compilerOptions: { ...p.options, module: ts.ModuleKind.ESNext }, fileName: file });
console.log('ESNext transpile equals built:', Buffer.from(b.outputText).equals(built), sha(b.outputText));
// (c) real program over the build config, emitting only process.ts to memory.
const host = ts.createCompilerHost(p.options);
const outputs = {};
const program = ts.createProgram({ rootNames: p.fileNames, options: p.options, host, projectReferences: p.projectReferences });
const sf = program.getSourceFile(file);
console.log('impliedNodeFormat ESM:', sf.impliedNodeFormat === ts.ModuleKind.ESNext);
program.emit(sf, (name, text) => (outputs[name] = text));
const js = Object.entries(outputs).find(([n]) => n.endsWith('/claude/process.js'));
console.log('program emit names:', Object.keys(outputs).map((n) => path.basename(n)));
console.log('program emit equals built:', js && Buffer.from(js[1]).equals(built));
