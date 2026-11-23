import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = [];
function walk(relative) {
  for (const name of readdirSync(resolve(qa, relative))) {
    const path = relative + '/' + name;
    if (statSync(resolve(qa, path)).isDirectory()) walk(path);
    else files.push({ path, bytes: statSync(resolve(qa, path)).size, sha256: sha(resolve(qa, path)) });
  }
}
walk('apps/web/dist'); walk('apps/web/dist-goblin');
const receipt = { atUtc: new Date().toISOString(), head: '8632538fea2c95c3a528ef91ddbaefebf3d3bfba',
  tree: '0ac0f5afd77d3a418784082398d94c00e7c07375', manifestSha256: sha(resolve(evidence, 'CANDIDATE.json')),
  buildLogSha256: sha(resolve(evidence, 'build.log.txt')), command: 'pnpm.cmd build --filter=@graphgoblin/web...', files };
writeFileSync(resolve(evidence, 'build-artifacts.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, servedIndex: files.find((file) => file.path === 'apps/web/dist/index.html') }, null, 2));
