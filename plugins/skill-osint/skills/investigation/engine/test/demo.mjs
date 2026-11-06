// test/demo.mjs — node test/demo.mjs <cases folder> [port, 41390]: the dashboard against the tests' fake APIs (port
// 41399, reused when one already runs), the demo cases written on the first run, the « running » case played in a
// loop. Ctrl-C stops what it started.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildDemo, demoGeoEnv } from './demo-data.mjs'
import { fakeEnv, startFake } from './fake.mjs'
import { saveDeveloper, settings } from '../lib/watch.js'
import { ENGINE } from './helpers.js'

const [dirArg, port = '41390'] = process.argv.slice(2)
if (!dirArg) { console.error('usage: node test/demo.mjs <cases folder> [dashboard port]'); process.exit(1) }
const dir = path.resolve(dirArg)
fs.mkdirSync(dir, { recursive: true })
// the demo always runs on the fake APIs, developer mode on: a folder that was turned off is turned back on
if (settings(dir).developer.on === false) saveDeveloper(dir, null)
const fake = await startFake({ port: 41399 }).catch(e => { if (e.code !== 'EADDRINUSE') throw e; return { url: 'http://127.0.0.1:41399', close() {} } })
const env = { ...process.env, ...fakeEnv(fake.url), ...demoGeoEnv(dir), OSINT_DIR: dir, OSINT_PORT: port, OSINT_NOTIFY: '0' }
delete env.OSINT_BY
if (!fs.readdirSync(dir).some(n => fs.existsSync(path.join(dir, n, '.osint', 'case.json')))) await buildDemo(env)
const kids = [
  spawn(process.execPath, [ENGINE, 'serve'], { env, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [path.join(import.meta.dirname, 'live.mjs')], { env, stdio: 'inherit', windowsHide: true }),
]
console.log(`demo: http://127.0.0.1:${port}/ — fake APIs on ${fake.url}, cases in ${dir}`)
const stop = () => { for (const k of kids) k.kill(); fake.close(); process.exit(0) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, stop)
kids[0].on('exit', stop)
