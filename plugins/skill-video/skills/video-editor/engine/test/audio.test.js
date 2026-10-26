import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// audio.py from its command line, on a throwaway folder; ffmpeg measures what it makes
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-audio-'))
const audio = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'audio.py')
const at = rel => path.join(dir, rel)
const ffmpeg = (...argv) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...argv], { encoding: 'utf8' })
const truePeak = file => +ffmpeg('-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-').stderr.match(/True peak:\s+Peak:\s+(-?[\d.]+)/)[1]
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('the mix stays under -1.5 dBTP (true peak): room for AAC to overshoot', { timeout: 120000 }, () => {
  // bursts of a 12 kHz sine whose samples fall 3 dB under its crests, loud enough for the limiter (none at 0: the
  // meter's resampler reads a crest at the very start of a file)
  fs.writeFileSync(at('sound.py'), 'from audio import *\n\ndef sound(v):\n    t = secs(v.duration)\n    return np.sin(2 * np.pi * 12000 * t + np.pi / 4) * ((t % 1) > .995)\n')
  fs.writeFileSync(at('plan.json'), JSON.stringify({ duration: 4, voice: null, sound: at('sound.py'), cues: [], words: [], clips: [], out: at('mix.wav') }))
  execFileSync('uv', ['run', '--quiet', audio, at('plan.json')])
  assert.ok(truePeak(at('mix.wav')) <= -1.5, `mix.wav at ${truePeak(at('mix.wav'))} dBTP`)
})

test('sync places a short source in a long recording, not on a lookalike at its edge', { timeout: 120000 }, () => {
  // the source: 45 s of speech. The other recording, under its own noise: the source's last 6 s (a lookalike at
  // its start), 4 s of silence, then the whole speech, which puts the source 15 s in
  const speech = path.join(path.dirname(audio), 'test/speech.mp4')
  ffmpeg('-i', speech, '-ss', '5', '-t', '45', '-ac', '1', '-ar', '48000', at('a.wav'))
  ffmpeg('-i', at('a.wav'), '-i', speech, '-filter_complex', '[0]atrim=39,asetpts=N/SR/TB[e];anullsrc=r=48000:cl=mono:d=4[g];[1]aformat=sample_rates=48000:channel_layouts=mono[s];' +
    '[e][g][s]concat=n=3:v=0:a=1[c];anoisesrc=r=48000:a=0.02:c=pink:seed=3[n];[c][n]amix=inputs=2:duration=first:normalize=0', '-ac', '1', at('b.wav'))
  const { sync, r } = JSON.parse(execFileSync('uv', ['run', '--quiet', audio, '--sync', at('a.wav'), at('b.wav')], { encoding: 'utf8' }))
  assert.ok(Math.abs(sync - 15) < 0.01 && r > 0.7, `sync ${sync} (r ${r})`)
})
