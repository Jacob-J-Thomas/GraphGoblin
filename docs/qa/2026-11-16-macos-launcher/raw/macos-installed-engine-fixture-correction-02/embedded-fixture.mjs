            import { appendFileSync, writeFileSync } from 'node:fs'
            import { createServer } from 'node:http'

            writeFileSync('spawn-pid', String(process.pid) + '\n', { mode: 0o600, flag: 'wx' })
            const server = createServer((request, response) => {
              appendFileSync('requests', request.method + ' ' + request.url + '\n', { mode: 0o600 })
              const reply = (code, type, body, fields = {}) => {
                response.writeHead(code, {
                  'content-type': type, 'content-length': Buffer.byteLength(body), ...fields
                })
                response.end(body)
              }
              if (request.url === '/healthz' && request.method === 'GET') {
                reply(200, 'application/json', '{"status":"ok"}', {
                  'x-graphgoblin-instance': 'a'.repeat(64),
                  'x-graphgoblin-pid': String(process.pid),
                  'x-graphgoblin-phase': 'running'
                })
              } else if (request.method === 'GET' && request.url === '/app/') {
                reply(200, 'text/html', '<html>management</html>')
              } else if (request.method === 'GET' && request.url === '/goblin/') {
                reply(200, 'text/html', '<html>Goblin</html>')
              } else if (request.url === '/fixture-drain' && request.method === 'POST'
                         && request.headers['x-fixture-control'] === 'fixture-control-check') {
                // The current response is still active when server.close() checks idle sockets.
                reply(202, 'application/json', '{"closed":true}', { connection: 'close' })
                server.close()
              } else {
                reply(404, 'text/plain', 'unexpected fixture request')
              }
            })
            const limit = setTimeout(() => server.close(), 15_000)
            limit.unref()
            server.once('close', () => clearTimeout(limit))
            server.listen(Number(process.env.GG_PORT), '127.0.0.1')