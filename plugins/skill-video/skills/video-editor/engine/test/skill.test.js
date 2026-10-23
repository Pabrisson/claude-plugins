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
