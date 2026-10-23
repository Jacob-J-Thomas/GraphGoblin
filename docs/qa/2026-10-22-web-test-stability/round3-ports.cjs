const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const rows = await Promise.all(Array.from({length: 10}, (_, index) => 5770 + index).map(port => new Promise(resolve => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const done = status => { socket.destroy(); resolve({port, status}); };
    socket.setTimeout(1000, () => done('timeout'));
    socket.once('connect', () => done('listening'));
    socket.once('error', error => done(error.code));
  })));
  fs.writeFileSync(path.join(process.env.TEMP, 'gg-chore-web-round3-ports' + (process.argv.includes('--before') ? '-before' : '') + '.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify(rows));
  if (rows.some(row => row.status !== 'ECONNREFUSED')) process.exitCode = 1;
})();
