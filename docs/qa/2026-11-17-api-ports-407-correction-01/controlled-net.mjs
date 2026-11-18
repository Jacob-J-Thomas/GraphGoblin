import { createServer as nativeServer } from 'node:net';

export function createServer(...args) {
  const server = nativeServer(...args);
  const nativeListen = server.listen.bind(server);
  server.listen = (port, host, callback) => {
    globalThis.probedHosts.push(host);
    if (host === globalThis.failHost) {
      queueMicrotask(() => server.emit('error', Object.assign(new Error('controlled bind fault'), {
        code: globalThis.failCode,
      })));
      return server;
    }
    return nativeListen(port, host, callback);
  };
  return server;
}
