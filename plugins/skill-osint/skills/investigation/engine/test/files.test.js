import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { sha256File } from '../lib/util.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FIXTURES, json, read, run } from './helpers.js'

const MEDIA = { OSINT_TYPES: path.join(FIXTURES, 'types-files') }
const NEWM = ['new', 'media', '--question', 'Where is it?', '--frame', 'image_may_leave=false', '--frame', 'noisy=never']
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg')

test('new --file copies the file into Evidence as E01, hashed and read-only; the case is named after the file', async () => {
  const home = casesFolder(), photo = path.join(home, 'Été à Évora (1).JPG')
  fs.copyFileSync(TEMPLE, photo)
  const r = await run(home, [...NEWM, '--file', photo], MEDIA)
  assert.equal(r.status, 0, r.err)
  const dir = path.join(home, 'ete-a-evora-1'), c = json(dir, '.osint/case.json')
  assert.deepEqual(c.input, { source: 'photo', photo: 'Evidence/E01-Été à Évora (1).JPG' })
  assert.deepEqual([c.evidence[0].id, c.evidence[0].kind, c.evidence[0].input, c.evidence[0].sha256], ['E01', 'original', 'photo', sha256File(photo)])
  assert.equal(readNote(path.join(dir, 'Case.md')).props.input, '[[E01-Été à Évora (1).JPG]]')
  assert.match(read(dir, 'Case.md'), /!\[\[E01-Été à Évora \(1\)\.JPG\]\]/)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, c.input.photo)).mode & 0o222, 0)
  assert.ok(fs.existsSync(photo))
})

test('a file input takes HEIC, and refuses what its accept does not take, a missing file, a file where the form shows none', async () => {
  const home = casesFolder(), heic = path.join(home, 'IMG_0042.HEIC'), mov = path.join(home, 'clip.mov')
  fs.writeFileSync(heic, 'heic bytes'); fs.writeFileSync(mov, 'mov bytes')
  const ok = await run(home, [...NEWM, '--file', heic], MEDIA)
  assert.equal(ok.status, 0, ok.err)
  assert.ok(fs.existsSync(path.join(home, 'img-0042', 'Evidence', 'E01-IMG_0042.HEIC')))
  for (const [argv, err] of [
    [[...NEWM, '--file', mov], /--in photo: clip\.mov is not image\/\*/],
    [[...NEWM, '--file', path.join(home, 'nope.jpg')], /--in photo: no file/],
    [[...NEWM], /missing input photo/],
    [[...NEWM, '--in', 'source=clip', '--in', `photo=${heic}`], /--in photo only goes with source=clip|photo only goes with source=photo/],
  ]) {
    const r = await run(home, argv, MEDIA)
    assert.equal(r.status, 1, argv.join(' '))
    assert.match(r.err, err)
  }
})

test('a video by link stays a link (intake fetches it); an image by URL is downloaded as E01', async () => {
  const fake = await startFake()
  try {
    const home = casesFolder()
    const r = await run(home, [...NEWM, '--in', 'source=clip', '--in', 'clip=https://video.example/watch?v=abc', '--title', 'walk'], MEDIA)
    assert.equal(r.status, 0, r.err)
    const c = json(path.join(home, 'walk'), '.osint/case.json')
    assert.deepEqual([c.input.clip, c.evidence], ['https://video.example/watch?v=abc', []])
    const r2 = await run(home, [...NEWM, 'https://durand-bakery.example/img/vitrine.jpg'], { ...MEDIA, ...fakeEnv(fake.url) })
    assert.equal(r2.status, 0, r2.err)
    const c2 = json(path.join(home, 'vitrine'), '.osint/case.json')
    assert.deepEqual([c2.input.photo, c2.evidence[0].kind], ['Evidence/E01-vitrine.jpg', 'original'])
    const gone = await run(home, [...NEWM, 'https://durand-bakery.example/img/none.jpg', '--title', 'none'], { ...MEDIA, ...fakeEnv(fake.url) })
    assert.equal(gone.status, 1)
    assert.match(gone.err, /answered 404/)
  } finally { fake.close() }
})

test('an original downloaded from a link keeps its URL in case.json', async () => {
  const fake = await startFake()
  try {
    const home = casesFolder()
    assert.equal((await run(home, [...NEWM, 'https://durand-bakery.example/img/vitrine.jpg', '--title', 'kept'], { ...MEDIA, ...fakeEnv(fake.url) })).status, 0)
    assert.equal(json(path.join(home, 'kept'), '.osint/case.json').evidence[0].url, 'https://durand-bakery.example/img/vitrine.jpg')
  } finally { fake.close() }
})

test('a pivot names a file of its parent\'s Evidence: the child case starts from its own copy of it', async () => {
  const home = casesFolder(), photo = path.join(FIXTURES, 'images', 'evora-temple.jpg')
  assert.equal((await run(home, [...NEWM, '--file', photo], MEDIA)).status, 0)
  const r = await run(home, ['new', 'media', 'E01-evora-temple.jpg', '--parent', 'evora-temple', '--from', 'Entities/E01-evora-temple.jpg.md', '--question', 'Same picture, another question?'], MEDIA)
  assert.equal(r.status, 0, r.err)
  const [p, c] = ['evora-temple', 'evora-temple-2'].map(s => json(path.join(home, s), '.osint/case.json'))
  assert.deepEqual([c.evidence[0].file, c.evidence[0].sha256], ['Evidence/E01-evora-temple.jpg', p.evidence[0].sha256])
  const none = await run(home, ['new', 'media', 'E07', '--parent', 'evora-temple', '--question', 'Q?', '--title', 'none'], MEDIA)
  assert.equal(none.status, 1)
  assert.match(none.err, /no file E07/)
})
