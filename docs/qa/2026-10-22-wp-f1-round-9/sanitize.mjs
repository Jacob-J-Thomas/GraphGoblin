// Evidence hygiene only. Run after collectors/gates have closed their output files.
import { readdir, readFile, writeFile } from 'node:fs/promises';
const directory = new URL('./', import.meta.url);
for (const file of await readdir(directory)) {
  if (!/\.(?:log\.txt|json|jsonl|cs)$/.test(file)) continue;
  const path = new URL(file, directory);
  const bytes = await readFile(path);
  let text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
  text =
    text
      .replace(/^\uFEFF/, '')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/(?<![A-Za-z0-9])[A-Za-z]:(?:\\+|\/)[^\s"'<>|)]*/g, '[local-path]')
      .replace(/(?:\\+|\/)?Users(?:\\+|\/)[^\r\n]*/gi, '[local-path]')
      .replace(/\bgg_[A-Za-z0-9_-]{24,}\b/g, '[disposable-key]')
      .replace(/[ \t]+$/gm, '')
      .trimEnd() + '\n';
  if (process.env.USERNAME) text = text.replaceAll(process.env.USERNAME, '[user]');
  await writeFile(path, text);
}
