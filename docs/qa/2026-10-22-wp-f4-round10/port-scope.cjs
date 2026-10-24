// Verification-only boundary: stock fixtures may bind only ports 5650 through 5659.
const net = require('node:net');
const fs = require('node:fs');
const originalListen = net.Server.prototype.listen;
let nextPort = 5650;
function record(server) {
  const address = server.address();
  if (address && typeof address === 'object' && process.env.GG_WPF4_LISTEN_LOG)
    fs.appendFileSync(
      process.env.GG_WPF4_LISTEN_LOG,
      JSON.stringify({ pid: process.pid, port: address.port }) + '\n',
    );
}
net.Server.prototype.listen = function (...raw) {
  const first = raw[0];
  const requested = first && typeof first === 'object' ? first.port : first;
  if (requested === undefined || (typeof requested === 'string' && !/^\d+$/.test(requested)))
    return originalListen.apply(this, raw);
  const port = Number(requested);
  if (port !== 0) {
    if (port >= 5650 && port <= 5659) {
      this.once('listening', () => record(this));
      return originalListen.apply(this, raw);
    }
    queueMicrotask(() =>
      this.emit(
        'error',
        Object.assign(new Error('Outside disposable WP-F4 port range'), {
          code: 'EADDRINUSE',
          port,
        }),
      ),
    );
    return this;
  }
  const server = this,
    args = [...raw],
    originalEmit = server.emit;
  if (typeof args.at(-1) === 'function') server.once('listening', args.pop());
  let attempts = 0;
  function attempt() {
    const candidate = nextPort;
    nextPort = nextPort === 5659 ? 5650 : nextPort + 1;
    attempts++;
    args[0] = first && typeof first === 'object' ? { ...first, port: candidate } : candidate;
    originalListen.apply(server, args);
  }
  server.emit = function (event, ...values) {
    if (event === 'error' && values[0]?.code === 'EADDRINUSE' && attempts < 10) {
      attempt();
      return true;
    }
    if (event === 'error') server.emit = originalEmit;
    return originalEmit.call(server, event, ...values);
  };
  server.once('listening', () => {
    server.emit = originalEmit;
    record(server);
  });
  attempt();
  return server;
};
