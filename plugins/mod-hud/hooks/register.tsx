import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

const tools = atom({ plugin: 'mod-hud', key: 'tools' } as const, null)
const active = atom({ plugin: 'mod-hud', key: 'active' } as const, null)
const effort = atom({ plugin: 'mod-hud', key: 'effort' } as const, null)
const branch = atom({ plugin: 'mod-hud', key: 'branch' } as const, null)
const latest = atom({ plugin: 'mod-hud', key: 'latest' } as const, null)
const upgrade = atom({ plugin: 'mod-hud', key: 'upgrade' } as const, 'idle')
// /clear wipes all of $.state, and classic.SessionStart, which could set it again, never reaches a user mod
// on a Team plan (cc-plugin-sec-default bypasses it): the last effort and branch seen stay until a turn sets them anew
let effortSeen: string | null = null
let branchSeen: string | null = null

const BREW_API = 'https://formulae.brew.sh/api/cask/claude-code@latest.json'
const BREW_RB = 'https://raw.githubusercontent.com/Homebrew/homebrew-cask/HEAD/Casks/c/claude-code%40latest.rb'
const HOUR = 3_600_000
// rows that may quote another row's words: the model's replies, tool output, compaction summaries
const QUOTING_DOORS: readonly string[] = ['response', 'tool-result', 'tool-message', 'compaction']
const BAR = 10
// the ports mod's pane toggle: plain Unicode, drawn by any font (VS Code's terminal has no Nerd Font icons)
const PORTS = '⇄'

// text colors are theme keys, so the hud follows /theme; the gauges keep the Claude palette
const C = {
  accent: 'claude',
  dir: 'text',
  branch: 'planMode',
  bolt: 'warning',
  muted: 'inactive',
  sep: 'subtle',
  update: 'warning',
  olive: '#788c5d',
  kraft: '#d4a27f',
  clay: '#d97757',
  ink: '#141413',
  track: '#3d3d3a',
}
const EFFORT: Record<string, [string, string]> = {
  low: ['○', 'Low'],
  medium: ['◐', 'Medium'],
  high: ['●', 'High'],
  xhigh: ['◉', 'xHigh'],
  max: ['◈', 'Max'],
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const d = Math.floor((Date.parse(iso) - now) / 1000)
  if (d <= 0) return 'now'
  const days = Math.floor(d / 86400)
  const h = Math.floor((d % 86400) / 3600)
  const m = Math.floor((d % 3600) / 60)
  return days ? `${days}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

// 323000 → 323k, 1000000 → 1M, 1500000 → 1.5M
const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.floor(n / 1000)}k`)

// a true pill for the desktop, which draws SVG: continuous fill, label centered
const PILL = { w: 84, h: 16 }
const pill = (pct: number, label: string, fill: string) => {
  const { w, h } = PILL
  const fw = (w * Math.min(100, Math.max(0, pct))) / 100
  // baseline set by hand (digits are ~0.72em tall): dominant-baseline is not honoured everywhere
  const y = h / 2 + 11 * 0.36
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    '<style>.t{fill:#e8e6dc}.m{fill:#6b6a65}@media (prefers-color-scheme:dark){.t{fill:#3d3d3a}.m{fill:#9ca2af}}</style>',
    `<defs><clipPath id="p"><rect width="${w}" height="${h}" rx="${h / 2}"/></clipPath>`,
    `<clipPath id="f"><rect width="${fw}" height="${h}"/></clipPath></defs>`,
    `<g clip-path="url(#p)"><rect class="t" width="${w}" height="${h}"/><rect fill="${fill}" width="${fw}" height="${h}"/></g>`,
    `<g font-family="system-ui,sans-serif" font-size="11" font-weight="600" text-anchor="middle">`,
    `<text class="m" x="${w / 2}" y="${y}">${label}</text>`,
    `<text fill="${C.ink}" x="${w / 2}" y="${y}" clip-path="url(#f)">${label}</text></g></svg>`,
  ].join('')
}

const level = (pct: number) => (pct >= 80 ? C.clay : pct >= 50 ? C.kraft : C.olive)

const isNewer = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

// claude-opus-5-5 → Opus 5.5 (a dated id keeps no minor: claude-opus-5-20261001 → Opus 5)
const modelLabel = (id: string) => {
  const [, family, major, minor] = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/) ?? []
  return family && major ? `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}` : id
}

const toolLabel = (tool: string) => {
  const [, server, fn] = tool.match(/^mcp__(.+?)__(.+)$/) ?? []
  return server && fn ? `${fn} (${server})` : tool
}

// $.process is CLI only: the branch comes from .git/HEAD (found upward, worktrees too) so the desktop has it
const readHead = async ($: EngineInterface, dir: string) => {
  const head = await $.fs.read(`${dir}/.git/HEAD`).catch(() => null)
  if (head !== null) return head
  const gitdir = (await $.fs.read(`${dir}/.git`).catch(() => '')).match(/^gitdir: (.+)$/m)?.[1]
  return gitdir ? $.fs.read(`${gitdir.startsWith('/') ? gitdir : `${dir}/${gitdir}`}/HEAD`).catch(() => null) : null
}

const refreshBranch = async ($: EngineInterface) => {
  let name: string | null = null
  for (let dir = await $.session.cwd(); dir; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    const head = await readHead($, dir)
    if (head !== null) {
      name = head.match(/^ref: refs\/heads\/(.+)$/m)?.[1] ?? head.trim().slice(0, 7)
      break
    }
  }
  await update($, branch, () => name)
}

const fetchLatest = async ($: EngineInterface) => {
  const get = (url: string) => $.http.fetch(url).then(r => (r.ok ? r.text : ''), () => '')
  let version: unknown
  try {
    version = JSON.parse(await get(BREW_API)).version
  } catch {}
  // fallback in case the brew API changes again
  if (typeof version !== 'string') version = (await get(BREW_RB)).match(/version "([^"]+)"/)?.[1]
  if (typeof version === 'string') await update($, latest, () => version as string)
}

const runUpgrade = async ($: EngineInterface) => {
  await update($, upgrade, () => 'running')
  const r = await $.process.run(['brew', 'upgrade', 'claude-code@latest'], { timeoutMs: 600_000 }).catch(
    (err: unknown) => ({ exitCode: 1, stderr: String(err) }),
  )
  if (r.exitCode !== 0) {
    $.ui.toast(`brew upgrade failed: ${r.stderr.trim().split('\n').pop() ?? ''}`, { timeoutMs: 8000 })
  }
  await update($, upgrade, () => (r.exitCode === 0 ? 'done' : 'idle'))
}

// one toast when a figure crosses its threshold, re-armed once it falls back under
const alerted = new Set<string>()
const alert = ($: EngineInterface, key: string, pct: number, threshold: number, text: string) => {
  if (pct < threshold) alerted.delete(key)
  else if (!alerted.has(key)) {
    alerted.add(key)
    $.ui.toast(text, { timeoutMs: 8000 })
  }
}

const checkAlerts = async ($: EngineInterface) => {
  const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const ctx = usage.context.percent
  if (ctx !== undefined) alert($, 'ctx', ctx, 85, `Context at ${Math.round(ctx)}%: consider /compact`)
  const five = usage.rateLimits.find(r => r.kind === 'five_hour')
  if (five) {
    const reset = until(five.resetsAt, now)
    alert($, '5h', five.percentUsed, 90, `5h usage at ${Math.round(five.percentUsed)}%${reset ? `, resets in ${reset}` : ''}`)
  }
}

type Fit = { resets: boolean; cost: boolean; tokens: boolean }
// widest first: line 2 drops the reset times, then the cost, then the ctx tokens, until it fits
const FITS: readonly Fit[] = [
  { resets: true, cost: true, tokens: true },
  { resets: false, cost: true, tokens: true },
  { resets: false, cost: false, tokens: true },
  { resets: false, cost: false, tokens: false },
]

// the hud's lines: all of them on the terminal; on the desktop, folder, branch and tools then the usage bars
const hudLines = async (
  $: EngineInterface,
  els: Elements[keyof Elements],
  view: { isCli: boolean; columns: number },
) => {
  const { Box, Text, Button } = els
  const Svg = 'Svg' in els ? els.Svg : undefined
  const { isCli } = view

  const [model, cwd, usage, version, now, t, act, effNow, brNow, lat, up] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.session.usage(),
    $.session.version(),
    $.clock.now(),
    read($, tools),
    read($, active),
    read($, effort),
    read($, branch),
    read($, latest),
    read($, upgrade),
  ])
  effortSeen = effNow ?? effortSeen
  branchSeen = brNow ?? branchSeen
  const eff = effortSeen
  const br = branchSeen
  // the desktop drops spaces at the edges of each element and they read tight there: double them, non-breaking
  const gap = (s: string) => (isCli ? s : s.replace(/^ | $/g, '  '))
  const sep = (s: string) => <Text color={C.sep}>{gap(s)}</Text>

  // line 1: model • effort | folder • branch • ⚡ tools (desktop: no model, no effort)
  const [glyph, label] = eff ? (EFFORT[eff] ?? ['●', eff]) : []
  const work =
    t || act
      ? [
          <Text color={C.bolt}>{gap(`⚡ ${t?.count ?? 0} `)}</Text>,
          act ? <Text color={C.bolt}>{gap(`${toolLabel(act.name)} running `)}</Text> : null,
          !act && t ? <Text color={C.muted}>{gap(`${toolLabel(t.name)} `)}</Text> : null,
          <Text color={C.muted} dimColor>{ago(now - (act ?? t)!.at)}</Text>,
        ]
      : []
  const dirText = <Text color={C.dir} bold>{cwd.split('/').pop()}</Text>
  const branchText = br ? <Text color={C.branch} bold>{br}</Text> : null
  // the desktop shows model and effort itself: folder • branch • tools there, flat like line 2
  const info = !isCli ? (
    <Box alignItems="center">{[dirText, br ? sep(' • ') : null, branchText, work.length ? sep(' • ') : null, ...work]}</Box>
  ) : (
    <Text wrap="truncate">
      <Text color={C.accent} bold>{modelLabel(model)}</Text>
      {eff ? sep(' • ') : null}
      {eff ? <Text color={C.accent}>{`${glyph} `}</Text> : null}
      {eff ? <Text color={C.muted}>{label}</Text> : null}
      {sep(' | ')}
      {dirText}
      {br ? sep(' • ') : null}
      {branchText}
      {work.length ? sep(' • ') : null}
      {work}
    </Text>
  )
  // the ports toggle, always: the ports mod answers the press (its pane); without it, this toast.
  // terminal: ends the rule as `[⇄]`, drawn like the engine's `[-]` beside it (dim at rest, the pointer
  // inverts it at full strength); desktop: right of line 1
  const ports = (
    <Button key="ports" plain dimColor={isCli} onPress={() => $.ui.toast('ports: mod not loaded')}>
      {isCli ? `[${PORTS}]` : <Text color={C.muted}>{PORTS}</Text>}
    </Button>
  )
  const line1 = isCli ? (
    info
  ) : (
    <Box justifyContent="space-between" alignItems="center">
      {info}
      {ports}
    </Box>
  )

  // line 2: 5h • 7d | ctx | $, each figure a gauge: on the terminal a thin line then the percentage, no
  // background (a background fills the whole cell, line height included, and touches the rows around);
  // on the desktop an SVG pill with the percentage centered inside
  const quotas = [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
  ].flatMap(([kind, name]) => {
    const q = usage.rateLimits.find(r => r.kind === kind)
    return q && name ? [{ name, pct: q.percentUsed, detail: until(q.resetsAt, now) }] : []
  })
  const ctx = usage.context
  const ctxTokens = ctx.tokens === undefined ? '' : `${tokens(ctx.tokens)}/${tokens(ctx.window)}`
  // hidden until it rounds above $0.00
  const usd = usage.cost?.usd ?? 0
  const cost = usd >= 0.005 ? `$${usd.toFixed(2)}` : ''
  const width = (fit: Fit) => {
    const meter = (name: string, pct: number, detail: string) =>
      name.length + 1 + BAR + 1 + `${Math.round(pct)}%`.length + (detail ? detail.length + 3 : 0)
    const parts = [
      ...quotas.map(q => meter(q.name, q.pct, fit.resets ? q.detail : '')),
      ...(ctx.percent === undefined ? [] : [meter('ctx', ctx.percent, fit.tokens ? ctxTokens : '')]),
      ...(fit.cost && cost ? [cost.length] : []),
    ]
    return parts.reduce((sum, w) => sum + w, 0) + 3 * Math.max(0, parts.length - 1)
  }
  const fit = isCli ? (FITS.find(f => width(f) <= view.columns) ?? FITS[FITS.length - 1]!) : FITS[0]!

  const meter = (name: string, pct: number, detail: string) => {
    const n = Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR)
    const label = `${Math.round(pct)}%`
    const fill = level(pct)
    const bar =
      isCli || !Svg
        ? [
            n ? <Text color={fill}>{'━'.repeat(n)}</Text> : null,
            n < BAR ? <Text color={C.track}>{'─'.repeat(BAR - n)}</Text> : null,
            <Text color={fill} bold>{` ${label}`}</Text>,
          ]
        : [<Svg source={pill(pct, label, fill)} alt={`${name} ${label}`} width={PILL.w} height={PILL.h} />]
    return [
      <Text color={C.muted}>{gap(`${name} `)}</Text>,
      ...bar,
      detail ? <Text color={C.muted} dimColor>{gap(` (${detail})`)}</Text> : null,
    ]
  }
  const quotaMeters = quotas.map(q => meter(q.name, q.pct, fit.resets ? q.detail : ''))
  const ctxMeter = ctx.percent === undefined ? [] : meter('ctx', ctx.percent, fit.tokens ? ctxTokens : '')
  const parts = [
    ...quotaMeters.flatMap((q, i) => (i ? [sep(' • '), ...q] : q)),
    quotaMeters.length && ctxMeter.length ? sep(' | ') : null,
    ...ctxMeter,
    fit.cost && cost ? sep(' | ') : null,
    fit.cost && cost ? <Text color={C.muted}>{cost}</Text> : null,
  ]
  const line2 = isCli ? <Text wrap="truncate">{parts}</Text> : <Box alignItems="center">{parts}</Box>

  // line 3: update available
  const current = version.base ?? version.version
  const line3 =
    lat && isNewer(lat, current) ? (
      up === 'done' ? (
        <Text color="success">{`✓ Claude Code ${lat} installed, restart Claude to use it`}</Text>
      ) : (
        <Box gap={1}>
          <Text color={C.update}>{`↑ Update: ${current} → ${lat}`}</Text>
          {up === 'running' ? (
            <Text color={C.muted} dimColor>updating…</Text>
          ) : (
            <Button key="upgrade" label="Update" onPress={() => void runUpgrade($)} />
          )}
        </Box>
      )
    ) : null

  return { line1, line2, line3, ports }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { effortLevel } = (await $.settings.read()) as { effortLevel?: unknown }
    if (typeof effortLevel === 'string') await update($, effort, v => v ?? effortLevel)
    await refreshBranch($)
    void fetchLatest($)
    $.clock.every(1000, () => {
      $.ui.invalidate('ui.render')
      void checkAlerts($)
    })
    $.clock.every(HOUR, () => void fetchLatest($))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) await update($, effort, () => String(e.effort))

    return yield* next(e)
  })

  // /effort sends no model request and its picker returns no text to command.run:
  // read the output row it appends ("Set effort level to max …"), skipping rows that may quote it
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (!QUOTING_DOORS.includes(e.door)) {
      const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
      const level = text.match(/Set effort level to (\w+)/)?.[1]
      if (level) await update($, effort, () => level)
    }

    return stored
  }).catch(($, e, next) => next(e))

  // the running tool shows live ("Bash running 3s"); once done it counts and stays as the last one
  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, active, a => ({ name: e.tool, at, n: (a?.n ?? 0) + 1 }))
    try {
      const ran = await next(e)
      const done = await $.clock.now()
      await update($, tools, t => ({ count: (t?.count ?? 0) + 1, name: e.tool, at: done }))

      return ran
    } finally {
      await update($, active, a => (a && a.n > 1 ? { ...a, n: a.n - 1 } : null))
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshBranch($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const isCli = e.surface === 'terminal'
    const view = { isCli, columns: e.props.bodyColumns }
    const { line1, line2, line3, ports } = await hudLines($, els, view)
    // what other mods draw in the band (savvy-progress's bar) stays, under the hud
    const below = await next(e)

    // desktop: folder, branch and tools, then the usage bars (no rule, no update line)
    if (!isCli) {
      return (
        <Box flexDirection="column">
          {line1}
          {line2}
          {below}
        </Box>
      )
    }

    // the prompt's own border closes the hud below: one rule above is enough
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text color={C.sep}>{'─'.repeat(Math.max(0, e.props.bodyColumns - 4))}</Text>
          {ports}
        </Box>
        {line1}
        {line2}
        {line3}
        {below}
      </Box>
    )
  })
}
