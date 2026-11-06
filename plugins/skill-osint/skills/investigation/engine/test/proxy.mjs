// A local proxy for the live test and the bench: it notes every host the GeoINT scripts reach (HTTPS CONNECT, one JSON
// line each) and refuses the Google AI hosts. GeoINT reads GEO_PROXY: without it, its curl calls ignore HTTPS_PROXY.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { DENY } from '../lib/net.js'

export function startProxy({ log } = {}) {
  const hosts = new Set()
  // ponytail: CONNECT only (every GeoINT call is HTTPS); forward plain http:// requests if one ever needs it
  const server = http.createServer((req, res) => { res.writeHead(405); res.end('CONNECT only') })
  server.on('connect', (req, sock, head) => {
    const [host, port = '443'] = String(req.url).split(':'), refused = DENY.has(host)
    hosts.add(host)
    if (log) fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), host, port: Number(port), refused }) + '\n')
    if (refused) return sock.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    const up = net.connect(Number(port), host, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up) })
    up.on('error', () => sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
    sock.on('error', () => up.destroy())
  })
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, hosts, close: () => server.close() })))
}
