import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const worktree = process.argv[2];
const evidence = process.argv[3];
const source = join(worktree, 'packages', 'adapter-codex', 'src', 'probe-directory.test.ts');
const bytes = readFileSync(source);
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== 'c952e3b40359ef448e3c22a46ebd9ad4f8818f4da608f00aa09c8cccf1be2d6d') {
  throw new Error('Candidate SHA-256 changed: ' + hash);
}
const division = "describe('Codex readiness probe directory', () => {";
const content = bytes.toString('utf8');
const index = content.indexOf(division);
if (index < 0 || index !== content.lastIndexOf(division)) {
  throw new Error('Unable to locate candidate helper boundary');
}
const harness = content.slice(0, index);
const candidateLine = 'const [outcome] = await Promise.allSettled([work]);';
if (harness.split(candidateLine).length !== 2) throw new Error('Expected one settlement wait');
const measured = harness.replace(candidateLine, `const [outcome] =
        process.env.GG_466_QA_SCENARIO === 'live-control'
          ? [{ status: 'fulfilled' as const, value: undefined }]
          : await Promise.allSettled([work]);`);
const appendix = readFileSync(join(evidence, 'qa-cases.ts.txt'), 'utf8');
const combined = measured + appendix;
writeFileSync(join(evidence, 'generated-independent-qa.test.ts.txt'), combined, { flag: 'wx' });
writeFileSync(join(worktree, 'packages', 'adapter-codex', 'src', 'probe-directory.independent-qa.test.ts'), combined, { flag: 'wx' });
console.log('Candidate SHA-256=' + hash);
console.log('Generated QA SHA-256=' + createHash('sha256').update(combined).digest('hex'));
