import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { ENGINE, searchesFolder } from './helpers.js'

// A listing's photos kept in its search: the user's own, added and deleted from the dossier, and an expired listing's
// downloaded by the server (at its start, the watch off). The portal: one photo, one gone, one page.
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const portal = http.createServer((req, res) => {
  if (req.url === '/1.jpg') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(jpg)
  if (req.url === '/3.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Annonce expirée</p>')
  res.writeHead(404).end()
}).listen(0, '127.0.0.1')
await new Promise(ok => portal.once('listening', ok))
const pics = `http://127.0.0.1:${portal.address().port}`

const { home, dir } = searchesFolder(), port = 41700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`
const listing = (id, status, pictures) => ({ id, source: 'manual', status, pictures, urls: [], location: { point: null }, messages: [], changes: [] })
fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify([
  listing('gone', 'EXPIRED', [`${pics}/1.jpg`, `${pics}/2.jpg`, `${pics}/3.html`]),
  // its photos out of reach: tried again at the next watch
  listing('offline', 'EXPIRED', ['http://127.0.0.1:9/1.jpg']),
  listing('online', 'AVAILABLE', [`${pics}/1.jpg`]),
]))
fs.writeFileSync(path.join(home, '.settings.json'), JSON.stringify({ watch_minutes: 0 }))
const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, IMMO_DIR: home, IMMO_PORT: `${port}`, IMMO_NOTIFY: '0', IMMO_LINKS: '0', STREAM_ESTATE_BASE: 'http://127.0.0.1:9', STREAM_ESTATE_API_KEY: 'test-key' } })
test.after(() => { server.kill(); portal.close() })
const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'listings.json'), 'utf8'))
const byId = id => read().find(l => l.id === id)

test("an expired listing's photos: downloaded at the server's start, the gone ones and the pages left out, served", async () => {
  for (let i = 0; i < 100 && !byId('gone').kept_pictures; i++) await new Promise(ok => setTimeout(ok, 100))
  assert.deepEqual(byId('gone').kept_pictures, ['documents/gone/portail-01.jpg'])
  assert.deepEqual(fs.readFileSync(path.join(dir, 'documents/gone/portail-01.jpg')), jpg)
  assert.equal(byId('offline').kept_pictures, undefined, 'out of reach: tried again later')
  assert.equal(byId('online').kept_pictures, undefined, 'online: its portal still has them')
  const r = await fetch(`${base}/api/s/paul-bert/documents/gone/portail-01.jpg`)
  assert.deepEqual([r.status, r.headers.get('content-type')], [200, 'image/jpeg'])
})

test("the user's photos: added, refused when not an image, served, deleted with their file", async () => {
  const post = body => fetch(`${base}/api/s/paul-bert/listings/online`, { method: 'POST', body: JSON.stringify({ photos: body }) })
  const data = jpg.toString('base64')
  const l = await (await post({ add: [{ name: '../visite salon.JPG', data }, { name: 'cuisine.webp', data }] })).json()
  const [p] = l.my_pictures
  assert.deepEqual([l.my_pictures.length, p.name, p.file, p.type], [2, 'visite salon.JPG', `documents/online/${p.id}-visite salon.JPG`, undefined])
  assert.deepEqual(fs.readFileSync(path.join(dir, p.file)), jpg)
  assert.equal((await fetch(`${base}/api/s/paul-bert/${p.file.split('/').map(encodeURIComponent).join('/')}`)).headers.get('content-type'), 'image/jpeg')
  for (const add of [[{ name: 'plan.pdf', data }], [{ name: 'x.jpg', data: '' }], [], Array.from({ length: 21 }, () => ({ name: 'x.jpg', data }))])
    assert.equal((await post({ add })).status, 400)
  assert.equal(byId('online').my_pictures.length, 2)
  assert.equal((await post({ delete: 'd-nope' })).status, 404)
  const after = await (await post({ delete: p.id })).json()
  assert.deepEqual(after.my_pictures.map(x => x.name), ['cuisine.webp'])
  assert.ok(!fs.existsSync(path.join(dir, p.file)))
})
