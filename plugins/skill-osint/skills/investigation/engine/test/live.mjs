// test/live.mjs — the demo's « running » case, played in a loop (about two minutes a round): the case made again, its
// phases, progress, a failure, a wait for the user, and an edit as if saved in Obsidian.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ENGINE } from './helpers.js'

const HOME = process.env.OSINT_DIR, SLUG = 'live-demo'
const sleep = s => new Promise(ok => setTimeout(ok, s * 1000))
const osint = (...argv) => new Promise(ok => spawn(process.execPath, [ENGINE, ...argv], { env: process.env, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true }).on('close', ok))
// [seconds to wait first, ...the command]; `edit <note> <text>` appends to a note as Obsidian would
const LEADS = path.join(HOME, '.cache', 'live-leads.json')
export const STEPS = [
  [2, 'log', '--phase', 'frame', 'Reading the question and the frame'],
  [3, 'log', '--phase', 'collect', 'Reading RDAP, DNS and certificates'],
  [2, 'domain', 'collect', '--only', 'rdap'],
  [3, 'domain', 'collect', '--only', 'dns'],
  [3, 'domain', 'collect', '--only', 'crt'],
  [4, 'edit', 'Report.md', 'Noted in Obsidian: ask the bakery about its web agency.'],
  [3, 'log', '--phase', 'process', 'Grouping the records by host'],
  [3, 'entity', 'organization', 'Exemple Hébergement SAS', '--prop', 'role=hosting'],
  [3, 'log', '--phase', 'analyse', 'Weighing who runs live.durand-bakery.example'],
  [2, 'hyp', 'add', 'Run by the bakery itself', '--level', 'owner', '--refute-if', 'a legal notice names someone else'],
  [3, 'hyp', 'add', 'Run by Exemple Hébergement for the bakery', '--level', 'owner', '--refute-if', 'the bakery is named as publisher'],
  [3, 'clue', 'Same name server as durand-bakery.example', '--status', 'observed', '--title', 'Shared name server'],
  [3, 'hyp', 'lr', 'H01', '--clue', 'C02', '--lr', '3', '--why', 'the bakery\'s own name server'],
  [4, 'status', '--set', 'blocked', '--why', 'waiting for the Google Lens results to be pasted'],
  [10, 'status', '--set', 'running'],
  [2, 'next', '--file', LEADS],
]
fs.mkdirSync(path.dirname(LEADS), { recursive: true })
fs.writeFileSync(LEADS, JSON.stringify([{ label: 'Read the archived home page', why: 'see who ran it before', minutes: 5 }]))
for (;;) {
  fs.rmSync(path.join(HOME, SLUG), { recursive: true, force: true })
  await osint('new', 'domain', 'live.durand-bakery.example', '--title', 'Live demo', '--question', 'Who runs live.durand-bakery.example?', '--frame', 'noisy=never')
  for (const [wait, ...argv] of STEPS) {
    await sleep(wait)
    if (argv[0] === 'edit') fs.appendFileSync(path.join(HOME, SLUG, argv[1]), `\n${argv[2]}\n`)
    else await osint(...argv, '-p', SLUG)
  }
  await sleep(30)
}
