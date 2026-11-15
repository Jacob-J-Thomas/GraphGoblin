import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const malformedItems = new Set(['H','L','Ht']);
const canary = /(?:probe-(?:body|other)-canary-|candidate-(?:body|other)-canary-|item-(?:H|Ht|L)-key-canary-|single-(?:H|L)-key-canary-|S{63})/u;
const loggingFields = ['level','time','pid','hostname','loopId','nodeId','code','reason','msg'];

export async function checkDiagnostics(out, loops, cases, observations, contract) {
  const files = ['initial-gateway.log','restart-gateway.log'];
  const entries = [];
  for (const file of files) {
    const raw = await readFile(join(out,file),'utf8');
    assert(!canary.test(raw), 'A synthetic probe canary entered process logs: ' + file);
    for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
      let entry;
      try { entry = JSON.parse(line); } catch { assert.fail('Non-structured gateway log at ' + file); }
      entries.push({file,entry});
    }
  }

  const loopIds = new Set(Object.values(loops).map(({loopId}) => loopId));
  const codes = new Set([contract.item.code, contract.single.code]);
  const expectedWarnings = entries.filter(({entry}) =>
    codes.has(entry.code) || (entry.level >= 40 && loopIds.has(entry.loopId)));
  const seen = new Set();
  const results = [];
  for (const observation of observations) {
    const {target,label,delivered,barrier} = observation;
    const input = cases[target].find((candidate) => candidate.label === label);
    assert(input);
    const expected = target === 'items' ?
      input.ids.flatMap((tag,index) => malformedItems.has(tag) ? [index] : []) :
      target === 'lone' || (target === 'split' && input.ids.includes('SPLIT')) ? [null] : [];
    const startMs = Date.parse(delivered.received.wall);
    const endMs = Date.parse(barrier.received.wall);
    const matching = expectedWarnings.filter(({entry}) =>
      entry.loopId === loops[target].loopId && entry.time >= startMs && entry.time <= endMs);
    assert.equal(matching.length, expected.length, label);
    const shape = target === 'items' ? contract.item : contract.single;
    for (const [i, record] of matching.entries()) {
      const {entry} = record;
      assert(!seen.has(record), 'A warning matched more than one request');
      seen.add(record);
      assert.equal(entry.level,40,label);
      assert.equal(entry.nodeId,loops[target].triggerNodeId,label);
      assert.equal(entry.code,shape.code,label);
      assert.equal(entry.reason,shape.reason,label);
      assert.equal(entry.msg,shape.message,label);
      const fields = [...loggingFields, ...(target === 'items' ? ['itemIndex'] : [])].sort();
      assert.deepEqual(Object.keys(entry).sort(),fields,label);
      if (target === 'items') assert.equal(entry.itemIndex,expected[i],label);
      assert(Buffer.byteLength(JSON.stringify(entry),'utf8') < 512,label);
    }
    results.push({target,label,window:{startMs,endMs},itemIndices:target === 'items' ? expected : [],
      expected:expected.length,actual:matching.length,records:matching});
  }
  assert.equal(seen.size,expectedWarnings.length,'There are out-of-window or unmatched warnings');
  assert.equal(seen.size,20,'Corrected fixture expects 12 item and 8 single warnings');
  return {schema:'graphgoblin-361-log-oracle/v1', total:seen.size, files, results,
    canaries:'No raw, escaped or replacement spelling of the canary prefixes occurred in process logs.'};
}
