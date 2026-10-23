const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const output = process.env.GG_CHORE_WEB_ROUND3_OUTPUT || path.join(process.env.TEMP, 'gg-chore-web-round3-after');
fs.mkdirSync(output, {recursive: true});
const tasks = process.env.GG_CHORE_WEB_ROUND3_TASKS ? JSON.parse(fs.readFileSync(process.env.GG_CHORE_WEB_ROUND3_TASKS, 'utf8')) : process.argv.slice(2);
const results = [];
(async () => {
  for (const task of tasks) {
    const [name, ...rest] = task.split('=');
    const command = rest.join('=');
    if (!command) throw new Error('Expected name=command');
    const destination = path.join(output, name + '.log.txt');
    if (fs.existsSync(destination)) throw new Error('Refusing to overwrite transcript: ' + destination);
    const log = fs.createWriteStream(destination);
    const start = Date.now();
    log.write(JSON.stringify({command, node: process.version, start: new Date(start).toISOString()}) + '\n');
    console.log('START', name, command);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
        cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.pipe(log, {end: false});
      child.stderr.pipe(log, {end: false});
      child.on('error', reject);
      child.on('close', resolve);
    });
    const result = {name, command, code, wallSeconds: (Date.now() - start) / 1000};
    if (/^ordinary(?:-\d+)?$/.test(name) && code === 0) fs.copyFileSync(path.join(process.cwd(), 'apps/web/coverage/coverage-summary.json'), path.join(output, name + '-coverage.json'));
    results.push(result);
    log.write('\nRESULT ' + JSON.stringify(result) + '\n');
    await new Promise(resolve => log.end(resolve));
    fs.writeFileSync(path.join(output, tasks[0].split('=')[0] + '-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('RESULT', JSON.stringify(result));
    if (code !== 0) { process.exitCode = code; break; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
