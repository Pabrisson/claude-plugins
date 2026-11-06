import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startProxy } from './proxy.mjs'

test('the proxy relays a CONNECT to the host asked and notes it; a Google AI host is refused and noted', async () => {
  const echo = net.createServer(s => s.pipe(s))
  await new Promise(ok => echo.listen(0, '127.0.0.1', ok))
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-proxy-')), 'hosts.jsonl'), p = await startProxy({ log })
  const talk = target => new Promise((ok, ko) => {
    const s = net.connect(Number(new URL(p.url).port), '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`))
    let b = '', through = false
    s.on('data', x => {
      b += x
      if (!through && b.includes('\r\n\r\n')) {
        if (!b.startsWith('HTTP/1.1 200')) { s.end(); return ok(b.split('\r\n')[0]) }
        through = true; b = ''; s.write('ping')
      } else if (through && b === 'ping') { s.end(); ok('relayed ping') }
    })
    s.on('error', ko)
  })
  try {
    assert.equal(await talk(`127.0.0.1:${echo.address().port}`), 'relayed ping')
    assert.equal(await talk('generativelanguage.googleapis.com:443'), 'HTTP/1.1 403 Forbidden')
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(h => [h.host, h.refused]), [['127.0.0.1', false], ['generativelanguage.googleapis.com', true]])
  } finally { p.close(); echo.close() }
})
