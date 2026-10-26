import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const out = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/[\\/]$/, '');
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      await walk(path);
      continue;
    }
    let text = await fs.readFile(path, 'utf8');
    for (const [prefix, label] of [
      [repo, '<repo>'],
      [process.env.USERPROFILE, '<user>'],
      [process.env.USERPROFILE?.slice(2), '<user>'],
    ]) {
      if (!prefix) continue;
      for (const version of [prefix.replaceAll('\\', '\\\\'), prefix.replaceAll('\\', '/'), prefix])
        text = text.replaceAll(version, label);
    }
    text = text.replace(/\bgg_[A-Za-z0-9_-]+/g, '[redacted-key]').replace(/^\uFEFF/, '');
    await fs.writeFile(path, text);
  }
}
await walk(out);
