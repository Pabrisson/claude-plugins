import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// a throwaway projects folder with one project and one version, served on a free port
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'video-studio-'))
const dir = path.join(home, 'demo'), port = 41500 + Math.floor(Math.random() * 400)
for (const d of ['source', 'output', 'files/reviews']) fs.mkdirSync(path.join(dir, d), { recursive: true })
fs.writeFileSync(path.join(dir, 'source/project.json'), JSON.stringify({ slug: 'demo', formats: ['9:16'], fps: 30, source: null, versions: [{ v: 1, files: { '9:16': 'demo-rough.mp4' }, timeline: null }] }))
fs.writeFileSync(path.join(dir, 'source/rules.json'), JSON.stringify({ active: [], params: {}, overrides: {} }))
fs.writeFileSync(path.join(dir, 'output/demo-rough.mp4'), Buffer.alloc(1000, 7))

const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video.mjs')
const server = spawn(process.execPath, [engine, 'serve'], { env: { ...process.env, VIDEO_EDITOR_DIR: home, VIDEO_EDITOR_PORT: `${port}` } })
const base = `http://127.0.0.1:${port}/demo/`
test.after(() => server.kill())

const up = async () => {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base + 'api/project').then(() => true, () => false)) return
    await new Promise(ok => setTimeout(ok, 100))
  }
}
const save = comments => fetch(base + 'api/reviews/v1', { method: 'POST', body: JSON.stringify({ comments }) })
const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'files/reviews/v1.json'), 'utf8'))

test('reviews are written with their envelope', async () => {
  await up()
  assert.equal((await save([{ id: 'a1', type: 'comment', t0: 1, t1: 2, text: 'x', resolved: false }])).status, 200)
  const r = onDisk()
  assert.equal(r.version, 'v1')
  assert.equal(r.video.file, 'demo-rough.mp4')
  assert.equal(r.comments[0].id, 'a1')
  assert.equal((await save([])).status, 200)
  assert.equal((await fetch(base + 'api/reviews/v9', { method: 'POST', body: '{"comments":[]}' })).status, 400)
})

test("a stale studio tab keeps Claude's answers", async () => {
  fs.writeFileSync(path.join(dir, 'files/reviews/v1.json'), JSON.stringify({ comments: [{ id: 'a1', text: 'x', resolved: true, reply: 'done' }] }))
  await save([{ id: 'a1', text: 'x', resolved: false }])
  assert.deepEqual(onDisk().comments[0], { id: 'a1', text: 'x', resolved: true, reply: 'done' })
  // a tab that saw the reply may reopen the item
  await save([{ id: 'a1', text: 'x', resolved: false, reply: 'done' }])
  assert.equal(onDisk().comments[0].resolved, false)
})

test('only PNG frames, under a plain id', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
  assert.equal((await fetch(base + 'api/review-image?id=abc123', { method: 'POST', body: png })).status, 200)
  assert.ok(fs.existsSync(path.join(dir, 'assets/review/frame-abc123.png')))
  assert.equal((await fetch(base + 'api/review-image?id=../x', { method: 'POST', body: png })).status, 400)
  assert.equal((await fetch(base + 'api/review-image?id=abc124', { method: 'POST', body: 'text' })).status, 400)
})

test('nothing outside the project, no foreign site', async () => {
  assert.equal((await fetch(base + 'video/..%2F..%2Fsource%2Fproject.json')).status, 404)
  assert.equal((await fetch(base + 'api/reviews/v1', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{"comments":[]}' })).status, 403)
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope/api/project`)).status, 404)
})

test('videos answer byte ranges', async () => {
  const r = await fetch(base + 'video/demo-rough.mp4', { headers: { Range: 'bytes=100-199' } })
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('content-range'), 'bytes 100-199/1000')
  assert.equal((await r.arrayBuffer()).byteLength, 100)
})
