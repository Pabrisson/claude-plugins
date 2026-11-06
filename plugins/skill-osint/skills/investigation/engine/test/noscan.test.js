// The rule of the ip type (spec § 11.7, the frame is `noisy` and nothing here is): no scan, no ping, no connection to
// the address under study — registries and published lists only. Proved two ways: a whole ip case (every step, a
// refresh) opens no TCP connection but to the fake APIs, never to the address; and the type's code opens no socket,
// starts no process and resolves no address by itself.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, ENGINE, FIXTURES, run } from './helpers.js'

const IP_ENGINE = path.join(path.dirname(ENGINE), '..', 'types', 'ip', 'engine.js')

test('a whole ip case opens no connection to the address it studies, only to the fake APIs', async () => {
  const fake = await startFake(), home = casesFolder(), log = path.join(home, 'sockets.log')
  const env = { ...fakeEnv(fake.url), OSINT_SOCKET_LOG: log, NODE_OPTIONS: `--import=${pathToFileURL(path.join(FIXTURES, 'sockets-hook.mjs')).href}` }
  try {
    for (const [ip, slug] of [['192.0.2.10', '192-0-2-10'], ['2606:4700:4700::1111', 'ip-v6']]) {
      assert.equal((await run(home, ['new', 'ip', ip, '--title', slug, '--question', `Who operates ${ip}?`, '--frame', 'noisy=never'], env)).status, 0)
      for (const argv of [['ip', 'collect'], ['refresh']]) {
        const r = await run(home, [...argv, '-p', slug], env)
        assert.equal(r.status, 0, `${argv.join(' ')}: ${r.err}`)
      }
    }
    const seen = fs.readFileSync(log, 'utf8').trim().split('\n')
    assert.ok(seen.includes(`127.0.0.1:${new URL(fake.url).port}`))
    for (const s of seen) assert.equal(s, `127.0.0.1:${new URL(fake.url).port}`, `a connection to ${s}`)
  } finally { fake.close() }
})

test('the ip type opens no socket, starts no process and resolves no address by itself', () => {
  const src = fs.readFileSync(IP_ENGINE, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '')
  assert.doesNotMatch(src, /from ['"](node:)?(net|tls|dgram|dns|http|https|child_process|worker_threads)['"]|require\(/, 'a module that reaches the network on its own')
  assert.doesNotMatch(src, /(?<!ctx\.)\bfetch\(|\bXMLHttpRequest\b|\bspawn|(?<![.\w])exec(File)?(Sync)?\(|\bnmap\b|\bping\b|\btraceroute\b|\blookup\(|\.resolve4\(|\.resolve6\(|\breverse\(/, 'a call that reaches the network on its own')
  // the only way out is ctx.fetch (net.js: a registry or a published list) and ctx.resolver().resolve(<a name>, A|AAAA)
  const outs = [...src.matchAll(/ctx\.(fetch|resolver|python|media|tunnel|sendCopy)\b/g)].map(m => m[1])
  assert.deepEqual([...new Set(outs)].sort(), ['fetch', 'resolver'])
  for (const m of src.matchAll(/ctx\.fetch\('(\w+)'/g)) assert.ok(['rdap', 'ripestat', 'internetdb'].includes(m[1]), `ctx.fetch to ${m[1]}`)
  assert.ok(!/ctx\.fetch\(\s*`/.test(src) && !/ctx\.fetch\(\s*ip\b/.test(src), 'ctx.fetch is given a service name, never an address')
})
