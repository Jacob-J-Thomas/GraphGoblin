// Feasibility probe for Node APIs only (no product code): ChildProcess pid default, in-thread
// resolve hook redirect for one parent, and a performance.now override seen by another module.
import { registerHooks } from 'node:module';
import { ChildProcess } from 'node:child_process';
const target = new URL('./dummy-target.mjs', import.meta.url).href;
const seam = new URL('./dummy-seam.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target && specifier === 'node:fs/promises') return { url: seam, shortCircuit: true };
    return next(specifier, context);
  },
});
const c = new ChildProcess();
const real = performance.now.bind(performance);
Object.defineProperty(performance, 'now', { value: () => real() + 5000, configurable: true, writable: true });
const { probe } = await import(target);
const r = await probe();
console.log(JSON.stringify({ node: process.version, pidOwn: Object.hasOwn(c, 'pid'), pid: c.pid === undefined ? 'undefined' : c.pid, statName: r.statIsSeam, spawnName: r.spawnIsSeam, nowShifted: r.now - real() > 4990 }));
