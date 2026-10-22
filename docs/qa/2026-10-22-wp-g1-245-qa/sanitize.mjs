// Redact machine-specific paths in retained textual evidence without changing test values.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const out = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
for (const file of await readdir(out)) {
  if (!/\.(?:md|mjs|json|log)$/.test(file)) continue;
  const bytes = await readFile(join(out, file));
  let value =
    bytes[0] === 255 && bytes[1] === 254
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  value = value.replaceAll('\0', '').replace(/^\uFFFD+/, '');
  for (const path of [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')])
    value = value.replaceAll(path, '<worktree>');
  value = value.replace(/C:(?:\\+|\/)Users(?:\\+|\/)[^\\/\s"<>]+/gi, '<local>');
  value = value.replace(/(?:\\+|\/)Users(?:\\+|\/)[^\\/\s"<>]+/gi, '<local>');
  if (file.endsWith('.log')) value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  try {
    await writeFile(join(out, file), value);
  } catch (error) {
    if (error.code !== 'EBUSY') throw error;
  }
}
