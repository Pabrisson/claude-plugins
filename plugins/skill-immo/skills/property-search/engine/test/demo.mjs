// The dashboard against the tests' fake Stream Estate API v1, to develop the plugin without a real call nor a real
// credit: node test/demo.mjs <searches folder> [dashboard port, 41890]. The fake API listens on 41899 and counts 12
// listings not fetched yet (the API's bar, the balance dialog, the forecast); the dashboard says « API test ».
// Ctrl-C stops both.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { ENGINE, fakeStreamEstate } from './helpers.js'

const [dir, port = '41890'] = process.argv.slice(2)
if (!dir) { console.error('usage: node test/demo.mjs <searches folder> [dashboard port]'); process.exit(1) }
const api = await fakeStreamEstate({ total: 12 }, 41899)
console.log(`fake Stream Estate on ${api.url}`)
const server = spawn(process.execPath, [ENGINE, 'serve'], {
  stdio: 'inherit',
  env: { ...process.env, IMMO_DIR: path.resolve(dir), IMMO_PORT: port, IMMO_NOTIFY: '0', STREAM_ESTATE_BASE: api.url, STREAM_ESTATE_API_KEY: 'demo-key' },
})
server.on('exit', code => { api.close(); process.exit(code ?? 0) })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig))
