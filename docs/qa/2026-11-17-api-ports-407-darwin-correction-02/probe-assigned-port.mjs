import { createServer } from 'node:net';
import { once } from 'node:events';

const port = Number(process.argv[2]);
for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
  const server = createServer((socket) => socket.destroy());
  server.listen(port, host);
  await once(server, 'listening');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  console.log(JSON.stringify({ host, port, available: true }));
}
