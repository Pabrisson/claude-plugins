import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
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
  fs.mkdirSync(path.join(home, 'chk/.cache'), { recursive: true })
  fs.writeFileSync(path.join(home, 'chk/.cache/parts.json'), JSON.stringify([{ kind: 'hook', t0: 0, t1: 2 }, { kind: 'cta', t0: 17, t1: 20 }]))
  const log = (() => { try { return cli('check', '-p', 'chk') } catch (e) { return e.stdout } })()
  assert.match(log, /✗ duration: 20 s, the pack wants 30 to 75 s/)
  assert.match(log, /✓ hook: part\('hook'\) starts at 0 s/)
  assert.match(log, /✓ CTA ends at 20 s/)
})

const ffmpeg = (...argv) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { cwd: home })
const failing = (...argv) => { try { return cli(...argv) } catch (e) { return e.stdout } }
// [r, g, b] of one pixel of an image
const pixel = (rel, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(home, rel), '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]

test('the actors keep their place and size in every resolution (stills draw in 720p)', { timeout: 120000 }, () => {
  cli('init', 'cast', '--formats', '9:16', '--renders', '720p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'cast/source/edit.json'), JSON.stringify({ duration: 2 }))
  fs.writeFileSync(path.join(home, 'cast/source/scene.js'), 'export default async function scene() {}')
  // a red card over the bottom right quarter of the frame
  fs.mkdirSync(path.join(home, 'cast/actors'))
  fs.writeFileSync(path.join(home, 'cast/actors/card.json'), JSON.stringify({ id: 'c', type: 'card', x: 810, y: 1440, w: 540, h: 960, radius: 0, fill: 'red' }))
  cli('stills', '1', '-p', 'cast')
  const [r, g] = pixel('cast/stills/9x16/t01.00.jpg', 700, 1200)
  assert.ok(r > 150 && g < 110, `${r}, ${g}: the card is not at the bottom right`)
  assert.ok(pixel('cast/stills/9x16/t01.00.jpg', 300, 600).every(x => x > 200), 'the card is not at the bottom right')
})

test("check measures the actors' texts too", { timeout: 300000 }, () => {
  cli('init', 'acted', '--formats', '9:16', '--renders', '720p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'acted/source/edit.json'), JSON.stringify({ duration: 3 }))
  fs.writeFileSync(path.join(home, 'acted/source/scene.js'), 'export default async function scene() {}')
  fs.mkdirSync(path.join(home, 'acted/actors'))
  fs.writeFileSync(path.join(home, 'acted/actors/texts.json'), JSON.stringify([{ id: 'low', type: 'text', text: 'Bas de *écran*', y: 1750 }, { id: 'tiny', type: 'chip', text: 'minuscule', size: 14, y: 800 }]))
  cli('stills', '-p', 'acted')
  const log = failing('check', '-p', 'acted')
  assert.match(log, /✗ 9:16: "Bas de écran" in the platforms' interface zones/)
  assert.match(log, /✗ 9:16: "minuscule" too small to read on a phone/)
})

test("without speech the transcript is the say() lines, else the texts shown: this format's actors, each text while it shows", { timeout: 120000 }, () => {
  cli('init', 'shown', '--formats', '1:1,9:16', '--renders', '720p', '--rules', 'none')
  // a cut: the scene's own time still runs to 6 s
  fs.writeFileSync(path.join(home, 'shown/source/edit.json'), JSON.stringify({ duration: 6, cut: [[2, 2.5]] }))
  fs.writeFileSync(path.join(home, 'shown/source/scene.js'), 'export default async function scene() {}')
  fs.mkdirSync(path.join(home, 'shown/actors'))
  fs.writeFileSync(path.join(home, 'shown/actors/a.json'), JSON.stringify([{ id: 'k', type: 'text', text: 'Avant', from: 1, to: 5, keys: [[3, { text: 'Après' }]] },
    { id: 'h', type: 'chip', text: 'Caché', formats: { '1:1': { hidden: true } } }, { id: 'f', type: 'chip', text: 'Fin', from: 5.2 }]))
  const lines = () => JSON.parse(read('shown/assets/words.json')).map(w => [w.w, w.t0, w.t1])
  cli('stills', '1', '-p', 'shown')
  assert.deepEqual(lines(), [['Avant', 1, 3], ['Après', 3, 5], ['Fin', 5.2, 6]])
  fs.writeFileSync(path.join(home, 'shown/source/scene.js'), "export default async function scene({ say }) { say('Ce que dit la scène', 0, 6) }")
  cli('stills', '1', '-p', 'shown')
  assert.deepEqual(lines(), [['Ce que dit la scène', 0, 6]])
})

test('the page warns of a tween placed before 0', { timeout: 120000 }, () => {
  cli('init', 'early', '--formats', '16:9', '--renders', '720p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'early/source/edit.json'), JSON.stringify({ duration: 2 }))
  fs.writeFileSync(path.join(home, 'early/source/scene.js'), 'export default async function scene({ stage, tl }) { tl.to(stage, { opacity: 0.5, duration: 1 }, -0.5) }')
  const r = spawnSync(process.execPath, [engine, 'stills', '1', '-p', 'early'], { env: { ...process.env, VIDEO_EDITOR_DIR: home }, encoding: 'utf8' })
  assert.match(r.stderr, /page: a tween starts at -0\.5 s/)
})

test('the scene knows the resolution it draws, by name and in pixels', { timeout: 120000 }, () => {
  cli('init', 'res', '--formats', '9:16', '--renders', '1080p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'res/source/edit.json'), JSON.stringify({ duration: 1 }))
  fs.writeFileSync(path.join(home, 'res/source/scene.js'), "export default async function scene({ cue, resolution, size }) { cue('res', 0, { resolution, size }) }")
  cli('stills', '0.5', '-p', 'res')
  assert.deepEqual(JSON.parse(read('res/.cache/cues.json')), [{ kind: 'res', t: 0, resolution: '', size: [720, 1280] }])
  cli('render', '-p', 'res')
  assert.deepEqual(JSON.parse(read('res/.cache/cues.json')), [{ kind: 'res', t: 0, resolution: '1080p', size: [1080, 1920] }])
})

test('a chunk whose page Chrome loses renders again on a new page', { timeout: 120000 }, async () => {
  cli('init', 'crash', '--formats', '16:9', '--renders', '720p', '--fps', '30', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'crash/source/edit.json'), JSON.stringify({ duration: 8 }))
  // 25 ms a frame: the render lasts long enough to lose its page
  fs.writeFileSync(path.join(home, 'crash/source/scene.js'), `export default async function scene({ stage, tick }) {
    stage.innerHTML = '<h1>Hi</h1>'
    tick(() => { for (const end = performance.now() + 25; performance.now() < end;); })
  }`)
  const child = spawn(process.execPath, [engine, 'render', '-p', 'crash', '--workers', '1'], { env: { ...process.env, VIDEO_EDITOR_DIR: home } })
  let log = ''
  child.stdout.on('data', d => (log += d))
  child.stderr.on('data', d => (log += d))
  const exited = new Promise(ok => child.on('exit', ok)), done = () => { try { return JSON.parse(read('crash/.cache/progress.json')).steps.at(-1).done } catch { return 0 } }
  while (!(done() >= 1)) await new Promise(ok => setTimeout(ok, 50))
  // the renderers of that render's Chrome die
  const below = pid => spawnSync('pgrep', ['-P', `${pid}`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).flatMap(x => [x, ...below(x)])
  for (const pid of below(child.pid)) if (/--type=renderer/.test(spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout)) process.kill(+pid, 'SIGKILL')
  assert.equal(await exited, 0, log)
  assert.match(log, /Chrome lost a page at frame \d+, rendering that chunk again/)
  assert.match(log, /240 frames, 4\/4 chunks rendered/)
})

test('check samples the layout of every format: platform zones, tiny text, text cut by the frame', { timeout: 300000 }, () => {
  cli('init', 'lay', '--formats', '9:16,16:9', '--renders', '720p', '--rules', 'none')
  fs.writeFileSync(path.join(home, 'lay/source/edit.json'), JSON.stringify({ duration: 3 }))
  fs.writeFileSync(path.join(home, 'lay/source/scene.js'), `export default async function scene({ stage, format }) {
    stage.innerHTML = format === '9:16'
      ? '<p style="position:absolute;left:100px;top:1700px;margin:0;font-size:60px">Bas de écran</p>' +
        '<p style="position:absolute;left:100px;top:800px;margin:0;font-size:14px">minuscule</p>' +
        '<p style="position:absolute;left:300px;top:1000px;margin:0;font-size:60px;white-space:nowrap">Coupé par le bord droit du cadre</p>' +
        '<h1 style="position:absolute;left:-200px;top:400px;margin:0;font-size:400px;white-space:nowrap">GÉANT</h1>' +
        '<p data-say="" style="position:absolute;left:100px;top:1800px;margin:0;font-size:12px">décor</p>'
      : '<h1 style="position:absolute;left:200px;top:300px;margin:0;font-size:120px">Propre</h1>'
  }`)
  cli('stills', '-p', 'lay')
  const log = failing('check', '-p', 'lay')
  assert.match(log, /✗ 9:16: "Bas de écran" in the platforms' interface zones from 00:00\.00 to 00:03\.00/)
  assert.match(log, /✗ 9:16: "minuscule" too small to read on a phone/)
  assert.match(log, /✗ 9:16: "Coupé par le bord droit du cadre" cut by the frame/)
  assert.doesNotMatch(log, /GÉANT|décor/)
  assert.match(log, /✓ 16:9: no text in the platforms' zones, too small, cut by the frame or over a face/)
})

test('check flags a text over the face the camera shows, not one over a card that hides it', { timeout: 300000 }, () => {
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'face.mp4')
  cli('init', 'face', '--formats', '16:9', '--renders', '720p', '--rules', 'none', '--source', path.join(home, 'face.mp4'))
  cli('rules', 'set', 'face_framing=true', '-p', 'face')
  // a face found at the middle of the frame, eyes at 150 px, 120 px tall (no detection: the file is there)
  fs.writeFileSync(path.join(home, 'face/assets/frames.json'), JSON.stringify({ fps: 5, faces: [[0, 320, 150, 120], [4, 320, 150, 120]] }))
  cli('prepare', '-p', 'face')
  fs.writeFileSync(path.join(home, 'face/source/scene.js'), `export default async function scene({ stage, tl, camera }) {
    stage.append(camera())
    stage.insertAdjacentHTML('beforeend', '<h2 id="t" style="position:absolute;left:700px;top:400px;margin:0;font-size:80px;color:#fff">Sur le visage</h2>' +
      '<div id="card" style="position:absolute;inset:0;background:#123;opacity:0"><h2 style="position:absolute;left:700px;top:400px;margin:0;font-size:80px;color:#fff">Sur la carte</h2></div>')
    tl.set('#card', { opacity: 1 }, 2)
    tl.set('#t', { opacity: 0 }, 2)
  }`)
  cli('stills', '-p', 'face')
  const log = failing('check', '-p', 'face')
  assert.match(log, /✗ 16:9: "Sur le visage" over the face from 00:00\.00 to 00:02\.00/)
  assert.doesNotMatch(log, /Sur la carte/)
})

test('prepare lists the still screens of the source (freezes) and the shots of the clips (shots, even without a source)', { timeout: 120000 }, () => {
  // 2 s moving, 3 s of a still red screen, 2 s moving again
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=25:d=3', '-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=25',
    '-filter_complex', '[2]trim=duration=2,setpts=PTS-STARTPTS[m];[0][1][m]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'shots.mp4')
  cli('init', 'screen', '--formats', '16:9', '--renders', '720p', '--rules', 'tutorial', '--source', path.join(home, 'shots.mp4'))
  assert.match(cli('prepare', '-p', 'screen'), /still screen: 1 stretch/)
  assert.match(read('screen/files/freezes.md'), /\*\*00:02\.00 → 00:05\.00\*\* 3 s kept, nothing said/)
  assert.throws(() => cli('prepare', '-p', 'demo'), /nothing to prepare/)
  cli('init', 'trip', '--formats', '16:9', '--renders', '720p', '--rules', 'montage')
  fs.writeFileSync(path.join(home, 'trip/source/edit.json'), JSON.stringify({ duration: 5, media: { a: { src: path.join(home, 'shots.mp4') }, b: { src: path.join(home, 'shots.mp4'), from: 2 } } }))
  cli('prepare', '-p', 'trip')
  assert.match(read('trip/files/shots.md'), /shots\.mp4 \([\d.]+ s\)\n- 00:00\.00 → 00:02\.00 \(2 s\)\n- 00:02\.00 → 00:05\.00 \(3 s\)\n- 00:05\.00 → 00:0[67]/)
  assert.equal(read('trip/files/shots.md').match(/^## /gm).length, 1)
})

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

test('a rush keeps only its #t= range, alone or joined to others', { timeout: 120000 }, () => {
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'long.mp4')
  cli('init', 'part', '--formats', '16:9', '--renders', '720p', '--rules', 'none', '--source', `${path.join(home, 'long.mp4')}#t=1.5,2.5`)
  assert.ok(Math.abs(JSON.parse(read('part/source/project.json')).source.duration - 1) < 0.05)
  cli('init', 'parts2', '--formats', '16:9', '--renders', '720p', '--rules', 'none', '--source', `${path.join(home, 'long.mp4')}#t=0:03`, '--source', `${path.join(home, 'long.mp4')}#t=0,0.4`)
  assert.deepEqual(JSON.parse(read('parts2/source/project.json')).source.files.map(x => x.duration), [1, 0.4])
  assert.throws(() => cli('init', 'bad', '--formats', '16:9', '--renders', '720p', '--source', `${path.join(home, 'long.mp4')}#t=3,2`), /range/)
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

test('a draft is the main format alone, sharp, in 720p; the delivery gets subtitles and the description', { timeout: 300000 }, () => {
  fs.appendFileSync(path.join(home, 'parts/About.md'), '\n## Description\nHey, the title\n#demo\n')
  cli('render', '-p', 'parts', '--type', '720p', '--format', '16:9')
  cli('final', '-p', 'parts')
  assert.match(read('parts/output/parts.srt'), /^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\nHey\n/)
  assert.match(read('parts/output/parts.vtt'), /^WEBVTT\n\n00:00:00\.\d{3} --> /)
  assert.equal(read('parts/output/parts-description.txt'), 'Hey, the title\n#demo\n')
  const final = () => spawnSync(process.execPath, [engine, 'final', '-p', 'parts'], { env: { ...process.env, VIDEO_EDITOR_DIR: home }, encoding: 'utf8' })
  // the sound alone changed: the renders still show the scene. Bursts of noise, which AAC pushes over the mix's peak
  fs.writeFileSync(path.join(home, 'parts/source/sound.py'), 'from audio import *\n\ndef sound(v):\n    rng, x = np.random.default_rng(1), bus(v.n)\n' +
    '    for k in range(int(v.duration * 8)):\n        place(x, k / 8 + .06, rng.standard_normal((2, 4800)) * np.exp(-np.arange(4800) / 400))\n    return x\n')
  assert.doesNotMatch(final().stderr, /rendered before/)
  // the delivered file itself stays under -1 dBTP
  const peak = +spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path.join(home, 'parts/output/parts-16x9-720p.mp4'), '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/True peak:\s+Peak:\s+(\S+)/)[1]
  assert.ok(peak <= -1, `${peak} dBTP`)
  const scene = path.join(home, 'parts/source/scene.js')
  fs.writeFileSync(scene, fs.readFileSync(scene, 'utf8').replace('Hey', 'Ho'))
  // the scene changed since the render: final says so
  const stale = final()
  assert.match(stale.stderr, /16:9 720p was rendered before the last change of the scene: run render again/)
  cli('render', '-p', 'parts', '--draft', '--blur', '4')
  const log = cli('final', '-p', 'parts', '--draft')
  assert.match(log, /final v5 \(draft\)/)
  const { versions } = JSON.parse(read('parts/source/project.json'))
  assert.deepEqual([versions.at(-1).draft, versions.at(-1).files], [true, { '16:9': 'parts-16x9-draft.mp4' }])
  assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(home, 'parts/output/parts-16x9-draft.mp4')], { encoding: 'utf8' }), /^1280,720/)
})

test('sync places a second camera by its sound; it follows the source, silent', { timeout: 300000 }, () => {
  // the same sound twice: bursts of noise, the second camera started 0.7 s before the source
  const sound = "aevalsrc='(random(0)-0.5)*gt(sin(2*PI*1.3*t)*sin(2*PI*0.37*t)\\,0.2)':s=48000:d=8"
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=8', '-f', 'lavfi', '-i', sound, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'main.mp4')
  ffmpeg('-f', 'lavfi', '-i', 'mandelbrot=s=640x360:r=25', '-f', 'lavfi', '-i', sound, '-filter_complex', '[1]adelay=700|700[a]', '-map', '0', '-map', '[a]', '-t', '9', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'cam2.mp4')
  cli('init', 'duo', '--formats', '16:9', '--renders', '720p', '--rules', 'none', '--source', path.join(home, 'main.mp4'))
  fs.writeFileSync(path.join(home, 'duo/source/edit.json'), JSON.stringify({ cut: [], media: { cam2: { src: path.join(home, 'cam2.mp4') } } }))
  assert.throws(() => cli('sync', 'nope', '-p', 'duo'), /cam2/)
  assert.match(cli('sync', 'cam2', '-p', 'duo'), /media cam2: sync 0\.7\d* \(r (1|0\.9\d*)\), the source starts 0\.7\d* s into its file/)
  assert.ok(Math.abs(JSON.parse(read('duo/source/edit.json')).media.cam2.sync - 0.7) < 0.01)
  fs.writeFileSync(path.join(home, 'duo/assets/words.json'), '[]')
  fs.writeFileSync(path.join(home, 'duo/assets/timeline.json'), JSON.stringify({ fps: 25, speed: 1, segments: [[0, 8]] }))
  cli('prepare', '-p', 'duo')
  fs.writeFileSync(path.join(home, 'duo/source/scene.js'), `export default async function scene({ stage, camera, clip }) { stage.append(camera(), clip('cam2', 2)) }`)
  cli('stills', '2', '-p', 'duo')
  // its frames start where the source does, 0.7 s into its file, and the source carries the sound
  assert.deepEqual(JSON.parse(read('duo/.cache/media/cam2/meta.json')).want.from, 0.7)
  assert.deepEqual(JSON.parse(read('duo/.cache/clips.json')), [])
})

test('beats lays the grid of a tempo or measures a track; fix corrects a spoken word; thumbnail composes 16:9', { timeout: 300000 }, () => {
  cli('init', 'beat', '--formats', '9:16', '--renders', '720p', '--rules', 'montage')
  assert.throws(() => cli('beats', '120', '-p', 'beat'), /set "duration"/)
  fs.writeFileSync(path.join(home, 'beat/source/edit.json'), JSON.stringify({ duration: 6 }))
  // the grid comes before the scene
  cli('beats', '120', '--at', '0.5', '-p', 'beat')
  fs.writeFileSync(path.join(home, 'beat/source/scene.js'), `export default async function scene({ stage, thumbnail }) {
    stage.innerHTML = thumbnail ? '<h1 style="font-size:200px">Miniature</h1>' : '<h1>Short</h1>'
  }`)
  assert.deepEqual(JSON.parse(read('beat/files/beats.json')).beats, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6])
  assert.match(read('beat/files/beats.md'), /120 bpm, a beat every 0\.5 s, a bar every 2 s \(4\/4\)\. VIDEO seconds, the track from 0\.5 s\.\n\n- bar 1: 00:00\.50 · 00:01\.00 · 00:01\.50 · 00:02\.00\n/)
  ffmpeg('-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t-0.25\\,0.5)\\,0.02)\\,sin(2*PI*3000*t)\\,0)':s=48000:d=10", 'clicks.mp3')
  cli('beats', path.join(home, 'clicks.mp3'), '-p', 'beat')
  assert.ok(Math.abs(JSON.parse(read('beat/files/beats.json')).bpm - 120) < 1)
  cli('thumbnail', '-p', 'beat')
  assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(home, 'beat/output/beat-thumbnail.jpg')], { encoding: 'utf8' }), /^1280,720/)
  fs.writeFileSync(path.join(home, 'face/assets/words.json'), JSON.stringify([{ w: 'Sécur', t0: 1, t1: 1.3 }, { w: 'sus.', t0: 1.3, t1: 1.5 }, { w: 'Merci', t0: 2, t1: 2.4 }]))
  cli('fix', '1.02', 'Secursus.', '-p', 'face')
  cli('fix', '1.3', '', '-p', 'face')
  assert.deepEqual(JSON.parse(read('face/assets/words.json')).map(w => w.w), ['Secursus.', 'Merci'])
  assert.match(read('face/files/words.md'), /Secursus\.\n- \*\*00:02\.00\*\* Merci/)
  assert.throws(() => cli('fix', '30', 'x', '-p', 'face'), /no spoken word/)
})

test('the progress log: the commands and Claude log their steps, a command that dies leaves its step failed', { timeout: 300000 }, () => {
  const steps = () => JSON.parse(read('wait/.cache/progress.json')).steps.map(x => [x.label, x.by, x.state, x.done ?? null, x.total ?? null])
  cli('init', 'wait', '--formats', '16:9', '--renders', '720p', '--rules', 'none')
  assert.deepEqual(steps(), [['Project created', 'engine', 'done', null, null]])
  cli('status', 'Writing', 'the brief', '-p', 'wait')
  cli('status', 'Writing the scene', '-p', 'wait')
  fs.writeFileSync(path.join(home, 'wait/source/edit.json'), JSON.stringify({ duration: 5 }))
  fs.writeFileSync(path.join(home, 'wait/source/scene.js'), 'export default async function scene({ stage }) { stage.innerHTML = "<h1>Hi</h1>" }')
  assert.throws(() => cli('final', '-p', 'wait'), /no render/)
  cli('render', '-p', 'wait')
  assert.deepEqual(steps(), [
    ['Project created', 'engine', 'done', null, null],
    ['Writing the brief', 'claude', 'done', null, null],
    ['Writing the scene', 'claude', 'running', null, null],
    ['Delivering the video', 'engine', 'failed', null, null],
    ['Rendering 16:9 720p', 'engine', 'done', 3, 3],
  ])
  assert.throws(() => cli('status', '-p', 'wait'), /usage: status/)
})

test('ElevenLabs (faked): only what elevenlabs.json turns on; a voice-over becomes the source, timed by the voice and never transcribed; Scribe v2 transcribes with the vocabulary; music is made once, a refused effect says so; credits estimates', { timeout: 120000 }, () => {
  const mock = path.join(home, 'eleven.mjs'), calls = path.join(home, 'eleven.log'), text = 'Bonjour à tous, voici Secursus.'
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=220:d=3', 'tts.mp3')
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=3', '-f', 'lavfi', '-i', 'sine=f=300:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', 'talk.mp4')
  fs.writeFileSync(mock, `import fs from 'node:fs'
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url), form = init.body instanceof FormData ? Object.fromEntries([...new Set(init.body.keys())].map(k => [k, init.body.getAll(k).map(String)])) : init.body
      fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ u, key: init.headers['xi-api-key'], form }) + '\\n')
      const chars = [...${JSON.stringify(text)}], at = chars.map((_, i) => i * 0.09)
      if (u.endsWith('/v1/music')) return new Response(fs.readFileSync(${JSON.stringify(path.join(home, 'tts.mp3'))}), { headers: { 'content-type': 'audio/mpeg' } })
      if (u.endsWith('/v1/sound-generation')) return Response.json({ detail: { message: 'The API key you used is missing the permission sound_generation to execute this operation.' } }, { status: 401 })
      return Response.json(u.includes('/text-to-speech/') ? { audio_base64: fs.readFileSync(${JSON.stringify(path.join(home, 'tts.mp3'))}).toString('base64'),
          alignment: { characters: chars, character_start_times_seconds: at, character_end_times_seconds: at.map(t => t + 0.08) } }
        : { words: [{ text: 'Bonjour', type: 'word', start: 0.2, end: 0.6 }, { text: ' ', type: 'spacing', start: 0.6, end: 0.7 }, { text: '(rires)', type: 'audio_event', start: 0.7, end: 1 }, { text: 'Secursus.', type: 'word', start: 1, end: 1.6 }] })
    }`)
  const eleven = (...argv) => execFileSync(process.execPath, ['--import', mock, engine, ...argv], { env: { ...process.env, VIDEO_EDITOR_DIR: home, ELEVENLABS_API_KEY: 'k-test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const log = () => read('eleven.log').trim().split('\n').map(l => JSON.parse(l))

  cli('init', 'both', '--formats', '9:16', '--renders', '720p', '--rules', 'none', '--source', path.join(home, 'talk.mp4'))
  assert.throws(() => cli('elevenlabs', 'set', 'voice=v1', '-p', 'both'), /voice-over becomes the source/)
  cli('init', 'vo', '--formats', '9:16', '--renders', '720p', '--rules', 'none')
  // nothing goes to ElevenLabs before the user chose, nor what they turned off
  assert.match(cli('elevenlabs', '-p', 'vo'), /not chosen for this video yet/)
  assert.throws(() => eleven('voice', '-p', 'vo'), /not chosen for this video yet/)
  assert.throws(() => cli('elevenlabs', 'set', 'music=yes', '-p', 'vo'), /music is true or false/)
  assert.throws(() => cli('elevenlabs', 'set', 'look=true', '-p', 'vo'), /look is not one of transcript, voice, music, sfx/)
  assert.match(cli('elevenlabs', 'set', 'voice=v1', 'sfx=true', '-p', 'vo'), /transcript off · voice v1 · music off · sfx on/)
  assert.deepEqual(JSON.parse(read('vo/source/elevenlabs.json')), { transcript: false, voice: 'v1', music: false, sfx: true })
  assert.ok(!/elevenlabs|voice/.test(read('vo/source/style.json') + read('vo/source/project.json')))
  assert.throws(() => eleven('music', 'Warm pads', '--length', '3', '-p', 'vo'), /music by ElevenLabs is off for this video/)
  assert.ok(!fs.existsSync(calls))
  assert.throws(() => eleven('voice', '-p', 'vo'), /source\/voice\.txt/)
  fs.writeFileSync(path.join(home, 'vo/source/voice.txt'), text + '\n')
  assert.match(eleven('voice', '-p', 'vo'), /voice-over: 5 words/)
  const [tts] = log(), p = JSON.parse(read('vo/source/project.json'))
  assert.match(tts.u, /\/v1\/text-to-speech\/v1\/with-timestamps$/)
  assert.equal(tts.key, 'k-test')
  assert.deepEqual(JSON.parse(tts.form), { text, model_id: 'eleven_v4', language_code: 'fr' })
  assert.deepEqual([p.source.voice, p.source.width, p.source.height, p.source.audio], [true, 1080, 1920, true])
  assert.ok(Math.abs(p.source.duration - 3) < 0.1, `${p.source.duration}`)
  const words = read('vo/assets/words.json')
  assert.deepEqual(JSON.parse(words).map(w => w.w), ['Bonjour', 'à', 'tous,', 'voici', 'Secursus.'])
  // prepare (even --force) keeps the voice's words: no transcription, no face to frame on a black picture
  cli('rules', 'set', 'face_framing=true', '-p', 'vo')
  cli('prepare', '--force', '-p', 'vo')
  assert.equal(read('vo/assets/words.json'), words)
  assert.ok(!fs.existsSync(path.join(home, 'vo/assets/frames.json')))
  cli('rough', '-p', 'vo')
  assert.ok(fs.existsSync(path.join(home, 'vo/output/vo-rough.mp4')))

  cli('init', 'sc', '--formats', '16:9', '--renders', '720p', '--rules', 'none', '--source', path.join(home, 'talk.mp4'))
  cli('elevenlabs', 'set', 'transcript=true', '-p', 'sc')
  cli('style', 'set', 'creator.vocabulary=["Secursus","a name far too long to be a keyterm of Scribe v2 at all"]', '-p', 'sc')
  assert.match(eleven('prepare', '-p', 'sc'), /Scribe v2, keyterms: Secursus[\s\S]*transcript: 2 words/)
  const stt = log().at(-1)
  assert.match(stt.u, /\/v1\/speech-to-text$/)
  assert.deepEqual(stt.form.model_id, ['scribe_v2'])
  assert.deepEqual(stt.form.keyterms, ['Secursus'])
  assert.deepEqual(JSON.parse(read('sc/assets/words.json')), [{ w: 'Bonjour', t0: 0.2, t1: 0.6 }, { w: 'Secursus.', t0: 1, t1: 1.6 }])
  // the music and the effects: a file for sound.py's load(), never made again without --force; a refusal is the key's
  cli('elevenlabs', 'set', 'music=true', '-p', 'vo')
  assert.match(eleven('music', 'Warm pads, 120 bpm', '--length', '3', '-p', 'vo'), /music: assets\/sound\/music\.mp3 \(3[.\d]* s\)/)
  assert.deepEqual(JSON.parse(log().at(-1).form), { prompt: 'Warm pads, 120 bpm', music_length_ms: 3000, force_instrumental: true, model_id: 'music_v2_5' })
  assert.throws(() => eleven('music', 'Warm pads', '--length', '3', '-p', 'vo'), /music\.mp3 exists: --force/)
  assert.throws(() => eleven('music', 'Warm pads', '-p', 'vo'), /--length <3 to 600 s>/)
  assert.throws(() => eleven('sfx', 'Soft whoosh', '--length', '0.8', '--name', 'whoosh', '-p', 'vo'), /401 .*missing the permission sound_generation/)
  assert.ok(!fs.existsSync(path.join(home, 'vo/assets/sound/whoosh.mp3')))
  // the estimate before spending: 330 credits a minute of transcript (+20 % with keyterms), 1 a character, 900 a minute
  // of music, 40 a second of effect (200 when ElevenLabs picks the length)
  assert.match(cli('credits', 'transcript=60', 'voice=900', 'music=60', 'sfx=1,0.5,auto', '-p', 'sc'),
    /transcript \(Scribe v2, 60 s, keyterms \+20 %\): 396 credits\nvoice-over \(900 characters\): 900 credits\nmusic \(60 s\): 900 credits\nsound effects \(1 s, 0\.5 s, auto\): 260 credits\ntotal: about 2456 credits/)
  assert.throws(() => cli('credits', 'sfx=40'), /0\.5 to 30/)
  // without a key, the engine says so instead of calling
  assert.throws(() => execFileSync(process.execPath, [engine, 'voices'], { env: { ...process.env, VIDEO_EDITOR_DIR: home, ELEVENLABS_API_KEY: '' }, stdio: 'pipe' }), /no ElevenLabs key/)
})
