import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [worktree, evidence] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = join(worktree, 'packages', 'adapter-codex', 'src', 'probe-directory.test.ts');
const bytes = readFileSync(source);
const expectedSource = '9d952d1cd6d731e223cc47ac53ec5e40b89db3ddf90f8f4ca983ac1f30b8ec5a';
if (digest(bytes) !== expectedSource) throw new Error('Corrected candidate SHA-256 changed');
const division = "describe('Codex readiness probe directory', () => {";
const content = bytes.toString('utf8');
const index = content.indexOf(division);
if (index < 0 || index !== content.lastIndexOf(division)) {
  throw new Error('Unable to locate candidate helper boundary');
}
const helper = content.slice(0, index);
const appendix = readFileSync(join(evidence, 'qa-cases.ts.txt'));
const expectedBody = '646e5861c25efdc1783f9b0f00c4f313106f95f83acdc0a23116fb7a20c4c98f';
if (digest(appendix) !== expectedBody) throw new Error('Independent QA body changed');
const combined = Buffer.concat([Buffer.from(helper, 'utf8'), appendix]);
writeFileSync(join(evidence, 'generated-independent-qa.test.ts.txt'), combined, { flag: 'wx' });
writeFileSync(join(worktree, 'packages', 'adapter-codex', 'src', 'probe-directory.independent-qa.test.ts'), combined, { flag: 'wx' });
console.log('Corrected candidate SHA-256=' + digest(bytes));
console.log('Corrected helper bytes SHA-256=' + digest(Buffer.from(helper, 'utf8')));
console.log('Unchanged independent QA body SHA-256=' + digest(appendix));
console.log('Generated QA SHA-256=' + digest(combined));
