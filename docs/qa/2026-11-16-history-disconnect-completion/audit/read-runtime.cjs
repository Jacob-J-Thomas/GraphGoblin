const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
if (process.version !== 'v22.23.4') throw new Error('Wrong runtime');
const native = process.binding('natives');
const rules = {
  _http_server: ['function onServerResponseClose', 'ServerResponse.prototype.assignSocket',
    'function socketOnClose', 'function abortIncoming', 'function resOnFinish',
    'function emitCloseNT', 'state.outgoing.push(res)'],
  _http_outgoing: ['OutgoingMessage.prototype.destroy', 'this.destroyed = false'],
};
const result = { node: process.version, executable: process.execPath, inspected: [] };
for (const [name, needles] of Object.entries(rules)) {
  const content = native[name];
  fs.writeFileSync(path.join(__dirname, name + '.source.txt'), content);
  const lines = content.split('\n');
  const snippets = needles.map(needle => {
    const start = lines.findIndex(line => line.includes(needle));
    if (start < 0) throw new Error('Source needle absent: ' + needle);
    return { needle, line: start + 1, text: lines.slice(Math.max(0, start - 3), start + 38).map((l, i) => `${Math.max(0, start - 3) + i + 1}: ${l}`).join('\n') };
  });
  result.inspected.push({ name, sha256: crypto.createHash('sha256').update(content).digest('hex'), snippets });
}
fs.writeFileSync(path.join(__dirname, 'runtime-source-receipt.json'), JSON.stringify(result, null, 2) + '\n');
for (const entry of result.inspected) {
  for (const snippet of entry.snippets) console.log(entry.name + ': ' + snippet.needle + '\n' + snippet.text + '\n');
}
