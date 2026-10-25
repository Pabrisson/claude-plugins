import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// the CLI on a throwaway projects folder, as the skill drives it
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'video-skill-'))
const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video.mjs')
const cli = (...argv) => execFileSync(process.execPath, [engine, ...argv], { env: { ...process.env, VIDEO_EDITOR_DIR: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const read = rel => fs.readFileSync(path.join(home, rel), 'utf8')
test.after(() => fs.rmSync(home, { recursive: true, force: true }))

test('without VIDEO_EDITOR_DIR the projects folder is where Claude Code runs, or the parent of the video run in', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cwd-')), env = { ...process.env }
  delete env.VIDEO_EDITOR_DIR
  const run = (cwd, ...argv) => execFileSync(process.execPath, [engine, ...argv], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  run(root, 'init', 'here', '--formats', '1:1', '--renders', '720p', '--rules', 'none')
  assert.ok(fs.existsSync(path.join(root, 'here/source/project.json')))
  assert.match(run(path.join(root, 'here/source'), 'doctor'), new RegExp(`projects: .*${path.basename(root)}\\n`))
  fs.rmSync(root, { recursive: true, force: true })
})

test('style set and note write style.json and regenerate STYLE.md; unknown fields are refused', () => {
  cli('style', 'set', 'creator.name=Pierre Alain', 'sound.music=-20', 'look.palette.accent=#e11d48')
  cli('style', 'note', 'Never flat design')
  const s = JSON.parse(read('.style/style.json'))
  assert.equal(s.creator.name, 'Pierre Alain')
  assert.equal(s.sound.music, -20)
  assert.equal(s.look.palette.accent, '#e11d48')
  assert.deepEqual(s.notes, ['Never flat design'])
  assert.match(read('.style/STYLE.md'), /accent `#e11d48`[\s\S]*bed at -20 LUFS[\s\S]*- Never flat design/)
  assert.throws(() => cli('style', 'set', 'colour=red'))
})

test('site sees a page: screens, colors by area, fonts, inline SVGs with their colors; init leaves it in .style', { timeout: 120000 }, () => {
  const page = path.join(home, 'brand.html')
  fs.writeFileSync(page, `<body style="margin:0;background:#fbf4ea;color:#1d1b1d;font-family:Georgia">
    <section style="height:1200px;background:#28272a;color:#f5f5f5;font-weight:700">Dark hero<svg class="hex" viewBox="-15 -15 30 30" width="60" height="60" style="color:#c73a36"><path d="M0-13 11-6.5V6.5L0 13-11 6.5V-6.5Z" fill="currentColor"/></svg></section>
    <section style="height:700px">Cream section with longer text to weigh more than the hero</section></body>`)
  const log = cli('site', `file://${page}`)
  const s = JSON.parse(read('.style/site/site.json'))
  assert.deepEqual(s.screens, ['screen-01.jpg', 'screen-02.jpg', 'screen-03.jpg'])
  assert.deepEqual(s.backgrounds.map(c => c[0]).slice(0, 2).sort(), ['#28272a', '#fbf4ea'])
  assert.equal(s.text[0][0], '#1d1b1d')
  assert.match(s.fonts[0][0], /^Georgia/)
  assert.match(read('.style/site/svg-01.svg'), /fill:rgb\(199, 58, 54\)/)
  assert.ok(fs.statSync(path.join(home, '.style/site/svgs.jpg')).size > 1000)
  assert.match(log, /backgrounds: .*#28272a/)
  cli('style', 'set', 'look.symbols=["the hexagon"]')
  assert.match(read('.style/STYLE.md'), /Symbols of the brand:\n {2}- the hexagon\n/)
  assert.doesNotMatch(read('.style/STYLE.md'), /Paper look/)
})

test('a pack dropped in .rules/ is listed and applies at init, with the style frozen in the project', () => {
  fs.mkdirSync(path.join(home, '.rules'))
  fs.writeFileSync(path.join(home, '.rules/calm.md'), '---\nname: calm\ndescription: Slow test pack\nparams: {"speed": 0.9, "music": true}\n---\n## When writing the scene\n- Take your time.\n')
  assert.match(cli('rules', 'list'), /calm: Slow test pack \[perso\]/)
  cli('init', 'demo', '--formats', '9:16', '--renders', '720p', '--rules', 'calm')
  const rules = JSON.parse(read('demo/source/rules.json'))
  assert.deepEqual(rules.active, ['calm'])
  assert.equal(rules.params.speed, 0.9)
  assert.equal(rules.params.transcribe, true)
  assert.match(read('demo/source/STYLE.md'), /Style of Pierre Alain/)
  cli('style', 'note', 'A later note')
  assert.doesNotMatch(read('demo/source/STYLE.md'), /A later note/)
  assert.ok(!fs.existsSync(path.join(home, 'demo/source/site')))
})

test('one pack per video; rules show gives it with its personal lines, rules set the overrides, check measures the edit', () => {
  fs.mkdirSync(path.join(home, '.rules'), { recursive: true })
  fs.writeFileSync(path.join(home, '.rules/shorts.md'), '---\nextends: shorts\nparams: {"speed": 1.05}\n---\n- Never a tape stop.\n')
  assert.throws(() => cli('init', 'two', '--formats', '9:16', '--renders', '720p', '--rules', 'shorts,youtube'), /one pack per video/)
  cli('init', 'chk', '--formats', '9:16', '--renders', '720p', '--rules', 'shorts')
  assert.match(cli('rules', 'show', '-p', 'chk'), /pack: shorts \[perso \(overrides plugin\)\][\s\S]*"speed":1\.05[\s\S]*hook[\s\S]*Never a tape stop/)
  assert.throws(() => cli('rules', 'set', 'speed=fast', '-p', 'chk'), /speed/)
  cli('rules', 'set', 'speed=1.1', 'hook=2', '-p', 'chk')
  assert.deepEqual(JSON.parse(read('chk/source/rules.json')).overrides, { speed: 1.1, hook: 2 })
  fs.writeFileSync(path.join(home, 'chk/source/edit.json'), JSON.stringify({ duration: 20, cut: [] }))
  fs.writeFileSync(path.join(home, 'chk/source/scene.js'), 'export default async function scene({ captions }) { captions() }')
  assert.throws(() => cli('check', '-p', 'chk'), /run stills first/)
  fs.mkdirSync(path.join(home, 'chk/.cache'))
  fs.writeFileSync(path.join(home, 'chk/.cache/parts.json'), JSON.stringify([{ kind: 'hook', t0: 0, t1: 2 }, { kind: 'cta', t0: 17, t1: 20 }]))
  const log = (() => { try { return cli('check', '-p', 'chk') } catch (e) { return e.stdout } })()
  assert.match(log, /✗ duration: 20 s, the pack wants 30 to 75 s/)
  assert.match(log, /✓ hook: part\('hook'\) starts at 0 s/)
  assert.match(log, /✓ CTA ends at 20 s/)
})

const ffmpeg = (...argv) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { cwd: home })

test('several sources are joined end to end, in order, each fitted into the first one and cut to whole frames', { timeout: 120000 }, () => {
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:r=44100:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'r1.mp4')
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=25:d=1.52', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'r2.mov')
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=24:d=1.2', '-f', 'lavfi', '-i', 'sine=f=880:r=48000:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'r3.mp4')
  const log = cli('init', 'rushes', '--formats', '16:9', '--renders', '720p', '--rules', 'none', ...['r1.mp4', 'r2.mov', 'r3.mp4'].flatMap(x => ['--source', path.join(home, x)]))
  const { source } = JSON.parse(read('rushes/source/project.json'))
  assert.deepEqual(source.files.map(x => [path.basename(x.from), x.at, x.duration]), [['r1.mp4', 0, 2], ['r2.mov', 2, 1.533], ['r3.mp4', 3.533, 1.2]])
  assert.deepEqual([source.width, source.height, source.fps, source.audio], [1280, 720, 30, true])
  assert.ok(Math.abs(source.duration - 4.733) < 0.02, `${source.duration} s`)
  assert.match(log, /video 2: .*r2\.mov from 2 s of the source/)
  assert.match(read('rushes/About.md'), /- Video 3: .*r3\.mp4 \(from 3\.533 s of the source, 1\.2 s\)/)
  assert.deepEqual(fs.readdirSync(path.join(home, 'rushes/assets')).filter(x => x.endsWith('.mp4')), ['source.mp4'])
})

test("a media clip's own sound plays where the scene plays it, a cut inside it included", { timeout: 300000 }, () => {
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'tone.mp4')
  cli('init', 'broll', '--formats', '16:9', '--renders', '720p', '--fps', '30', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'broll/source/edit.json'), JSON.stringify({ duration: 3, cut: [[1.5, 1.8]], media: { tone: { src: path.join(home, 'tone.mp4') } } }))
  fs.writeFileSync(path.join(home, 'broll/source/scene.js'), `export default async function scene({ stage, clip }) {
    const c = clip('tone', 1)
    stage.append(c)
  }`)
  cli('render', '-p', 'broll')
  cli('final', '-p', 'broll')
  assert.deepEqual(JSON.parse(read('broll/.cache/clips.json')), [{ id: 'tone', t: 1, from: 0, dur: 0.5 }, { id: 'tone', t: 1.5, from: 0.8, dur: 0.2 }])
  // the frames keep the clip's size (under the 720p the render needs), its sound sits next to them
  assert.equal(JSON.parse(read('broll/.cache/media/tone/meta.json')).want.short, 720)
  assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', path.join(home, 'broll/.cache/media/tone/00001.jpg')], { encoding: 'utf8' }), /^640/)
  const { step, tracks } = JSON.parse(read('broll/assets/mix.json')), at = t => tracks.clips[Math.round(t / step)]
  // 0.5 s from its start, then the 0.2 s kept after the cut: heard from 1 to 1.7 s of the video
  assert.ok(at(0.95) === -60 && at(1.25) > -3 && at(1.6) > -3 && at(1.75) === -60, JSON.stringify(tracks.clips))
})

test("final keeps the scene's parts and a strip of thumbnails per format for the studio's Video tab", { timeout: 300000 }, () => {
  cli('init', 'parts', '--formats', '16:9,9:16', '--renders', '720p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'parts/source/edit.json'), JSON.stringify({ duration: 3 }))
  fs.writeFileSync(path.join(home, 'parts/source/scene.js'), `export default async function scene({ stage, tl, part }) {
    stage.innerHTML = '<h1 style="font-size:200px">Hey</h1>'
    tl.from(stage.firstChild, { opacity: 0, duration: 1 }, 0.5)
    part('sequence', 0, 2, { name: 'hook', field: 'accent' })
    part('title', 0.5, 1.5)
  }`)
  cli('render', '-p', 'parts')
  cli('final', '-p', 'parts')
  const v = JSON.parse(read('parts/files/video/v1.json'))
  assert.deepEqual(v.parts.map(x => [x.kind, x.t0, x.t1]), [['sequence', 0, 2], ['title', 0.5, 1.5]])
  assert.match(v.parts[0].color, /^#[0-9a-f]{6}$/)
  assert.deepEqual(Object.keys(v.strips), ['16:9', '9:16'])
  assert.equal(v.strips['9:16'].count, 6)
  assert.ok(fs.statSync(path.join(home, 'parts', v.strips['9:16'].file)).size > 1000)
})
