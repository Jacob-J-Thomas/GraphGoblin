import { createServer } from 'node:http';
import { once } from 'node:events';

const port = Number(process.argv[2]);
const options = JSON.parse(process.argv[3]);
const server = createServer((_request, response) => {
  response.setHeader('connection', 'close');
  response.end('owned-listener:' + JSON.stringify(options));
});
server.listen({ port, ...options });
await once(server, 'listening');
console.log('ready');
process.stdin.resume();
await once(process.stdin, 'end');
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
