// Read only the SDK-bundled executable's embedded public model metadata; no provider call.
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = await realpath(fileURLToPath(new URL('../../../packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js', import.meta.url)));
const cliRequire = createRequire(createRequire(sdk).resolve('@openai/codex/bin/codex.js'));
const platform = cliRequire.resolve('@openai/codex-win32-x64/package.json');
const binary = join(dirname(platform), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const bytes = await readFile(binary);
const text = bytes.toString('latin1');
const marker = '"slug": "gpt-6.1-terra"';
const entries = [];
for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + 1)) {
  const window = text.slice(index, index + 20_000);
  const end = window.search(/\n\s{4}\},?\n/);
  const entry = end > 0 ? window.slice(0, end) : window.slice(0, 4000);
  const levels = [...(/"supported_reasoning_levels":\s*\[([\s\S]*?)\]/.exec(entry)?.[1] ?? '').matchAll(/"effort":\s*"([^"]+)"/g)].map((match) => match[1]);
  entries.push({ default: /"default_reasoning_level":\s*"([^"]+)"/.exec(entry)?.[1], levels });
}
const result = {
  checkedAt: new Date().toISOString(),
  sdk: JSON.parse(await readFile(new URL('../../../packages/adapter-codex/package.json', import.meta.url), 'utf8')).dependencies['@openai/codex-sdk'],
  binaryBytes: bytes.length,
  binarySha256: createHash('sha256').update(bytes).digest('hex'),
  model: 'gpt-6.1-terra',
  distinctEmbeddedEntries: [...new Map(entries.map((entry) => [JSON.stringify(entry), entry])).values()],
};
await writeFile(new URL('./pinned-catalog.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
