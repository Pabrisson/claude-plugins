// The routers' rate limits. Kie: 20 new generations per 10 s for the account, the 21st answered 429 and not queued
// (measured 2026-10-31, invalid requests count too). OpenRouter: no platform cap on paid models, a model's own
// limit answers 429 with Retry-After (its docs, 2026-10-31). Nothing is billed for a 429
const sleep = ms => new Promise(ok => setTimeout(ok, ms))

// at most n starts per ms in this process: the next one waits for the oldest to leave the window
// ponytail: per process; the dashboard and a CLI run at once share nothing, the 429 retry covers the overflow
export function windowed(n, ms) {
  const starts = []
  return async function slot(onWait) {
    for (;;) {
      const now = Date.now()
      while (starts.length && now - starts[0] >= ms) starts.shift()
      if (starts.length < n) return void starts.push(now)
      onWait?.()
      await sleep(ms - (now - starts[0]) + 5)
    }
  }
}

// fn again after a 429 (error.status), waiting what the error says (retryAfter, in ms) or `wait`, `tries` times in all
export async function retry429(fn, { tries = 5, wait = 10e3, onWait } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) {
      if (e.status !== 429 || i >= tries) throw e
      onWait?.(e)
      await sleep(e.retryAfter ?? wait)
    }
  }
}

// Retry-After in seconds or as a date, else X-RateLimit-Reset (ms since the epoch): how long to wait, in ms
export function retryAfter(headers) {
  const ra = headers.get('retry-after'), reset = headers.get('x-ratelimit-reset')
  if (ra) return /^\d+$/.test(ra) ? +ra * 1000 : Math.max(0, Date.parse(ra) - Date.now())
  if (reset && /^\d+$/.test(reset)) return Math.max(0, +reset - Date.now())
  return undefined
}
