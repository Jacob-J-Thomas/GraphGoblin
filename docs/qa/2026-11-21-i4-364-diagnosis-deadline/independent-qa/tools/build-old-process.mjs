// C4 preparation (scratch only): transpile the exact parent process.ts with the checkout's
// TypeScript and infrastructure build options. Fidelity gate: the same transpile of the candidate
// process.ts must equal the built dist/claude/process.js bytes. Nothing in the checkout is written.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin';
const PKG = join(REPO, 'packages', 'infrastructure');
const EVIDENCE = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-independent-01';
const OUT_DIR = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01\\work\\old-build\\claude';
const SRC_DIR = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01\\work\\old-src';
const PATH_IN_REPO = 'packages/infrastructure/src/claude/process.ts';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

const ts = createRequire(join(PKG, 'package.json'))('typescript');
const configPath = join(PKG, 'tsconfig.build.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PKG, undefined, configPath);
const transpile = (source) =>
  ts.transpileModule(source, { compilerOptions: parsed.options, fileName: 'process.ts', reportDiagnostics: true });

const oldSource = git('show', `580aded6d295061897b047ac16811e5da230d9e0:${PATH_IN_REPO}`);
const oldBlob = git('rev-parse', `580aded6d295061897b047ac16811e5da230d9e0:${PATH_IN_REPO}`).toString().trim();
const candidateSource = readFileSync(join(REPO, ...PATH_IN_REPO.split('/')));
const candidateBlob = git('rev-parse', `HEAD:${PATH_IN_REPO}`).toString().trim();
const built = readFileSync(join(PKG, 'dist', 'claude', 'process.js'));
const candidateOut = transpile(candidateSource.toString('utf8'));
const oldOut = transpile(oldSource.toString('utf8'));
const fidelity = Buffer.from(candidateOut.outputText, 'utf8').equals(built);
const result = {
  utc: new Date().toISOString(),
  typescript: ts.version,
  options: { target: parsed.options.target, module: parsed.options.module, sourceMap: parsed.options.sourceMap, verbatimModuleSyntax: parsed.options.verbatimModuleSyntax },
  oldSource: { commit: '580aded6d295061897b047ac16811e5da230d9e0', blob: oldBlob, bytes: oldSource.length, sha256: sha(oldSource) },
  candidateSource: { blob: candidateBlob, bytes: candidateSource.length, sha256: sha(candidateSource) },
  candidateBuilt: { bytes: built.length, sha256: sha(built) },
  candidateTranspiled: { bytes: Buffer.byteLength(candidateOut.outputText), sha256: sha(candidateOut.outputText), diagnostics: candidateOut.diagnostics?.length ?? 0 },
  fidelityTranspileEqualsBuilt: fidelity,
  oldTranspiled: { bytes: Buffer.byteLength(oldOut.outputText), sha256: sha(oldOut.outputText), diagnostics: oldOut.diagnostics?.length ?? 0 },
};
if (fidelity) {
  if (existsSync(OUT_DIR)) throw new Error('old build output already exists');
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SRC_DIR, { recursive: true });
  writeFileSync(join(SRC_DIR, 'process.ts'), oldSource);
  writeFileSync(join(OUT_DIR, 'process.js'), oldOut.outputText);
  result.oldBuildPath = join(OUT_DIR, 'process.js');
  result.oldSourceCopyPath = join(SRC_DIR, 'process.ts');
}
writeFileSync(join(EVIDENCE, 'observations', 'c4-old-build.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ fidelity, oldBlob, oldSha: result.oldSource.sha256, oldOut: result.oldTranspiled.sha256 }));
process.exitCode = fidelity ? 0 : 1;
