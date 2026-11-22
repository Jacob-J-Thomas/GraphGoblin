// C4 preparation (scratch only), v3 = instrumentation correction 2.
// v1 (bare fileName) and v2 (absolute fileName) both used ts.transpileModule, which cannot read
// package.json, so NodeNext emitted CommonJS and the unchanged fidelity gate failed. v3 builds the
// real program from infrastructure/tsconfig.build.json (same options, real module-format detection)
// and emits only claude/process.ts to memory, substituting the exact parent source text for that one
// file. Gate (unchanged): the candidate emit must equal the built dist/claude/process.js bytes.
// Cross-check: an ESNext transpile of the parent source must equal its program emit.
// Nothing in the checkout is written; outputs go to the scratch folder only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const REPO = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin';
const PKG = join(REPO, 'packages', 'infrastructure');
const EVIDENCE = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-independent-01';
const OUT_DIR = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01\\work\\old-build\\claude';
const SRC_DIR = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01\\work\\old-src';
const PATH_IN_REPO = 'packages/infrastructure/src/claude/process.ts';
const FILE = join(PKG, 'src', 'claude', 'process.ts');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

const ts = createRequire(join(PKG, 'package.json'))('typescript');
const configPath = join(PKG, 'tsconfig.build.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PKG, undefined, configPath);

/** Emit claude/process.ts through the real build program, optionally with replacement text. */
function programEmit(replacement) {
  const host = ts.createCompilerHost(parsed.options);
  const original = host.getSourceFile;
  let substituted = false;
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
    if (replacement !== undefined && resolve(fileName).toLowerCase() === FILE.toLowerCase()) {
      substituted = true;
      return ts.createSourceFile(fileName, replacement, languageVersionOrOptions, true);
    }
    return original.call(host, fileName, languageVersionOrOptions, onError, shouldCreate);
  };
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host,
    projectReferences: parsed.projectReferences,
  });
  const source = program.getSourceFile(FILE);
  const outputs = {};
  const emitted = program.emit(source, (name, text) => {
    outputs[name] = text;
  });
  const js = Object.entries(outputs).find(([name]) => name.toLowerCase().endsWith('/claude/process.js'));
  return {
    text: js?.[1],
    substituted,
    esm: source.impliedNodeFormat === ts.ModuleKind.ESNext,
    emitSkipped: emitted.emitSkipped,
    names: Object.keys(outputs).map((name) => name.split('/').slice(-2).join('/')),
  };
}

const oldSource = git('show', `580aded6d295061897b047ac16811e5da230d9e0:${PATH_IN_REPO}`);
const oldBlob = git('rev-parse', `580aded6d295061897b047ac16811e5da230d9e0:${PATH_IN_REPO}`).toString().trim();
const candidateSource = readFileSync(FILE);
const candidateBlob = git('rev-parse', `HEAD:${PATH_IN_REPO}`).toString().trim();
const built = readFileSync(join(PKG, 'dist', 'claude', 'process.js'));
const candidate = programEmit(undefined);
const old = programEmit(oldSource.toString('utf8'));
const oldTranspiled = ts.transpileModule(oldSource.toString('utf8'), {
  compilerOptions: { ...parsed.options, module: ts.ModuleKind.ESNext },
  fileName: FILE,
}).outputText;
const fidelity = candidate.text !== undefined && Buffer.from(candidate.text, 'utf8').equals(built);
const crossCheck = old.text !== undefined && old.text === oldTranspiled;
const result = {
  utc: new Date().toISOString(),
  version: 'v3 (instrumentation correction 2)',
  typescript: ts.version,
  rootNames: parsed.fileNames.length,
  oldSource: { commit: '580aded6d295061897b047ac16811e5da230d9e0', blob: oldBlob, bytes: oldSource.length, sha256: sha(oldSource) },
  candidateSource: { blob: candidateBlob, bytes: candidateSource.length, sha256: sha(candidateSource) },
  candidateBuilt: { bytes: built.length, sha256: sha(built) },
  candidateProgramEmit: { sha256: candidate.text && sha(candidate.text), esm: candidate.esm, emitSkipped: candidate.emitSkipped, names: candidate.names },
  fidelityProgramEmitEqualsBuilt: fidelity,
  oldProgramEmit: { sha256: old.text && sha(old.text), bytes: old.text && Buffer.byteLength(old.text), esm: old.esm, substituted: old.substituted, emitSkipped: old.emitSkipped },
  oldTranspileEsnextSha256: sha(oldTranspiled),
  crossCheckOldProgramEmitEqualsTranspile: crossCheck,
};
if (fidelity && crossCheck && old.substituted) {
  if (existsSync(OUT_DIR)) throw new Error('old build output already exists');
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SRC_DIR, { recursive: true });
  writeFileSync(join(SRC_DIR, 'process.ts'), oldSource);
  writeFileSync(join(OUT_DIR, 'process.js'), old.text);
  result.oldBuildPath = join(OUT_DIR, 'process.js');
  result.oldBuildSha256 = sha(readFileSync(join(OUT_DIR, 'process.js')));
  result.oldSourceCopySha256 = sha(readFileSync(join(SRC_DIR, 'process.ts')));
}
writeFileSync(join(EVIDENCE, 'observations', 'c4-old-build.v3.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ fidelity, crossCheck, substituted: old.substituted, oldBlob, oldBuild: result.oldBuildSha256 ?? null }));
process.exitCode = fidelity && crossCheck && old.substituted ? 0 : 1;
