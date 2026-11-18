import { createServer } from 'node:net';
const first = Number(process.argv[2]);
const count = Number(process.argv[3]);
for (let port = first; port < first + count; port++) {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  console.log(JSON.stringify({ loopbackFree: port }));
}
