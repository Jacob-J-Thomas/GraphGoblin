import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=process.cwd(),file=path.join(root,'docs/qa/2026-10-28-wp-205-none/REVIEW.md');let text=fs.readFileSync(file,'utf8');
text=text.split('\n').map(line=>{
 if(!line.startsWith('|'))return line;
 const columns=line.split('|');
 if(line.includes('`pnpm.cmd --filter @graphgoblin/web test:coverage`'))return `| ${columns[1].trim()} | 1,821 passed | 98.93% | 94.79% | Pass |`;
 if(line.includes('`pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage'))return `| ${columns[1].trim()} | 589 passed, 5 skipped | 99.31% | 95.49% | Subset pass; D-015 |`;
 if(line.includes('`pnpm.cmd --filter @graphgoblin/infrastructure test:coverage'))return `| ${columns[1].trim()} | 795 passed, 2 native-boundary failures | Not reported on failure | Not reported on failure | Subset failed; D-015 |`;
 return line;
}).join('\n');
text=text.replace('- **D-015:**','- **Infrastructure / D-015:** The subset still exercised two additional native boundaries in untouched files. `src/claude/readiness.test.ts:62` (`hang reports unknown without exposing CLI bodies`) expected a deadline diagnostic but received “Claude CLI check process did not confirm that it stopped.” `src/claude/submission.test.ts:107` (`keeps a provider failure the stream reported ahead of the non-zero exit that follows it`) expected `HARNESS_QUOTA_EXHAUSTED` but received `HARNESS_TERMINATION_UNCONFIRMED`. Neither is a WP-205 source change or a timing-bound assertion failure. These native success criteria are **not run here / unavailable under D-015**, not passing tests; their attempted failures are retained verbatim in `review-coverage-infrastructure.log.txt`. No native retry or full-suite rerun was made. Any native fixture cleanup that requires tree termination remains unconfirmed in this sandbox.\n- **D-015:**');
text=text.replace('No new red-before suite was run','The archived base was transpiled with the installed TypeScript compiler, not rebuilt/typechecked through a second pnpm installation. Its actual API wrote the disposable upgrade stores. No new red-before suite was run');
fs.writeFileSync(file,text);
const scratch=path.dirname(fileURLToPath(import.meta.url)),p=path.join(scratch,'preserve.mjs');let preserve=fs.readFileSync(p,'utf8');preserve=preserve.replace("'normalize-log-names.mjs']","'normalize-log-names.mjs','finalize.mjs']");fs.writeFileSync(p,preserve);