// QA-only passive stdio observation. The native plugin still executes its original built entry.
import {appendFileSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {StringDecoder} from 'node:string_decoder';

const target = process.env.GGQ_QA_MCP_ENTRY;
if (target && process.argv[1] && realpathSync(process.argv[1]) === realpathSync(target)) {
  const directory = process.env.GGQ_QA_MCP_TRACE;
  const prefix = join(directory, 'mcp-' + process.pid);
  const active = new Map();
  const decoder = {in: new StringDecoder('utf8'), out: new StringDecoder('utf8')};
  const buffered = {in: '', out: ''};
  let sequence = 0;
  for (const suffix of ['.stdin.raw', '.stdout.raw', '.stderr.raw', '.events.jsonl']) {
    if (existsSync(prefix + suffix)) throw new Error('Refusing to overwrite an MCP trace');
    writeFileSync(prefix + suffix, Buffer.alloc(0), {flag: 'wx'});
  }
  function record(value) {
    appendFileSync(prefix + '.events.jsonl', JSON.stringify({
      sequence: ++sequence, pid: process.pid, utcMs: Date.now(),
      monotonicNs: process.hrtime.bigint().toString(), ...value,
    }) + '\n');
  }
  function state(alive = true) {
    const temp = prefix + '.state.tmp';
    writeFileSync(temp, JSON.stringify({pid: process.pid, entry: realpathSync(target), alive,
      active: [...active.values()]}));
    renameSync(temp, prefix + '.state.json');
  }
  function observe(direction, bytes) {
    appendFileSync(prefix + (direction === 'in' ? '.stdin.raw' : '.stdout.raw'), bytes);
    buffered[direction] += decoder[direction].write(bytes);
    let newline;
    while ((newline = buffered[direction].indexOf('\n')) !== -1) {
      const line = buffered[direction].slice(0, newline);
      buffered[direction] = buffered[direction].slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { record({kind: 'parse-error', direction}); continue; }
      if (direction === 'in' && message.method && message.id !== undefined)
        active.set(JSON.stringify(message.id), {id: message.id, method: message.method});
      if (direction === 'out' && message.id !== undefined)
        active.delete(JSON.stringify(message.id));
      record({kind: 'message', direction, message});
      state();
    }
  }
  record({kind: 'start', entry: realpathSync(target)});
  state();
  // Observe existing emissions without adding a data listener or changing stream flow.
  const emit = process.stdin.emit;
  process.stdin.emit = function(event, ...args) {
    if (event === 'data') observe('in', Buffer.isBuffer(args[0]) ? args[0] : Buffer.from(args[0]));
    return emit.call(this, event, ...args);
  };
  const write = process.stdout.write;
  process.stdout.write = function(chunk, encoding, ...args) {
    observe('out', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    return write.call(this, chunk, encoding, ...args);
  };
  const errorWrite = process.stderr.write;
  process.stderr.write = function(chunk, encoding, ...args) {
    appendFileSync(prefix + '.stderr.raw', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    return errorWrite.call(this, chunk, encoding, ...args);
  };
  process.once('exit', code => { record({kind: 'exit', code}); state(false); });
}
