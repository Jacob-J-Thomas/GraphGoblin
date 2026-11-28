// Independent QA fault fixture for the built API (#542/#537/#560). Loaded with
// `node --import <this file> apps/api/dist/main.js`. It redirects only two imports:
//   - `node:fs/promises` as imported by apps/api/dist/data-dir-lock.js
//   - `@graphgoblin/infrastructure/sqlite` as imported by apps/api/dist/container.js
// Every other operation is the real one. Faults come from RQ_FAULT (JSON); the call log is written
// to RQ_FAULT_LOG at process exit. No source under test is modified.
import { registerHooks } from 'node:module';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const config = JSON.parse(process.env.RQ_FAULT ?? '{}');
const logFile = process.env.RQ_FAULT_LOG;
const events = [];
const norm = (p) => resolve(String(p)).toLowerCase();
const same = (a, b) => a !== undefined && b !== undefined && norm(a) === norm(b);
const synthetic = (label, code) => Object.assign(new Error(label), { code });
const log = (event) => events.push(event);
const exists = (p) => fs.lstat(p).then(() => true, () => false);
const once = new Set();
process.on('exit', () => {
  if (logFile) writeFileSync(logFile, JSON.stringify({ config, events }, null, 2) + '\n');
});

const fixture = {
  fs: {
    async open(path, flags, mode) {
      const handle = await fs.open(path, flags, mode);
      const m = config.mainRecord;
      if (!m || flags !== 'wx' || !same(path, m.lockPath) || once.has('main-open')) return handle;
      once.add('main-open');
      log('main-open');
      return new Proxy(handle, {
        get(real, key) {
          if (key === 'writeFile')
            return async (data, encoding) => {
              log('main-write');
              if (!m.faults.includes('write')) return real.writeFile(data, encoding);
              await real.writeFile('{"pid":');
              throw synthetic('rq fixture main record write refusal', 'ENOSPC');
            };
          if (key === 'stat')
            return async (options) => {
              log('main-stat');
              if (m.faults.includes('stat'))
                throw synthetic('rq fixture main record stat refusal', 'EIO');
              return real.stat(options);
            };
          if (key === 'close')
            return async () => {
              log('main-close');
              // `close-open`: the close is refused and the handle really stays open.
              if (m.faults.includes('close-open'))
                throw synthetic('rq fixture main record close refusal', 'EIO');
              await real.close();
              if (m.faults.includes('close'))
                throw synthetic('rq fixture main record close refusal', 'EIO');
            };
          const value = Reflect.get(real, key, real);
          return typeof value === 'function' ? value.bind(real) : value;
        },
      });
    },
    async readFile(path, ...rest) {
      const r = config.ownMarkerRead;
      if (r && same(dirname(path), r.guard) && !once.has('own-marker-read') && (await exists(r.lockPath))) {
        once.add('own-marker-read');
        log('own-marker-read-fault:' + basename(String(path)));
        throw synthetic('rq fixture own marker read refusal', 'EACCES');
      }
      return fs.readFile(path, ...rest);
    },
    async unlink(path) {
      log('unlink:' + basename(String(path)));
      const m = config.mainRecord;
      if (m && same(path, m.lockPath)) {
        log('main-unlink');
        if (m.faults.includes('unlink'))
          throw synthetic('rq fixture main record unlink refusal', 'EACCES');
      }
      for (const lease of config.leaseRelease ?? [])
        if (same(path, lease.lockPath)) {
          log('lease-unlink-fault:' + lease.name);
          throw synthetic('rq fixture lease unlink refusal ' + lease.name, 'EACCES');
        }
      if (config.ownMarkerUnlink && same(dirname(path), config.ownMarkerUnlink.guard)) {
        log('own-marker-unlink-fault');
        throw synthetic('rq fixture own marker unlink refusal', 'EPERM');
      }
      return fs.unlink(path);
    },
    async lstat(path, ...rest) {
      const m = config.mainRecord;
      if (m && same(path, m.lockPath)) {
        log('main-lookup');
        if (m.faults.includes('lookup'))
          throw synthetic('rq fixture main record lookup refusal', 'EACCES');
      }
      const g = config.guardRmdir;
      if (g?.lookupFault && g.triggered && !g.lookupFired && same(path, g.guard)) {
        g.lookupFired = true;
        log('guard-lookup-fault');
        throw synthetic('rq fixture guard lookup refusal', 'EACCES');
      }
      return fs.lstat(path, ...rest);
    },
    async rmdir(path, ...rest) {
      const g = config.guardRmdir;
      log('rmdir:' + basename(String(path)));
      if (!g || !same(path, g.guard) || g.triggered) return fs.rmdir(path, ...rest);
      if (g.when === 'release' && !(await exists(g.lockPath))) return fs.rmdir(path, ...rest);
      g.triggered = true;
      log('guard-rmdir-fault:' + g.schedule);
      if (g.schedule === 'successor') {
        await fs.rmdir(path);
        await fs.rename(g.successorStaging, path);
      } else if (g.schedule === 'empty') {
        await fs.rmdir(path);
        await fs.mkdir(path);
      }
      throw synthetic('rq fixture guard removal refusal', 'EPERM');
    },
  },
  openDatabase(real, ...args) {
    const handle = real.openDatabase(...args);
    const mode = config.sqlite?.databaseClose;
    return {
      ...handle,
      close() {
        log('database-close');
        if (mode === 'fail-open') throw synthetic('rq fixture database close refusal', 'EIO');
        handle.close();
        if (mode === 'fail') throw synthetic('rq fixture database close refusal', 'EIO');
      },
    };
  },
  openReadOnlyDatabaseClient(real, ...args) {
    const client = real.openReadOnlyDatabaseClient(...args);
    const mode = config.sqlite?.readonlyClose;
    return new Proxy(client, {
      get(target, key) {
        if (key === 'close')
          return () => {
            log('readonly-database-close');
            if (mode === 'fail-open')
              throw synthetic('rq fixture read-only database close refusal', 'EIO');
            target.close();
            if (mode === 'fail')
              throw synthetic('rq fixture read-only database close refusal', 'EIO');
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
};
globalThis.__rqFixture = fixture;

const dataUrl = (text) => 'data:text/javascript,' + encodeURIComponent(text);
const fsWrapper = dataUrl(
  "export * from 'node:fs/promises';\n" +
    ['open', 'readFile', 'unlink', 'lstat', 'rmdir']
      .map((key) => `export const ${key} = (...a) => globalThis.__rqFixture.fs.${key}(...a);`)
      .join('\n'),
);
const isDist = (parent, name) =>
  typeof parent === 'string' && parent.replace(/\\/g, '/').endsWith(`/apps/api/dist/${name}.js`);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:fs/promises' && isDist(context.parentURL, 'data-dir-lock'))
      return { shortCircuit: true, url: fsWrapper };
    if (specifier === '@graphgoblin/infrastructure/sqlite' && isDist(context.parentURL, 'container')) {
      const actual = JSON.stringify(next(specifier, context).url);
      return {
        shortCircuit: true,
        url: dataUrl(
          `import * as real from ${actual};\nexport * from ${actual};\n` +
            'export const openDatabase = (...a) => globalThis.__rqFixture.openDatabase(real, ...a);\n' +
            'export const openReadOnlyDatabaseClient = (...a) => globalThis.__rqFixture.openReadOnlyDatabaseClient(real, ...a);\n',
        ),
      };
    }
    return next(specifier, context);
  },
});
log('preload-registered');
