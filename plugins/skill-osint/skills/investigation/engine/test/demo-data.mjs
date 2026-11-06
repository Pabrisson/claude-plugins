// test/demo-data.mjs — the demo's cases, made by the real engine against the fake APIs: a finished domain case in
// French, and a child case started from its tracker that shares it (the home page's « Shared entities »).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listCases } from '../lib/case.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { BIN, ENGINE, fakePack, FIXTURES, PATHX } from './helpers.js'

export const osint = (env, ...argv) => new Promise((ok, ko) => {
  const p = spawn(process.execPath, [ENGINE, ...argv], { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
  let out = ''
  p.stdout.on('data', d => (out += d))
  p.on('close', c => (c === 0 ? ok(out) : ko(new Error(`osint ${argv.join(' ')}: exit ${c}`))))
})
const sid = out => /^(S\d+):/m.exec(out)[1]
export const clueId = (dir, fragment) => fs.readdirSync(path.join(dir, 'Clues')).find(f => f.includes(fragment))?.split(' ')[0] ?? null
const json = v => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-demo-')), 'x.json'); fs.writeFileSync(f, JSON.stringify(v)); return f }

// the geolocation case runs the GeoINT scripts' replays (the fake uv, test/fixtures/geoint) on a fake pack in the
// cases folder's cache: never the user's real pack nor its models. The fake binaries are Node scripts run by their
// shebang: no geolocation demo on Windows.
export function demoGeoEnv(home) {
  if (process.platform === 'win32') return {}
  const data = path.join(home, '.cache', 'osint-data')
  fakePack(data)
  return { OSINT_DATA: data, OSINT_UV: path.join(BIN, 'uv'), PATH: PATHX.PATH }
}
const geoState = dir => JSON.parse(fs.readFileSync(path.join(dir, '.osint', 'case.json'), 'utf8')).state['geolocate-image']
const idOf = out => JSON.parse(out).id
const runJournal = (dir, name) => fs.readFileSync(path.join(dir, '.osint', 'runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.script === name).at(-1).journal

// a photo of the Roman temple of Évora (Wikimedia Commons, Dudva, CC BY-SA 4.0), solved and scored against the camera
// location its Commons page gives
async function geolocationDemo(env) {
  if (process.platform === 'win32') return
  const home = env.OSINT_DIR, D = path.join(home, 'evora-temple'), P = ['-p', 'evora-temple']
  const g = env.OSINT_UV ? env : { ...env, ...demoGeoEnv(home) }
  const photo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-demo-')), 'evora-temple.jpg')
  fs.copyFileSync(path.join(FIXTURES, 'images', 'evora-temple.jpg'), photo)
  await osint(g, 'new', 'geolocate-image', '--file', photo, '--question', 'Where was this photo taken?', '--lang', 'en', '--in', 'claim=Taken in Évora, Portugal',
    '--frame', 'image_may_leave=true', '--frame', 'noisy=never', '--frame', 'purpose=Check the place a caption gives before reusing the photo')
  await osint(g, 'log', ...P, '--phase', 'archive', 'The photo is E01: copied, hashed, read-only')
  await osint(g, 'geolocate-image', 'intake', ...P)
  await osint(g, 'log', ...P, '--phase', 'gut', 'Gut call, before any tool')
  await osint(g, 'geolocate-image', 'gut', '--file', json({ ranked: [{ place: 'Portugal', p: 55, cues: 'granite podium, Corinthian columns, dry southern light' }, { place: 'Spain', p: 25, cues: 'Roman ruins in an old town' }, { place: 'Italy', p: 15, cues: 'a Roman temple' }], region: 'Alentejo', would_change: 'a Spanish or Italian sign, plate or language' }), ...P)
  await osint(g, 'log', ...P, '--phase', 'recon', 'GeoINT first pass; looked at the whole photo: nobody in it')
  await osint(g, 'geolocate-image', 'recon', '--no-people', ...P)
  await osint(g, 'log', ...P, '--phase', 'read-search', 'Reading the sign crop, judging the similar images one at a time at full size')
  await osint(g, 'clue', 'Street sign read in its crop: "Largo do Conde de Vila Flor"', '--status', 'read', '--where', '01_sign.jpg', '--journal', runJournal(D, 'recon.py'), '--title', 'Street sign Largo do Conde de Vila Flor', ...P)
  await osint(g, 'reverse', 'verdict', '--file', json([
    { candidate: '#1', page: 'https://pt.wikipedia.org/wiki/Templo_romano_de_%C3%89vora', verdict: 'match', reason: 'the same temple, seen from the same corner', compared: ['six granite columns on the front', 'Corinthian marble capitals', 'the podium of granite blocks', 'the missing columns of the west side'] },
    { candidate: '#2', page: 'https://www.visitportugal.com/en/content/roman-temple-evora', verdict: 'unsure', reason: 'the thumbnail is too small to compare the capitals' },
  ]), ...P)
  const s = geoState(D), sign = clueId(D, 'Street sign'), match = clueId(D, 'Match')
  await osint(g, 'log', ...P, '--phase', 'country', 'A Portuguese street name, read')
  await osint(g, 'hyp', 'lr', s.countries.PT, '--clue', sign, '--lr', '20', '--why', 'a Portuguese street name, read in its crop', ...P)
  await osint(g, 'hyp', 'lr', s.countries.ES, '--clue', sign, '--lr', '0.1', '--why', 'Spanish street names are in Spanish or a regional language', ...P)
  await osint(g, 'log', ...P, '--phase', 'region', 'Which Portuguese town has this temple')
  const region = idOf(await osint(g, 'hyp', 'add', 'Évora, Alentejo', '--level', 'region', '--under', s.countries.PT, '--point', '38.5714,-7.9135', '--radius', '3000', '--refute-if', 'the matched pages name another town', '--json', ...P))
  await osint(g, 'hyp', 'lr', region, '--clue', match, '--lr', '5', '--why', 'the matched page is the temple of Évora', ...P)
  await osint(g, 'log', ...P, '--phase', 'pinpoint', 'Every panorama of the town ranked, then the camera point')
  await osint(g, 'geolocate-image', 'run', 'pano.py', 'list', '--provider', 'panoramax', '--near', '38.5725,-7.9075', '--radius', '3000', '--out', 'town.jsonl', ...P)
  await osint(g, 'geolocate-image', 'sweep', 'index', '--manifest', 'town.jsonl', ...P)
  await osint(g, 'geolocate-image', 'sweep', 'rank', '--index', 'town', ...P)
  await osint(g, 'geolocate-image', 'run', 'geo.py', 'bearing', '38.5725,-7.9075', '38.5728,-7.9072', ...P)
  await osint(g, 'clue', "From this corner the temple's centre lies at bearing 37° (geo.py bearing), as the photo frames it", '--status', 'computed', '--constraint', '--journal', runJournal(D, 'geo.py'), '--title', 'Bearing to the temple centre', ...P)
  const bearing = clueId(D, 'Bearing to the temple')
  await osint(g, 'geolocate-image', 'map', 'add', 'sightline', '--at', '38.5725,-7.9075', '--bearing', '37', '--km', '0.05', '--label', 'temple centre', '--ref', bearing, ...P)
  const spot = idOf(await osint(g, 'hyp', 'add', 'Largo do Conde de Vila-Flor, south-west corner of the temple', '--level', 'point', '--under', region, '--point', '38.5725,-7.9075', '--radius', '30', '--refute-if', 'the temple centre lies at another bearing from there', '--json', ...P))
  await osint(g, 'hyp', 'lr', spot, '--clue', bearing, '--lr', '20', '--why', 'the computed bearing matches the framing', ...P)
  await osint(g, 'hyp', 'lr', spot, '--clue', match, '--lr', '5', '--why', 'the matched photo is taken from the same corner', ...P)
  await osint(g, 'log', ...P, '--phase', 'verify', 'Red team on the camera point')
  await osint(g, 'redteam', '--file', json({ target: spot, outcome: 'survives', refutations: [
    { test: 'Is there a twin temple (Mérida, Nîmes, Vienne)?', result: 'No: the granite podium and the missing west columns are Évora\'s alone' },
    { test: 'Is the photo mirrored?', result: 'No: the panoramas show the same side of the temple' },
  ] }), ...P)
  await osint(g, 'log', ...P, '--phase', 'answer', 'One answer, its radius, its confidence per level')
  await osint(g, 'conclude', '--file', json({ answer: spot, confidence: { country: 'high', region: 'high', street: 'high', point: 'high' },
    criteria: { country: 'a Portuguese street name read on the sign', region: 'a reverse-search match verified on four invariant features', street: 'the panoramas of the square match', point: 'two independent constraints: the computed bearing and the four-feature match' },
    radius_m: 30, alternatives: [{ hyp: s.countries.ES, test: 'a Spanish sign or plate in the photo' }], unresolved: [] }), ...P)
  await osint(g, 'next', '--file', json([{ label: 'When was it taken', why: 'the shadows of the columns give the hour', minutes: 10, prompt: '[geolocate-image:chronolocate] E01-evora-temple.jpg' }]), ...P)
  await osint(g, 'geolocate-image', 'truth', '38.5728,-7.9076', ...P)
  // the bakery's shop-front picture: an image entity, which geolocate-image accepts as a pivot
  await osint(env, 'entity', 'image', 'https://durand-bakery.example/img/vitrine.jpg', '-p', 'durand-bakery-example')
}

const lastClue = dir => fs.readdirSync(path.join(dir, 'Clues')).map(f => f.split(' ')[0]).sort().at(-1)
const lastJournal = dir => [...fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8').matchAll(/\^(j\d{3,})\s*$/gm)].at(-1)?.[1] ?? null
const sourceId = (dir, fragment) => fs.readdirSync(path.join(dir, 'Sources')).find(f => f.includes(fragment))?.split(' ')[0] ?? null
// the verify-media case: a free Wikimedia Commons photo (the Roman temple of Évora, Dudva, CC BY-SA 4.0) going round
// with a false caption made up for the demo — the Temple of Diana in Mérida during the storm of 3 March 2025 —
// refuted by an earlier copy (Commons, 20 November 2021), the place (Évora's cathedral behind it) and that night's
// weather in Mérida; integrity stays at medium (no C2PA manifest)
export async function buildVerifyMedia(base) {
  if (process.platform === 'win32') return
  const home = base.OSINT_DIR, env = base.OSINT_UV ? base : { ...base, ...demoGeoEnv(home) }
  const slug = 'orage-a-merida', D = path.join(home, slug), P = ['-p', slug], cap = n => path.join(FIXTURES, 'first-seen', n)
  await osint(env, 'new', 'verify-media', '--file', path.join(FIXTURES, 'images', 'evora-temple.jpg'), '--title', 'Orage à Mérida', '--lang', 'fr',
    '--question', 'Cette photo montre-t-elle le temple de Diane à Mérida pendant l\'orage du 3 mars 2025 ?',
    '--in', 'claim=Le temple de Diane à Mérida sous l\'orage du 3 mars 2025 (post de @newsdesk_example, repris par news.example)',
    '--frame', 'image_may_leave=true', '--frame', 'noisy=never', '--frame', 'purpose=Vérifier une photo virale avant de la reprendre')
  await osint(env, 'log', ...P, '--phase', 'archive', 'Original copié, haché, mesuré')
  await osint(env, 'verify-media', 'intake', ...P)
  await osint(env, 'log', ...P, '--phase', 'metadata', 'Métadonnées, vignette intégrée, manifeste C2PA')
  await osint(env, 'verify-media', 'meta', ...P)
  await osint(env, 'log', ...P, '--phase', 'reverse', 'Aucune personne dans l\'image : envoi direct à Yandex et Baidu')
  await osint(env, 'verify-media', 'direct', '--no-people', ...P)
  await osint(env, 'log', ...P, '--phase', 'first-seen', 'Pages trouvées, lues une à une et datées')
  await osint(env, 'verify-media', 'first-seen', '--file', json([
    { url: 'https://commons.wikimedia.org/wiki/File:Roman_Temple_of_%C3%89vora_1.jpg', capture: cap('commons-evora.html'), engine: 'yandex', match: 'exact' },
    { url: 'https://blog.example/travel/alentejo-in-three-days', engine: 'yandex', match: 'exact' },
    { url: 'https://social.example/@newsdesk_example/posts/1123', posted: '2025-03-03T21:14:00+01:00', author: '@newsdesk_example', capture: cap('social-post.txt'), engine: 'web', match: 'exact' },
    { url: 'https://news.example/2025/03/04/storm-merida', engine: 'yandex', match: 'exact' },
  ]), ...P)
  await osint(env, 'log', ...P, '--phase', 'claim', 'Le lieu, la date et la météo de la légende')
  await osint(env, 'weather', '--at', '38.9172,-6.3436', '--date', '2025-03-03', '--hour', '20', ...P)
  const weather = lastClue(D)
  await osint(env, 'clue', 'La page Commons date la prise de vue du 12 novembre 2021 à 14:06 et nomme son auteur (Dudva) et sa licence (CC BY-SA 4.0)', '--status', 'read', '--sources', sourceId(D, 'Roman Temple of Évora'), '--title', 'Prise de vue du 12 novembre 2021', ...P)
  // what the agent saw in the picture at full size: an entry of the Journal that its observed clues cite
  await osint(env, 'log', ...P, '--phase', 'claim', 'Regardée en pleine taille : la cathédrale d\'Évora derrière le temple, un ciel clair, des pavés secs')
  const looked = lastJournal(D)
  await osint(env, 'clue', 'Derrière le temple, la tour-lanterne de la cathédrale d\'Évora ; à gauche, l\'église des Lóios', '--status', 'observed', '--where', 'E01-evora-temple.jpg', '--credibility', '2', '--journal', looked, '--title', 'La cathédrale d\'Évora derrière le temple', ...P)
  await osint(env, 'clue', 'Ciel bleu sans nuage, ombres longues et nettes, pavés secs : rien d\'un soir d\'orage', '--status', 'observed', '--where', 'E01-evora-temple.jpg', '--credibility', '2', '--journal', looked, '--title', 'Ciel clair et pavés secs', ...P)
  await osint(env, 'log', ...P, '--phase', 'integrity', 'Indices de retouche ou de génération')
  await osint(env, 'hyp', 'add', 'La légende est juste : Mérida, orage du 3 mars 2025', '--level', 'claim', '--refute-if', 'Une copie publiée avant le 3 mars 2025, ou un autre lieu que Mérida reconnu dans l\'image', ...P)
  await osint(env, 'hyp', 'add', 'Photo du temple romain d\'Évora (novembre 2021) reprise avec une fausse légende', '--level', 'claim', '--refute-if', 'Aucune copie avant mars 2025 et un repère propre à Mérida dans l\'image', ...P)
  await osint(env, 'hyp', 'add', 'Première apparition : Wikimedia Commons, 20 novembre 2021', '--level', 'origin', '--refute-if', 'Une copie datée d\'avant le 20 novembre 2021', ...P)
  await osint(env, 'hyp', 'add', 'Première apparition : le post de @newsdesk_example, 3 mars 2025', '--level', 'origin', '--refute-if', 'Une copie datée d\'avant le 3 mars 2025', ...P)
  await osint(env, 'hyp', 'add', 'Photo d\'appareil, sans retouche de la scène', '--level', 'integrity', '--refute-if', 'Un marqueur IA, ou une copie plus ancienne au contenu différent', ...P)
  await osint(env, 'hyp', 'add', 'Image générée ou retouchée', '--level', 'integrity', '--refute-if', 'Une copie de 2021 identique, datée par l\'appareil', ...P)
  const first = clueId(D, 'Plus ancienne apparition datée'), taken = clueId(D, 'Prise de vue du 12 novembre'), cathedral = clueId(D, 'La cathédrale d'), sky = clueId(D, 'Ciel clair')
  await osint(env, 'hyp', 'exclude', 'H01', '--clue', first, '--why', 'La photo était en ligne dès le 20 novembre 2021 (Wikimedia Commons) : elle ne peut pas montrer le 3 mars 2025', ...P)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', first, '--lr', '20', '--why', 'Copie datée du 20 novembre 2021 sur Commons, plus de trois ans avant la légende', ...P)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', cathedral, '--lr', '4', '--why', 'La tour-lanterne de la cathédrale d\'Évora se voit derrière le temple', ...P)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', sky, '--lr', '3', '--why', 'Un ciel clair et des pavés secs, pas un soir d\'orage', ...P)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', weather, '--lr', '2', '--why', 'Mérida était sous un ciel couvert et la pluie ce soir-là (réanalyse Open-Meteo)', ...P)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', first, '--lr', '20', '--why', 'La page Commons est la plus ancienne copie datée trouvée', ...P)
  await osint(env, 'hyp', 'exclude', 'H04', '--clue', first, '--why', 'Une copie datée du 20 novembre 2021 précède le post', ...P)
  await osint(env, 'hyp', 'lr', 'H05', '--clue', taken, '--lr', '3', '--why', 'Prise de vue datée par l\'appareil sur la page Commons, avec son auteur', ...P)
  await osint(env, 'log', ...P, '--phase', 'redteam', 'Red team sur H02')
  await osint(env, 'redteam', '--file', json({ target: 'H02', outcome: 'survives', refutations: [
    { test: 'Le temple de Diane de Mérida peut-il être confondu avec celui d\'Évora ?', result: 'Non : à Mérida, les colonnes sont prises dans la façade d\'un palais du XVIe siècle ; ici le temple est dégagé et la cathédrale d\'Évora se voit derrière' },
    { test: 'La page Commons pourrait-elle être une copie récente antidatée ?', result: 'Non : un blog reprend la photo en juin 2023 (archive Wayback du 1er juillet 2023)' },
    { test: 'La photo est-elle retournée ou recadrée par rapport à Commons ?', result: 'Non : même cadrage et même sens' },
  ] }), ...P)
  await osint(env, 'log', ...P, '--phase', 'answer', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H02', confidence: { claim: 'high', origin: 'medium', integrity: 'medium' },
    criteria: {
      claim: 'Contradiction lue : une copie datée du 20 novembre 2021, et la cathédrale d\'Évora visible derrière le temple',
      origin: 'Copie de Commons datée, lue et archivée ; Lens, Bing et TinEye pas encore consultés par le tunnel',
      integrity: 'Fichier sans métadonnées ni manifeste C2PA ; même contenu que la copie de 2021',
    },
    alternatives: [{ hyp: 'H06', test: 'Comparer en pleine taille à l\'original de Commons (3987 × 2969) : un détail ajouté ou effacé' }],
    unresolved: [weather],
  }), ...P)
  await osint(env, 'next', '--file', json([
    { label: 'Chercher des copies plus anciennes sur X, Telegram et TikTok', why: 'la candidate de 2021 pourrait avoir un aîné', minutes: 20, prompt: '[verify-media:first-seen-deep] Orage à Mérida' },
    { label: 'Lens, Bing et TinEye par le tunnel', why: 'l\'origine reste à medium tant que ces moteurs n\'ont pas été consultés', minutes: 10, prompt: '[verify-media:refresh-engines] E01-evora-temple.jpg' },
    { label: 'Dater la prise de vue par les ombres', why: 'confirmer l\'heure donnée par Commons (14:06)', minutes: 10, prompt: '[verify-media:chronolocate] E01-evora-temple.jpg' },
  ]), ...P)
}

// three certificates issued after the case was closed: what the watch's pass « the next day » finds on crt.sh
const NEW_CERTS = [
  { issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: 'click-collect.durand-bakery.example', name_value: 'click-collect.durand-bakery.example', id: 1101, not_before: '2026-11-01T00:00:00', not_after: '2027-01-30T23:59:59' },
  { issuer_name: "C=US, O=Let's Encrypt, CN=R11", common_name: 'api.durand-bakery.example', name_value: 'api.durand-bakery.example', id: 1102, not_before: '2026-11-02T00:00:00', not_after: '2027-01-31T23:59:59' },
  { issuer_name: "C=US, O=Let's Encrypt, CN=E6", common_name: 'promo.durand-bakery.example', name_value: 'promo.durand-bakery.example', id: 1103, not_before: '2026-11-02T12:00:00', not_after: '2027-01-31T11:59:59' },
]

export async function buildDemo(env) {
  const home = env.OSINT_DIR, D = path.join(home, 'durand-bakery-example'), P = ['-p', 'durand-bakery-example']
  await osint(env, 'new', 'domain', 'durand-bakery.example', '--question', 'Qui exploite le site de la boulangerie Durand ?', '--lang', 'fr',
    '--frame', 'noisy=ask', '--frame', 'purpose=Vérifier le vendeur avant une commande en gros')
  await osint(env, 'log', ...P, '--phase', 'collect', 'Collecte RDAP, DNS, certificats, archives, hébergement, page d\'accueil')
  await osint(env, 'domain', 'collect', '--yes', ...P)
  await osint(env, 'domain', 'legal-notice', '--yes', ...P)
  await osint(env, 'log', ...P, '--phase', 'analyse', 'Qui exploite le site ?')
  await osint(env, 'hyp', 'add', 'La Boulangerie Durand SARL exploite le site', '--level', 'owner', '--refute-if', 'Les mentions légales ou le RCS nomment une autre société', ...P)
  await osint(env, 'hyp', 'add', 'Une agence web exploite le site pour la boulangerie', '--level', 'owner', '--refute-if', 'Les mentions légales nomment la boulangerie comme éditeur', ...P)
  await osint(env, 'hyp', 'add', 'Hébergé chez Exemple Hébergement SAS', '--level', 'infrastructure', '--refute-if', 'Le DNS ou l\'AS désignent un autre hébergeur', ...P)
  await osint(env, 'hyp', 'add', 'Hébergé chez un autre prestataire derrière un CDN', '--level', 'infrastructure', '--refute-if', 'L\'IP appartient à l\'AS de l\'hébergeur nommé', ...P)
  const siren = clueId(D, 'SIREN 456 789 122 dans les mentions'), hosted = clueId(D, 'Hébergé par'), legalHost = clueId(D, 'Hébergeur nommé'), trackers = clueId(D, 'Traceurs')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', siren, '--lr', '20', '--why', 'Le SIREN des mentions légales est celui de la boulangerie', ...P)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', trackers, '--lr', '1.5', '--why', 'Un même identifiant d\'analytics sur un autre site peut venir d\'une agence', ...P)
  await osint(env, 'hyp', 'exclude', 'H02', '--clue', siren, '--why', 'Les mentions légales nomment la boulangerie comme éditeur', ...P)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', hosted, '--lr', '20', '--why', 'L\'IP du site est dans l\'AS64500 d\'Exemple Hébergement', ...P)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', legalHost, '--lr', '10', '--why', 'Les mentions légales nomment le même hébergeur', ...P)
  await osint(env, 'log', ...P, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'survives', refutations: [
    { test: 'Le SIREN appartient-il à une autre société ?', result: 'Non : la ligne RCS nomme Boulangerie Durand SARL' },
    { test: 'Le site a-t-il été revendu ?', result: 'Non : même titre et même SIREN dans les archives depuis 2019' },
  ] }), ...P)
  await osint(env, 'log', ...P, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { owner: 'high', infrastructure: 'high' },
    criteria: { owner: 'SIREN lu dans les mentions légales et sur la page d\'accueil, éditeur nommé', infrastructure: 'DNS et RDAP de l\'AS lus aujourd\'hui concordent avec les mentions légales' },
    alternatives: [{ hyp: 'H04', test: 'Un en-tête de CDN ou un traceroute montrant un autre réseau que l\'AS64500' }], unresolved: [trackers],
  }), ...P)
  await osint(env, 'next', '--file', json([
    { label: 'Lire les pages d\'accueil archivées de 2019 et 2022', why: 'vérifier que l\'éditeur n\'a pas changé', minutes: 10, prompt: '[domain:deep-wayback] durand-bakery.example' },
    { label: 'Chercher G-DURAND123 sur le web', why: 'trouver les autres sites du même compte d\'analytics', minutes: 5, prompt: '[domain:tracker-search] G-DURAND123' },
  ]), ...P)
  // (noisy=ask: the user said yes to reading the site itself, so --yes on those steps)
  // the ip case: the bakery site's address, opened from its entity (a pivot); it inherits the frame (noisy: never)
  const I = ['-p', '192-0-2-10'], ID = path.join(home, '192-0-2-10')
  await osint(env, 'new', 'ip', '192.0.2.10', '--question', 'Who operates 192.0.2.10, the bakery site\'s address, and roughly where is it?',
    '--parent', 'durand-bakery-example', '--from', 'Entities/192.0.2.10.md', '--frame', 'purpose=Check who hosts the bakery site before a bulk order')
  await osint(env, 'log', ...I, '--phase', 'collect', 'Registries, routing, reverse DNS, geolocation, Shodan, Tor and cloud lists')
  await osint(env, 'ip', 'collect', ...I)
  await osint(env, 'log', ...I, '--phase', 'analyse', 'Who operates the address, and roughly where')
  await osint(env, 'hyp', 'add', 'Exemple Hébergement SAS operates 192.0.2.10 (a shared web server)', '--level', 'operator', '--refute-if', 'The AS that announces 192.0.2.0/24 or a published cloud range names another operator', ...I)
  await osint(env, 'hyp', 'add', 'A customer runs its own server on the hosting company\'s range', '--level', 'operator', '--refute-if', 'The reverse name and Shodan\'s names are the hosting company\'s shared servers', ...I)
  await osint(env, 'hyp', 'add', 'In France, around Lyon', '--level', 'location', '--refute-if', 'A published region or the registry places the range outside France', ...I)
  await osint(env, 'hyp', 'add', 'Outside France', '--level', 'location', '--refute-if', 'The registry and the geolocation database both say France', ...I)
  const network = clueId(ID, 'Network EXEMPLE-HEBERGEMENT-NET'), announced = clueId(ID, 'Announced by AS64500'), ptr = clueId(ID, 'Reverse name web1'), geo = clueId(ID, 'GeoLite2 places')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', network, '--lr', '10', '--why', 'RDAP names Exemple Hébergement SAS as the holder of 192.0.2.0/24', ...I)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', announced, '--lr', '10', '--why', 'AS64500, which announces the prefix, belongs to the same company', ...I)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', ptr, '--lr', '3', '--why', 'The confirmed reverse name is one of the host\'s shared servers', ...I)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', ptr, '--lr', '0.5', '--why', 'A customer\'s own server would rarely carry the host\'s shared server name', ...I)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', geo, '--lr', '3', '--why', 'GeoLite2 places it around Lyon (an estimate, capped at 3)', ...I)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', network, '--lr', '2', '--why', 'The registry\'s country is FR (the holder\'s, not the machine\'s)', ...I)
  await osint(env, 'log', ...I, '--phase', 'redteam', 'Red team on H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'survives', refutations: [
    { test: 'Is the range leased to another company (holder and announcer differ)?', result: 'No: RDAP and AS64500 name the same company' },
    { test: 'Is a CDN or a cloud in front of the origin?', result: 'No: the address is in no published cloud range and Shodan tags none' },
  ] }), ...I)
  await osint(env, 'log', ...I, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { operator: 'high', location: 'medium' }, radius_m: 50000,
    criteria: { operator: 'RDAP\'s holder of 192.0.2.0/24 and the AS that announces it are the same company; the confirmed reverse name is its shared server', location: 'France: the geolocation database and the registry agree on the country; Lyon rests on the database alone (±50 km)' },
    alternatives: [{ hyp: 'H02', test: 'A reverse name or Shodan names that belong to a customer, not to the host' }, { hyp: 'H04', test: 'A published region or the host\'s list of data centres placing the range outside France' }], unresolved: [],
  }), ...I)
  await osint(env, 'next', '--file', json([
    { label: 'Open a domain case on web1.exemple-hebergement.example', why: 'see what else the shared server hosts', minutes: 10, prompt: '[pivot:domain] web1.exemple-hebergement.example — from Entities/web1.exemple-hebergement.example.md' },
    { label: 'Search the web for 192.0.2.10', why: 'abuse reports or blocklists that name it', minutes: 5, prompt: '[ip:web-mentions] 192.0.2.10' },
  ]), ...I)
  // the child case: the tracker's other site, found by tracker-search
  await osint(env, 'new', 'domain', 'other-shop.example', '--question', 'Who runs other-shop.example, which shares G-DURAND123?', '--parent', 'durand-bakery-example', '--from', 'Entities/G-DURAND123.md')
  await osint(env, 'log', '-p', 'other-shop-example', '--phase', 'collect', 'Collecting the shared tracker\'s other site')
  await osint(env, 'domain', 'collect', '--only', 'rdap,dns,home', '--yes', '-p', 'other-shop-example')
  await geolocationDemo(env)
  await buildVerifyMedia(env)
  // the username case: the bakery's Instagram name, a pivot from the account its home page links to; it shares that
  // account with its parent (« Shared entities ») and shows the Accounts table, two candidates read one at a time
  const U = ['-p', 'durand-bakery'], UD = path.join(home, 'durand-bakery')
  await osint(env, 'new', 'username', 'https://www.instagram.com/durand.bakery', '--title', 'durand.bakery', '--lang', 'fr',
    '--question', 'Quels comptes publics portent le nom durand.bakery, et lesquels sont ceux de la boulangerie ?',
    '--parent', 'durand-bakery-example', '--from', 'Entities/https---www.instagram.com-durand.bakery.md',
    '--frame', 'legal_basis=Intérêt légitime — vérifier un fournisseur avant une commande en gros (comptes professionnels)',
    '--frame', 'purpose=Vérifier les comptes publics du fournisseur')
  await osint(env, 'log', ...U, '--phase', 'collect', 'WhatsMyName sur les catégories par défaut')
  await osint(env, 'username', 'check', ...U)
  await osint(env, 'log', ...U, '--phase', 'process', 'Lecture des deux profils trouvés, un à la fois')
  await osint(env, 'source', 'https://www.instagram.com/durand.bakery/', '--reliability', 'B', ...U)
  await osint(env, 'source', 'https://forum.example/u/durand.bakery', '--reliability', 'C', ...U)
  await osint(env, 'entity', 'domain', 'durand-bakery.example', '--sources', 'S02', '--prop', 'role=bio link', ...U)
  await osint(env, 'clue', 'La bio Instagram renvoie vers durand-bakery.example, dont la page d\'accueil renvoie vers ce compte', '--status', 'read', '--sources', 'S02', '--title', 'Instagram et le site se citent', ...U)
  await osint(env, 'clue', 'Le profil forum.example dit « Boulangerie Durand, Exempleville », sans lien vers le site', '--status', 'observed', '--sources', 'S03', '--title', 'Forum - même nom et même ville', ...U)
  await osint(env, 'log', ...U, '--phase', 'analyse', 'Quels comptes sont ceux de la boulangerie ?')
  await osint(env, 'hyp', 'add', 'Instagram et forum.example sont tous deux à la boulangerie', '--level', 'same-person', '--refute-if', 'Le profil forum.example renvoie vers une autre boulangerie ou une autre ville', ...U)
  await osint(env, 'hyp', 'add', 'Seul Instagram est à la boulangerie ; forum.example est un homonyme', '--level', 'same-person', '--refute-if', 'Le profil forum.example cite le site ou le compte Instagram', ...U)
  await osint(env, 'hyp', 'add', 'Aucun des deux comptes n\'est à la boulangerie', '--level', 'same-person', '--refute-if', 'Un profil et le site se citent l\'un l\'autre', ...U)
  const both = clueId(UD, 'Instagram et le site'), forum = clueId(UD, 'Forum - même nom')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', both, '--lr', '10', '--why', 'Le compte Instagram et le site se citent', ...U)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', both, '--lr', '10', '--why', 'Le compte Instagram et le site se citent', ...U)
  await osint(env, 'hyp', 'exclude', 'H03', '--clue', both, '--why', 'Instagram et le site se citent l\'un l\'autre', ...U)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', forum, '--lr', '3', '--why', 'Même nom et même ville sur forum.example', ...U)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', forum, '--lr', '0.5', '--why', 'Un homonyme dans la même ville est peu probable', ...U)
  await osint(env, 'log', ...U, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'weakened', refutations: [
    { test: 'Le pseudo est-il courant ?', result: 'Non : 2 comptes sur les 6 sites lus' },
    { test: 'Le profil forum.example renvoie-t-il vers le site ?', result: 'Non : seulement le nom et la ville, sans lien ni avatar comparé' },
  ] }), ...U)
  await osint(env, 'log', ...U, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { 'same-person': 'medium' },
    criteria: { 'same-person': 'Instagram : le profil et le site se citent (deux liens indépendants) ; forum.example : nom et ville cohérents, sans lien ni avatar comparé' },
    alternatives: [{ hyp: 'H02', test: 'Comparer l\'avatar de forum.example en pleine taille au logo de la boulangerie (avatar-compare)' }], unresolved: [forum],
  }), ...U)
  await osint(env, 'next', '--file', json([
    { label: 'Comparer les avatars Instagram et forum.example', why: 'un même avatar relierait forum.example à la boulangerie', minutes: 10, prompt: '[username:avatar-compare] durand.bakery' },
    { label: 'Lancer Maigret sur durand.bakery', why: 'd\'autres sites que ceux de WhatsMyName', minutes: 10, prompt: '[username:maigret] durand.bakery' },
  ]), ...U)
  // stage 5 — the bakery's company: a child case started from the SIREN read on its site, in French, finished
  const CO = path.join(home, 'boulangerie-durand-sarl'), C = ['-p', 'boulangerie-durand-sarl']
  await osint(env, 'new', 'company-fr', 'SIREN 456 789 122', '--title', 'Boulangerie Durand SARL', '--lang', 'fr',
    '--question', 'Qui dirige la Boulangerie Durand et quelles autres sociétés ses dirigeants tiennent-ils ?',
    '--frame', 'purpose=Vérifier le vendeur avant une commande en gros', '--parent', 'durand-bakery-example', '--from', 'Entities/SIREN 456 789 122.md')
  await osint(env, 'log', ...C, '--phase', 'collect', 'Registre, annonces BODACC et autres sociétés des dirigeants')
  await osint(env, 'company-fr', 'collect', ...C)
  await osint(env, 'company-fr', 'bodacc', ...C)
  await osint(env, 'company-fr', 'officers', ...C)
  // the website action, as the agent does it: the official site found by a web search, read once
  await osint(env, 'log', ...C, '--phase', 'process', 'Site officiel trouvé par une recherche web, lu une fois')
  const site = (await osint(env, 'source', 'https://durand-bakery.example/', '--reliability', 'B', ...C)).split(':')[0].trim()
  await osint(env, 'entity', 'domain', 'durand-bakery.example', '--prop', 'role=website', '--sources', site, ...C)
  await osint(env, 'clue', 'Le site officiel durand-bakery.example porte le SIREN 456 789 122 dans son pied de page', '--status', 'read', '--sources', site, '--title', 'Site officiel durand-bakery.example', ...C)
  await osint(env, 'log', ...C, '--phase', 'analyse', 'Quelle société, et quel réseau de dirigeants ?')
  await osint(env, 'hyp', 'add', 'La Boulangerie Durand SARL (SIREN 456 789 122) est la société du site', '--level', 'identity', '--refute-if', 'Le registre donne une autre raison sociale ou une autre adresse que les mentions légales', ...C)
  await osint(env, 'hyp', 'add', 'Une société homonyme exploite le site', '--level', 'identity', '--refute-if', 'Le SIREN lu sur le site est au registre sous le nom de la boulangerie', ...C)
  await osint(env, 'hyp', 'add', 'Jeanne Durand dirige aussi la SCI Durand Exemple et l\'Épicerie Martin', '--level', 'network', '--refute-if', 'Un autre mois de naissance au registre', ...C)
  await osint(env, 'hyp', 'add', 'La dirigeante de l\'Épicerie Martin est une homonyme', '--level', 'network', '--refute-if', 'Le même mois de naissance au registre', ...C)
  const ident = clueId(CO, 'SIREN 456 789 122, créée'), high = clueId(CO, 'Jeanne Durand est aussi'), medium = clueId(CO, 'Jeanne Durand est peut-être'), namesakes = clueId(CO, 'Homonymes de Jeanne Durand')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', ident, '--lr', '20', '--why', 'Le registre donne BOULANGERIE DURAND pour le SIREN lu sur le site', ...C)
  await osint(env, 'hyp', 'exclude', 'H02', '--clue', ident, '--why', 'Le SIREN du site est au registre sous le nom de la boulangerie', ...C)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', high, '--lr', '10', '--why', 'SCI Durand Exemple : même nom, même mois de naissance', ...C)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', medium, '--lr', '2', '--why', 'Épicerie Martin : même nom, même année de naissance seulement', ...C)
  await osint(env, 'hyp', 'lr', 'H04', '--clue', namesakes, '--lr', '1.5', '--why', 'Une homonyme dirige ailleurs : le nom seul ne suffit pas', ...C)
  await osint(env, 'log', ...C, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'survives', refutations: [
    { test: 'Le SIREN pourrait-il être celui d\'une autre société ?', result: 'Non : le registre et le BODACC donnent Boulangerie Durand pour ce numéro' },
    { test: 'La société est-elle encore active ?', result: 'Oui : active au registre, comptes 2024 déposés, plan de sauvegarde arrêté en 2021' },
  ] }), ...C)
  await osint(env, 'log', ...C, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { identity: 'high', network: 'medium' },
    criteria: { identity: 'SIREN lu sur le site, confirmé par le registre (Recherche d\'entreprises) et le BODACC', network: 'SCI Durand Exemple : même nom et même mois de naissance ; Épicerie Martin : même année seulement' },
    alternatives: [{ hyp: 'H04', test: 'Lire la fiche de l\'Épicerie Martin à l\'annuaire des entreprises : la dirigeante y a-t-elle le même mois de naissance ?' }], unresolved: [medium],
  }), ...C)
  await osint(env, 'next', '--file', json([
    { label: 'Vérifier la dirigeante de l\'Épicerie Martin', why: 'même nom et même année de naissance seulement', minutes: 10, prompt: '[company-fr:officers-deep] Jeanne Durand' },
    { label: 'Ouvrir une enquête sur la SCI Durand Exemple', why: 'même nom et même mois de naissance', minutes: 15, prompt: '[pivot:company-fr] SCI DURAND EXEMPLE — from Entities/SCI DURAND EXEMPLE.md' },
  ]), ...C)

  // the email case: the address the bakery's home page publishes, a pivot from the domain case; the frame is inherited,
  // the legal basis is asked (a person is always the subject of an email case) and noisy actions are asked, not never
  const M = path.join(home, 'contact-durand-bakery-example'), PM = ['-p', 'contact-durand-bakery-example']
  const withUv = { ...env, OSINT_UV: path.join(import.meta.dirname, 'fixtures', 'holehe', 'uv.mjs') }
  await osint(env, 'new', 'email', 'contact@durand-bakery.example', '--lang', 'fr', '--parent', 'durand-bakery-example', '--from', 'Entities/contact@durand-bakery.example.md',
    '--question', 'Qui utilise l\'adresse contact@durand-bakery.example, et sert-elle encore ?', '--frame', 'purpose=Vérifier le vendeur avant une commande en gros',
    '--frame', 'legal_basis=Intérêt légitime — vérifier un vendeur avant une commande', '--frame', 'noisy=ask')
  await osint(env, 'log', ...PM, '--phase', 'collect', 'Adresse, domaines jetables, DNS de messagerie, Gravatar, noms des fuites')
  await osint(env, 'email', 'collect', ...PM)
  await osint(env, 'log', ...PM, '--phase', 'collect', 'Formulaires d\'inscription (Holehe) après le oui de l\'utilisateur')
  await osint(withUv, 'email', 'account-probe', '--yes', ...PM)
  await osint(env, 'log', ...PM, '--phase', 'analyse', 'Qui utilise l\'adresse, et sert-elle encore ?')
  await osint(env, 'hyp', 'add', 'La Boulangerie Durand SARL utilise cette adresse', '--level', 'owner', '--refute-if', 'Un profil ou une page nomme un autre titulaire', ...PM)
  await osint(env, 'hyp', 'add', 'Un prestataire gère cette adresse pour la boulangerie', '--level', 'owner', '--refute-if', 'Le profil Gravatar nomme la boulangerie elle-même', ...PM)
  await osint(env, 'hyp', 'add', 'L\'adresse sert aujourd\'hui', '--level', 'in-use', '--refute-if', 'Le domaine n\'accepte plus de courrier (MX nul ou absent)', ...PM)
  await osint(env, 'hyp', 'add', 'L\'adresse est abandonnée', '--level', 'in-use', '--refute-if', 'Un signe récent d\'usage : profil modifié cette année, page en ligne', ...PM)
  const company = clueId(M, 'Entreprise sur Gravatar'), verified = clueId(M, 'Comptes vérifiés par Gravatar'), provider = clueId(M, 'Messagerie chez')
  const edited = clueId(M, 'Profil Gravatar modifié'), hit = clueId(M, 'Un site dit qu')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', company, '--lr', '10', '--why', 'Le profil Gravatar de l\'adresse nomme Boulangerie Durand SARL', ...PM)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', verified, '--lr', '5', '--why', 'Le compte Instagram vérifié par Gravatar est celui que lie le site de la boulangerie', ...PM)
  await osint(env, 'hyp', 'exclude', 'H02', '--clue', company, '--why', 'Le profil nomme la boulangerie elle-même, pas un prestataire', ...PM)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', provider, '--lr', '5', '--why', 'Le domaine reçoit le courrier chez Google Workspace', ...PM)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', edited, '--lr', '4', '--why', 'Profil Gravatar modifié en septembre 2026', ...PM)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', hit, '--lr', '2', '--why', 'Un site dit qu\'un compte utilise l\'adresse (indice déduit, Holehe)', ...PM)
  await osint(env, 'log', ...PM, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'survives', refutations: [
    { test: 'Le profil Gravatar a-t-il pu être créé par un tiers ?', result: 'Non : son compte Instagram vérifié est celui que lie le site de la boulangerie' },
    { test: 'L\'adresse est-elle partagée avec une agence ?', result: 'Rien ne le dit : les mentions légales nomment la boulangerie comme éditeur' },
  ] }), ...PM)
  await osint(env, 'log', ...PM, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { owner: 'high', 'in-use': 'medium' },
    criteria: { owner: 'Deux liens indépendants : le profil Gravatar (entreprise, compte Instagram vérifié) et le site de la boulangerie qui publie l\'adresse', 'in-use': 'Le domaine reçoit le courrier et le profil a été modifié en 2026 ; aucune page datée de cette année ne publie encore l\'adresse' },
    alternatives: [{ hyp: 'H04', test: 'Une page de la boulangerie datée de cette année qui publie encore l\'adresse' }], unresolved: [hit],
  }), ...PM)
  await osint(env, 'next', '--file', json([
    { label: 'Chercher l\'adresse exacte sur le web', why: 'une page récente qui la publie dirait qu\'elle sert encore', minutes: 5, prompt: '[email:process] search "contact@durand-bakery.example" on the web' },
    { label: 'Lire le compte Instagram vérifié', why: 'confirmer que la boulangerie le tient encore', minutes: 5, prompt: '[email:process] read https://www.instagram.com/durand.bakery' },
  ]), ...PM)
  // the bakery's contact page gives a phone number: the phone type's pivot, then its case — the WordPress theme's
  // placeholder, in a block the ARCEP keeps for works of fiction
  const contact = sid(await osint(env, 'source', 'https://durand-bakery.example/contact', '--reliability', 'B', ...P))
  await osint(env, 'entity', 'phone', '+33199001234', '--sources', contact, '--prop', 'role=published on the contact page', ...P)
  const T = ['-p', 'telephone-boulangerie-durand'], D2 = path.join(home, 'telephone-boulangerie-durand')
  await osint(env, 'new', 'phone', '+33 1 99 00 12 34', '--title', 'Téléphone boulangerie Durand', '--lang', 'fr',
    '--question', 'Qui répond au 01 99 00 12 34 publié sur le site de la boulangerie ?', '--frame', 'purpose=Joindre le vendeur avant une commande en gros',
    '--parent', 'durand-bakery-example', '--from', 'Entities/+33199001234.md')
  await osint(env, 'log', ...T, '--phase', 'collect', 'Plan de numérotation et registre de l\'ARCEP')
  await osint(env, 'phone', 'collect', ...T)
  await osint(env, 'log', ...T, '--phase', 'mentions', 'Recherche web de « 01 99 00 12 34 », « 0199001234 », « +33 1 99 00 12 34 »')
  const page = sid(await osint(env, 'source', 'https://durand-bakery.example/contact', '--reliability', 'B', ...T))
  const theme = sid(await osint(env, 'source', 'https://theme-boulangerie.example/demo', '--reliability', 'C', ...T))
  for (const [url, s, site] of [['https://durand-bakery.example/contact', page, 'durand-bakery.example'], ['https://theme-boulangerie.example/demo', theme, 'theme-boulangerie.example']])
    await osint(env, 'entity', 'url', url, '--sources', s, '--prop', 'role=mention', '--prop', `site=${site}`, '--prop', 'writing=01 99 00 12 34', '--prop', 'seen=2026-11-03', ...T)
  await osint(env, 'entity', 'domain', 'theme-boulangerie.example', '--sources', theme, '--prop', 'role=theme vendor', ...T)
  await osint(env, 'clue', 'Le 01 99 00 12 34 est le seul numéro de la page Contact de la boulangerie', '--status', 'observed', '--sources', page, ...T)
  await osint(env, 'clue', 'La démo du thème Fournil affiche le même numéro et demande de le remplacer', '--status', 'observed', '--sources', theme, ...T)
  await osint(env, 'log', ...T, '--phase', 'analyse', 'Qui répond à ce numéro ?')
  await osint(env, 'hyp', 'add', 'La ligne de la boulangerie', '--level', 'owner', '--refute-if', 'Le bloc du numéro ne sonne chez personne', ...T)
  await osint(env, 'hyp', 'add', 'Le numéro factice du thème, resté sur le site', '--level', 'owner', '--refute-if', 'La démo du thème affiche un autre numéro', ...T)
  await osint(env, 'hyp', 'add', 'Aucune ligne : un bloc réservé à la fiction', '--level', 'line', '--refute-if', 'Le registre de l\'ARCEP attribue le bloc à un opérateur', ...T)
  await osint(env, 'hyp', 'add', 'Une ligne fixe active chez un opérateur', '--level', 'line', '--refute-if', 'Aucun opérateur ne détient le bloc', ...T)
  const fiction = clueId(D2, 'Bloc réservé par l'), demo = clueId(D2, 'La démo du thème')
  await osint(env, 'hyp', 'exclude', 'H01', '--clue', fiction, '--why', 'Le bloc 01 99 00 est réservé à la fiction : le numéro ne sonne chez personne', ...T)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', demo, '--lr', '4', '--why', 'La démo du thème affiche le même numéro, à remplacer', ...T)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', fiction, '--lr', '20', '--why', 'Le bloc est absent du registre de l\'ARCEP et réservé à la fiction', ...T)
  await osint(env, 'hyp', 'exclude', 'H04', '--clue', fiction, '--why', 'Aucun opérateur ne détient le bloc', ...T)
  await osint(env, 'log', ...T, '--phase', 'redteam', 'Red team sur H02')
  await osint(env, 'redteam', '--file', json({ target: 'H02', outcome: 'survives', refutations: [
    { test: 'Le bloc a-t-il été attribué depuis ?', result: 'Non : absent du registre MAJNUM lu aujourd\'hui, et réservé à la fiction' },
    { test: 'Le site donne-t-il un autre numéro ?', result: 'Non : la page Contact est la seule à en donner un, celui du thème' },
  ] }), ...T)
  await osint(env, 'log', ...T, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H02', confidence: { owner: 'high', line: 'high' },
    criteria: { owner: 'Le même numéro sur la page Contact et sur la démo du thème, qui demande de le remplacer ; son bloc est réservé à la fiction', line: 'Plan de numérotation lu (ligne fixe, France) ; bloc absent du registre de l\'ARCEP et réservé à la fiction (décision 2019-0954)' },
    alternatives: [], unresolved: [],
  }), ...T)
  await osint(env, 'next', '--file', json([
    { label: 'Chercher le vrai numéro de la boulangerie', why: 'le site ne donne que le numéro du thème', minutes: 10, prompt: '[question] Le numéro de la Boulangerie Durand dans les annuaires d\'entreprises' },
    { label: 'Ouvrir une enquête sur theme-boulangerie.example', why: 'l\'éditeur du thème laisse ce numéro sur ses démos', minutes: 5, prompt: '[pivot:domain] theme-boulangerie.example' },
  ]), ...T)

  // stage 9 — the place: the bakery's head office, opened from its establishment in the company case (a pivot); it
  // inherits the frame (person, legal basis) and adds noisy=never; no Mapillary token: the degraded mode shows
  const PL = path.join(home, '1-place-de-l-exemple'), L = ['-p', '1-place-de-l-exemple']
  await osint(env, 'new', 'place', 'SIRET 456 789 122 00011', '--title', "1 place de l'Exemple", '--lang', 'fr',
    '--question', "Qu'y a-t-il au 1 place de l'Exemple, et comment la place a-t-elle changé ?",
    '--frame', 'noisy=never', '--frame', 'purpose=Vérifier le local du vendeur avant une commande en gros',
    '--parent', 'boulangerie-durand-sarl', '--from', 'Entities/SIRET 456 789 122 00011.md')
  await osint(env, 'log', ...L, '--phase', 'collect', 'Point du registre, OpenStreetMap, images au sol, sociétés voisines, imagerie')
  await osint({ ...env, MAPILLARY_TOKEN: '' }, 'place', 'collect', ...L)
  await osint(env, 'log', ...L, '--phase', 'process', "L'image Panoramax de 2024, ouverte en pleine taille")
  const panoramax = fs.readdirSync(path.join(PL, 'Sources')).find(f => f.includes('Panoramax')).split(' ')[0]
  await osint(env, 'clue', "Sur l'image Panoramax du 2024-06-12 (cap 45°), l'enseigne « Boulangerie Durand » est lisible au-dessus de la vitrine du 1 place de l'Exemple", '--status', 'observed',
    '--sources', panoramax, '--entities', 'https://api.panoramax.xyz/#focus=pic&pic=00000000-0000-4000-8000-00000000a001', ...L)
  await osint(env, 'log', ...L, '--phase', 'analyse', "Qui occupe le lieu aujourd'hui, et ce qui a changé sur la place")
  await osint(env, 'hyp', 'add', "La Boulangerie Durand occupe le 1 place de l'Exemple aujourd'hui", '--level', 'identity', '--refute-if', "Une image au sol récente ou le registre montre un autre commerce au 1 place de l'Exemple", ...L)
  await osint(env, 'hyp', 'add', 'Un autre commerce occupe le local', '--level', 'identity', '--refute-if', "Le registre, OpenStreetMap et une image récente placent la boulangerie au 1 place de l'Exemple", ...L)
  await osint(env, 'hyp', 'add', 'La place a gardé ses commerces depuis 2016, sauf la pharmacie fermée en 2019', '--level', 'history', '--refute-if', 'Une image ou le registre montre une autre fermeture ou une ouverture', ...L)
  await osint(env, 'hyp', 'add', 'La place a perdu ses commerces', '--level', 'history', '--refute-if', 'Des établissements ouverts au registre et visibles sur les images récentes', ...L)
  const building = clueId(PL, 'Le point est dans Boulangerie Durand'), sign = clueId(PL, "Sur l'image Panoramax du 2024-06-12"), companies = clueId(PL, 'Sociétés enregistrées à moins de 150 m'), karta = clueId(PL, 'KartaView - images au sol')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', building, '--lr', '5', '--why', 'OpenStreetMap place le point dans le bâtiment de la boulangerie', ...L)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', sign, '--lr', '4', '--why', "L'enseigne est lisible sur une image datée de 2024", ...L)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', companies, '--lr', '5', '--why', "Le registre donne l'établissement ouvert de la boulangerie à cette adresse", ...L)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', sign, '--lr', '0.3', '--why', "L'enseigne de 2024 est celle de la boulangerie", ...L)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', companies, '--lr', '4', '--why', 'Au registre : trois établissements ouverts, la pharmacie fermée le 2019-06-30', ...L)
  await osint(env, 'hyp', 'lr', 'H03', '--clue', karta, '--lr', '2', '--why', 'Images au sol de 2016 et 2019 pour comparer avec 2024', ...L)
  await osint(env, 'hyp', 'lr', 'H04', '--clue', companies, '--lr', '0.3', '--why', 'Trois établissements restent ouverts au registre', ...L)
  await osint(env, 'log', ...L, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'survives', refutations: [
    { test: "L'image est-elle ancienne ?", result: 'Non : 2024-06-12, la plus récente des quatre' },
    { test: "L'adresse est-elle une domiciliation ?", result: 'Non : deux sociétés seulement à cette porte, la boulangerie et sa SCI' },
  ] }), ...L)
  await osint(env, 'log', ...L, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { identity: 'high', history: 'medium' },
    criteria: { identity: "Le registre, OpenStreetMap et l'enseigne sur une image de 2024 s'accordent", history: 'La fermeture de la pharmacie est datée par le registre ; les images de 2016, 2019 et 2024 restent à comparer une à une' },
    alternatives: [{ hyp: 'H02', test: 'Une image au sol plus récente que 2024-06-12, ou un nouvel établissement au registre à cette adresse' }, { hyp: 'H04', test: 'Comparer les orthophotos IGN 2016-2020 et actuelle, et les images au sol de 2016 et 2024' }], unresolved: [],
  }), ...L)
  await osint(env, 'next', '--file', json([
    { label: 'Comparer la place dans le temps', why: 'les orthophotos IGN depuis 1950 et les versions Esri Wayback', minutes: 15, prompt: "[place:history] 1 PLACE DE L'EXEMPLE 99999 EXEMPLEVILLE" },
    { label: "Ouvrir une enquête sur l'Épicerie Martin", why: 'la voisine, au registre et dans OpenStreetMap', minutes: 15, prompt: '[pivot:company-fr] EPICERIE MARTIN — from Entities/EPICERIE MARTIN.md' },
  ]), ...L)

  // stage 10 — a person: Jeanne Durand, the bakery's fictitious manager (born 1961-04), from her officer entity in the
  // company case. The supplier was given three identifiers: her bakery's Instagram name, an address, a phone number
  // (in a block the ARCEP keeps for fiction: it reaches no one). Three child cases; the town stays an identifier.
  const PD = path.join(home, 'jeanne-durand'), PP = ['-p', 'jeanne-durand']
  const UN = 'durand-bakery-jeanne-durand', EM = 'jeanne-durand-bakery-example', TEL = 'telephone-de-jeanne-durand'
  await osint(env, 'new', 'person', 'Jeanne Durand', '--lang', 'fr', '--parent', 'boulangerie-durand-sarl', '--from', 'Entities/Jeanne Durand.md',
    '--in', 'identifiers=pseudo: durand.bakery\njeanne@durand-bakery.example\n+33 6 39 98 12 34\nville: Exempleville',
    '--question', 'Les identifiants donnés pour le contrat sont-ils bien ceux de Jeanne Durand, gérante de la Boulangerie Durand ?',
    '--frame', 'purpose=Vérifier l\'identité de la gérante avant de signer un contrat de fourniture',
    '--frame', 'legal_basis=Intérêt légitime — vérification d\'un cocontractant, données professionnelles seulement', '--frame', 'noisy=never')
  await osint(env, 'log', ...PP, '--phase', 'plan', 'Un identifiant par ligne, chacun avec sa raison')
  await osint(env, 'person', 'plan', '--file', json([
    { line: 'pseudo: durand.bakery', why: 'Le compte Instagram de la boulangerie, qu\'elle dit tenir : parle-t-il en son nom ?' },
    { line: 'jeanne@durand-bakery.example', why: 'L\'adresse donnée pour le contrat : est-elle sur le domaine de la boulangerie ?' },
    { line: '+33 6 39 98 12 34', why: 'Le numéro donné pour le contrat : est-il attribué ?' },
    { line: 'ville: Exempleville', why: 'La ville du siège : correspond-elle au registre ?' },
  ]), ...PP)
  await osint(env, 'log', ...PP, '--phase', 'children', 'Trois enquêtes enfants choisies : le pseudo, l\'adresse, le numéro ; la ville reste un identifiant')
  await osint(env, 'new', 'username', 'durand.bakery', '--title', 'durand.bakery (Jeanne Durand)', '--lang', 'fr', '--parent', 'jeanne-durand',
    '--from', 'Entities/durand.bakery.md', '--question', 'Le compte durand.bakery parle-t-il au nom de Jeanne Durand ?')
  await osint(env, 'username', 'check', '-p', UN)
  const ig = (await osint(env, 'source', 'https://www.instagram.com/durand.bakery/', '--reliability', 'B', '-p', UN)).split(':')[0].trim()
  await osint(env, 'clue', 'La bio Instagram renvoie vers durand-bakery.example, le site de la boulangerie qu\'elle gère', '--status', 'read', '--sources', ig,
    '--title', 'Instagram renvoie au site de la boulangerie', '-p', UN)
  await osint(env, 'new', 'email', 'jeanne@durand-bakery.example', '--lang', 'fr', '--parent', 'jeanne-durand',
    '--from', 'Entities/jeanne@durand-bakery.example.md', '--question', 'L\'adresse jeanne@durand-bakery.example est-elle celle de Jeanne Durand ?')
  await osint(env, 'email', 'collect', '-p', EM)
  await osint(env, 'clue', 'L\'adresse est sur durand-bakery.example, le domaine de la boulangerie, et porte son prénom', '--status', 'observed',
    '--title', 'Prénom sur le domaine de la boulangerie', '-p', EM)
  await osint(env, 'new', 'phone', '+33 6 39 98 12 34', '--title', 'Téléphone de Jeanne Durand', '--lang', 'fr', '--parent', 'jeanne-durand',
    '--from', 'Entities/+33639981234.md', '--question', 'Le numéro donné pour le contrat est-il celui de Jeanne Durand ?')
  await osint(env, 'phone', 'collect', '-p', TEL)
  await osint(env, 'log', ...PP, '--phase', 'consolidate', 'Chaque identifiant pesé avec un indice de son enquête')
  await osint(env, 'person', 'lr', 'durand.bakery', '--case', UN, '--clue', clueId(path.join(home, UN), 'Instagram renvoie'), '--lr', '5',
    '--why', 'Le compte est celui de la boulangerie dont elle est la gérante au registre', ...PP)
  await osint(env, 'person', 'lr', 'jeanne@durand-bakery.example', '--case', EM, '--clue', clueId(path.join(home, EM), 'Prénom sur le domaine'), '--lr', '3',
    '--why', 'Son prénom sur le domaine de la boulangerie qu\'elle gère', ...PP)
  await osint(env, 'person', 'lr', '+33639981234', '--case', TEL, '--clue', clueId(path.join(home, TEL), 'Bloc réservé'), '--lr', '0.05',
    '--why', 'Le numéro n\'est attribué à personne : il ne peut pas être le sien', ...PP)
  const profiled = /\^(j\d+)/.exec(await osint(env, 'person', 'consolidate', ...PP))[1]
  await osint(env, 'log', ...PP, '--phase', 'analyse', 'À qui sont ces identifiants ?')
  await osint(env, 'hyp', 'add', 'Le compte durand.bakery et l\'adresse jeanne@ sont ceux de Jeanne Durand ; le numéro donné n\'est attribué à personne', '--level', 'identity',
    '--refute-if', 'Une autre personne signe le compte ou l\'adresse, ou le numéro est attribué', ...PP)
  await osint(env, 'hyp', 'add', 'Ces identifiants sont ceux d\'une homonyme ou d\'un tiers', '--level', 'identity',
    '--refute-if', 'Le registre relie Jeanne Durand à la boulangerie qui tient le compte et le domaine', ...PP)
  await osint(env, 'clue', 'Profil consolidé : le compte et l\'adresse renvoient à la boulangerie dont elle est gérante au registre ; le numéro est dans une tranche réservée à la fiction',
    '--status', 'read', '--journal', profiled, '--title', 'Profil consolidé', ...PP)
  const sum = clueId(PD, 'Profil consolidé')
  await osint(env, 'hyp', 'lr', 'H01', '--clue', sum, '--lr', '5', '--why', 'Le registre, le compte et le domaine se rejoignent', ...PP)
  await osint(env, 'hyp', 'lr', 'H02', '--clue', sum, '--lr', '0.3', '--why', 'Une homonyme ne serait pas gérante de la boulangerie qui tient ce compte', ...PP)
  await osint(env, 'log', ...PP, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'weakened', refutations: [
    { test: 'Le compte Instagram pourrait-il être tenu par un salarié ?', result: 'Possible : il parle au nom de la boulangerie, pas d\'elle seule' },
    { test: 'Une homonyme du même mois de naissance ?', result: 'Non : le registre ne donne qu\'une Jeanne Durand née en 1961-04 à ce siège' },
  ] }), ...PP)
  await osint(env, 'log', ...PP, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { identity: 'medium' },
    criteria: { identity: 'Un lien pour chaque identifiant retenu (le registre pour la boulangerie, le site pour le compte et l\'adresse) ; le numéro écarté' },
    alternatives: [{ hyp: 'H02', test: 'Demander à la boulangerie qui tient le compte Instagram, et un numéro attribué' }], unresolved: [],
  }), ...PP)
  await osint(env, 'next', '--file', json([
    { label: 'Demander un numéro attribué à la boulangerie', why: 'le numéro donné n\'est attribué à personne', minutes: 5, prompt: '[question] Demander à la boulangerie un numéro de téléphone attribué' },
    { label: 'Comparer la ville donnée au siège du registre', why: 'Exempleville est-elle la ville du siège de la boulangerie ?', minutes: 5, prompt: '[question] La ville donnée, Exempleville, est-elle celle du siège au registre ?' },
  ]), ...PP)
  // a type of the cases folder's own (.osint-types/), as the agent makes one from a copy of a plugin type, and a
  // finished case of it: its card carries the « Private » badge, its pivot shows on the entity durand-bakery.example
  fs.cpSync(path.join(FIXTURES, 'osint-types'), path.join(home, '.osint-types'), { recursive: true })
  const A = ['-p', 'durand-shop-audit'], SA = path.join(home, 'durand-shop-audit')
  await osint(env, 'new', 'shop-audit', 'durand-bakery.example', '--title', 'Durand shop audit', '--lang', 'fr',
    '--question', 'Peut-on commander en gros à la boulangerie Durand en confiance ?', '--frame', 'noisy=never', '--frame', 'purpose=Une commande en gros pour un mariage')
  await osint(env, 'log', ...A, '--phase', 'collect', 'Lecture de la page d\'accueil et des mentions légales')
  await osint(env, 'shop-audit', 'collect', ...A)
  await osint(env, 'log', ...A, '--phase', 'analyse', 'Le vendeur est-il identifié et joignable ?')
  await osint(env, 'hyp', 'add', 'Le vendeur est identifié et joignable', '--level', 'seller', '--refute-if', 'Les mentions légales ne donnent ni SIREN valide ni moyen de contact', ...A)
  await osint(env, 'hyp', 'add', 'Le vendeur n\'est pas identifiable', '--level', 'seller', '--refute-if', 'Un SIREN valide figure dans les mentions légales', ...A)
  const sa = { siren: clueId(SA, 'SIREN 456'), contact: clueId(SA, 'Contact'), terms: clueId(SA, 'Conditions générales'), mediator: clueId(SA, 'Médiateur') }
  await osint(env, 'hyp', 'lr', 'H01', '--clue', sa.siren, '--lr', '20', '--why', 'Les mentions légales donnent le SIREN de la boulangerie, qui passe la clé de Luhn', ...A)
  await osint(env, 'hyp', 'lr', 'H01', '--clue', sa.contact, '--lr', '3', '--why', 'Une adresse de contact sur la page d\'accueil', ...A)
  await osint(env, 'hyp', 'exclude', 'H02', '--clue', sa.siren, '--why', 'Un SIREN valide est lu dans les mentions légales', ...A)
  await osint(env, 'log', ...A, '--phase', 'redteam', 'Red team sur H01')
  await osint(env, 'redteam', '--file', json({ target: 'H01', outcome: 'weakened', refutations: [
    { test: 'Le SIREN est-il celui d\'une autre société ?', result: 'Non : la même raison sociale est nommée comme éditeur' },
    { test: 'Les conditions de vente et le médiateur sont-ils publiés ?', result: 'Ni depuis l\'accueil ni dans les mentions légales : à lire sur la page de commande' },
  ] }), ...A)
  await osint(env, 'log', ...A, '--phase', 'conclude', 'Conclusion')
  await osint(env, 'conclude', '--file', json({
    answer: 'H01', confidence: { seller: 'medium' },
    criteria: { seller: 'Vendeur nommé avec un SIREN valide et une adresse de contact, sans conditions générales de vente ni médiateur trouvés' },
    alternatives: [], unresolved: [sa.terms, sa.mediator],
  }), ...A)
  await osint(env, 'log', ...A, '--phase', 'leads', 'Pistes')
  await osint(env, 'next', '--file', json([
    { label: 'Lire les conditions générales sur la page de commande', why: 'droit de rétractation, livraison, médiateur', minutes: 5, prompt: '[shop-audit:read-terms] durand-bakery.example' },
  ]), ...A)
  // the watch: the finished case watched every 24 h since « yesterday », then its pass, due now: crt.sh (a second fake
  // over a copy of the fixtures) has three more certificates, the rest has not changed. Last, so that no identifier
  // an earlier case expects is moved
  await osint({ ...env, OSINT_SERVE: '0', OSINT_NOW: new Date(Date.now() - 25 * 3600e3).toISOString() }, 'watch', ...P, '--every', '24h')
  const later = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-demo-later-'))
  fs.cpSync(FIXTURES, later, { recursive: true })
  const crt = path.join(later, 'crtsh', 'durand-bakery.example.json')
  fs.writeFileSync(crt, JSON.stringify([...JSON.parse(fs.readFileSync(crt, 'utf8')), ...NEW_CERTS]))
  const f2 = await startFake({ fixtures: later })
  try { await osint({ ...env, ...fakeEnv(f2.url, later), OSINT_SERVE: '0' }, 'watch', '--due') } finally {
    f2.close()
    fs.rmSync(later, { recursive: true, force: true })
  }
  // the PDF of each finished case, the first one with the Journal appended: this machine's browser, or the tests' fake
  // (OSINT_BROWSER); without a browser the demo goes on, and Print view still works. Last: after the cases of every stage
  for (const slug of listCases(home).filter(s => readNote(path.join(home, s, 'Case.md')).props.status === 'done')) {
    await osint(env, 'export', '-p', slug, ...(slug === 'durand-bakery-example' ? ['--journal'] : []))
      .catch(e => console.warn(`demo: no PDF for ${slug} (${e.message}); Print view still works`))
  }
}
