import { atom, read, update } from 'claude-code'
import type { AgentStatus, Elements, EngineInterface, Register } from 'claude-code'
import type { HudLoop } from '../types'

// keyed by loop: '' the main conversation, else the agent's id
const loops = atom({ plugin: 'mod-hud', key: 'loops' } as const, {})
const effort = atom({ plugin: 'mod-hud', key: 'effort' } as const, null)
const branch = atom({ plugin: 'mod-hud', key: 'branch' } as const, null)
const latest = atom({ plugin: 'mod-hud', key: 'latest' } as const, null)
const upgrade = atom({ plugin: 'mod-hud', key: 'upgrade' } as const, 'idle')
// /clear wipes all of $.state, and classic.SessionStart, which could set it again, never reaches a user mod
// on a Team plan (cc-plugin-sec-default bypasses it): the last effort and branch seen stay until a turn sets them anew
let effortSeen: string | null = null
let branchSeen: string | null = null

const BREW_API = 'https://formulae.brew.sh/api/cask/'
const BREW_RB = 'https://raw.githubusercontent.com/Homebrew/homebrew-cask/HEAD/Casks/c/'
// Claude's own release channels (latest, stable): the version as plain text, the same as npm's
const RELEASES = 'https://downloads.claude.ai/claude-code-releases/'
const HOUR = 3_600_000
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

// plain Unicode, no emoji: drawn by any font
const STATUS: Record<AgentStatus, [string, string]> = {
  pending: ['○', C.muted],
  running: ['●', C.bolt],
  waiting: ['◌', C.muted],
  idle: ['◌', C.muted],
  completed: ['✓', 'success'],
  failed: ['✗', 'error'],
  killed: ['⊘', 'error'],
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

// used minus an even pace until the reset (Agent Burn's delta, signed on usage): + burns faster than the window runs out
const pace = (pct: number, iso: string | undefined, span: number, now: number) => {
  if (!iso) return ''
  const d = Math.round(pct - 100 + Math.min(100, Math.max(0, ((Date.parse(iso) - now) / span) * 100)))
  return d > 0 ? `+${d}%` : d < 0 ? `${d}%` : '±0%'
}

// 840 → 840, 323000 → 323k, 1000000 → 1M, 1500000 → 1.5M
const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.floor(n / 1000)}k` : `${n}`)

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

const branchAt = async ($: EngineInterface, start: string) => {
  for (let dir = start; dir; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    const head = await readHead($, dir)
    if (head !== null) return head.match(/^ref: refs\/heads\/(.+)$/m)?.[1] ?? head.trim().slice(0, 7)
  }
  return null
}

const refreshBranch = async ($: EngineInterface) => {
  const name = await branchAt($, await $.session.cwd())
  await update($, branch, () => name)
}

// the `claude` the next launch runs (the PATH's), told apart as Claude Code tells its own install: by its
// resolved path. brew, winget and mise upgrade it; native and npm update themselves through `claude update`,
// which for any other package manager (apk, deb, rpm, pacman, asdf) only prints the command to run
const detect = async ($: EngineInterface) => {
  const r = await $.process.run(['sh', '-c', 'p=$(command -v claude) && echo "$p" && realpath "$p"']).catch(() => null)
  const [bin = 'claude', real = ''] = r?.exitCode === 0 ? r.stdout.trim().split('\n') : []
  const cask = real.match(/\/Caskroom\/([^/]+)\//)?.[1]
  const argv = cask
    ? ['brew', 'upgrade', '--cask', cask]
    : /[/\\]WinGet[/\\]/i.test(real)
      ? ['winget', 'upgrade', '--id', 'Anthropic.ClaudeCode', '--exact', '--silent', '--disable-interactivity']
      : /[/\\]mise[/\\]installs[/\\]/i.test(real)
        ? ['mise', 'upgrade', 'claude']
        : [bin, 'update']
  return { bin, cask, argv }
}

const semver = (s: unknown) => (typeof s === 'string' ? s.trim().match(/^\d+\.\d+\.\d+/)?.[0] : undefined)

const fetchLatest = async ($: EngineInterface) => {
  const get = (url: string) => $.http.fetch(url).then(r => (r.ok ? r.text : ''), () => '')
  const { cask } = await detect($)
  let version: string | undefined
  if (cask) {
    // brew ships each release later than Claude does: the cask's own version is the one brew can install
    try {
      version = semver(JSON.parse(await get(`${BREW_API}${cask}.json`)).version)
    } catch {}
    // fallback in case the brew API changes again
    version ??= semver((await get(`${BREW_RB}${encodeURIComponent(cask)}.rb`)).match(/version "([^"]+)"/)?.[1])
  } else {
    const { autoUpdatesChannel } = (await $.settings.read()) as { autoUpdatesChannel?: unknown }
    version = semver(await get(`${RELEASES}${autoUpdatesChannel === 'stable' ? 'stable' : 'latest'}`))
  }
  if (version) await update($, latest, () => version)
}

const runUpgrade = async ($: EngineInterface) => {
  await update($, upgrade, () => 'running')
  const { bin, argv } = await detect($)
  const r = await $.process.run(argv, { timeoutMs: 600_000 }).catch(
    (err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }),
  )
  // `claude update` exits 0 when it only prints a package manager's command: the version installed tells
  const [v, lat] = await Promise.all([
    $.process.run([bin, '--version']).then(o => semver(o.stdout), () => undefined),
    read($, latest),
  ])
  const done = r.exitCode === 0 && !!v && !!lat && !isNewer(lat, v)
  if (!done) {
    const why = (r.stderr.trim() || r.stdout.trim()).split('\n').pop()?.trim()
    $.ui.toast(`Update not installed: ${why || `${argv.join(' ')} exited ${r.exitCode}`}`, { timeoutMs: 8000 })
  }
  await update($, upgrade, () => (done ? 'done' : 'idle'))
}

const patch = ($: EngineInterface, id: string, fn: (l: HudLoop) => HudLoop) =>
  update($, loops, all => ({ ...all, [id]: fn(all[id] ?? {}) }))

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

// an agent's context, shaped as the session's: its last request's tokens over its model's window
const agentContext = (loop: HudLoop, sessionModel: string, sessionWindow: number) => {
  // ponytail: the window is guessed for a model other than the session's; read it if the API ever gives an agent's
  const window = loop.model === sessionModel ? sessionWindow : /\[1m\]/.test(loop.model ?? '') ? 1_000_000 : 200_000
  return { tokens: loop.ctx, window, percent: loop.ctx === undefined ? undefined : (loop.ctx / window) * 100 }
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
  view: { isCli: boolean; columns: number; agentId?: string },
) => {
  const { Box, Text, Button } = els
  const Svg = 'Svg' in els ? els.Svg : undefined
  const { isCli, agentId } = view

  const [sessionModel, cwd, usage, version, now, all, effNow, brNow, lat, up, agents] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.session.usage(),
    $.session.version(),
    $.clock.now(),
    read($, loops),
    read($, effort),
    read($, branch),
    read($, latest),
    read($, upgrade),
    agentId ? $.agent.list() : [],
  ])
  effortSeen = effNow ?? effortSeen
  branchSeen = brNow ?? branchSeen
  // the agent in view, its transcript opened from the tasks list: its own model, effort, tools and context
  const loop = all[agentId ?? ''] ?? {}
  const place = agents.findIndex(a => a.id === agentId)
  const agent = agents[place]
  const model = agentId ? loop.model : sessionModel
  const eff = agentId ? loop.effort : effortSeen
  const t = loop.tools
  const act = loop.active
  // an agent spawned in a directory of its own shows that one and its branch
  const dir = (agentId && loop.cwd) || cwd
  const br = agentId && loop.cwd ? loop.branch : branchSeen
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
  // the agent line: ▸ name ● status • ◷ time since spawned • Σ tokens generated • ⧉ its place • ✎ its task (last: truncated first)
  const [icon, color] = agent ? STATUS[agent.status] : []
  const end = agent?.status === 'running' ? now : (loop.ended ?? now)
  const facts = [
    loop.started === undefined ? '' : `◷ ${ago(end - loop.started)}`,
    loop.out === undefined ? '' : `Σ ${tokens(loop.out)} tok`,
    agent ? `⧉ ${place + 1}/${agents.length}` : '',
    agent?.description ? `✎ ${agent.description}` : '',
  ].filter(Boolean)
  const who = agentId
    ? [
        <Text color={C.accent} bold>{`▸ ${agent?.name ?? agent?.type ?? 'agent'}`}</Text>,
        agent ? <Text color={color}>{gap(` ${icon} ${agent.status}`)}</Text> : null,
        ...facts.flatMap(f => [sep(' • '), <Text color={C.muted}>{f}</Text>]),
      ]
    : []
  const dirText = <Text color={C.dir} bold>{dir.split('/').pop()}</Text>
  const branchText = br ? <Text color={C.branch} bold>{br}</Text> : null
  // the desktop shows model and effort itself: folder • branch • tools there, flat like line 2
  const info = !isCli ? (
    <Box alignItems="center">{[dirText, br ? sep(' • ') : null, branchText, work.length ? sep(' • ') : null, ...work]}</Box>
  ) : (
    <Text wrap="truncate">
      {model ? <Text color={C.accent} bold>{modelLabel(model)}</Text> : null}
      {model && eff ? sep(' • ') : null}
      {eff ? <Text color={C.accent}>{`${glyph} `}</Text> : null}
      {eff ? <Text color={C.muted}>{label}</Text> : null}
      {model || eff ? sep(' | ') : null}
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
  // the agent in view, on a line of its own above line 1
  const line0 = who.length ? isCli ? <Text wrap="truncate">{who}</Text> : <Box alignItems="center">{who}</Box> : null
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
  const quotas = (
    [
      ['five_hour', '5h', 5 * HOUR],
      ['seven_day', '7d', 168 * HOUR],
    ] as const
  ).flatMap(([kind, name, span]) => {
    const q = usage.rateLimits.find(r => r.kind === kind)
    return q
      ? [{ name, pct: q.percentUsed, detail: until(q.resetsAt, now), delta: pace(q.percentUsed, q.resetsAt, span, now) }]
      : []
  })
  const ctx = agentId ? agentContext(loop, sessionModel, usage.context.window) : usage.context
  const ctxTokens = ctx.tokens === undefined ? '' : `${tokens(ctx.tokens)}/${tokens(ctx.window)}`
  // hidden until it rounds above $0.00
  const usd = usage.cost?.usd ?? 0
  const cost = usd >= 0.005 ? `$${usd.toFixed(2)}` : ''
  const width = (fit: Fit) => {
    const meter = (name: string, pct: number, detail: string, delta = '') =>
      name.length + 1 + BAR + 1 + `${Math.round(pct)}%`.length + (delta ? delta.length + 1 : 0) + (detail ? detail.length + 3 : 0)
    const parts = [
      ...quotas.map(q => meter(q.name, q.pct, fit.resets ? q.detail : '', fit.resets ? q.delta : '')),
      ...(ctx.percent === undefined ? [] : [meter('ctx', ctx.percent, fit.tokens ? ctxTokens : '')]),
      ...(fit.cost && cost ? [cost.length] : []),
    ]
    return parts.reduce((sum, w) => sum + w, 0) + 3 * Math.max(0, parts.length - 1)
  }
  const fit = isCli ? (FITS.find(f => width(f) <= view.columns) ?? FITS[FITS.length - 1]!) : FITS[0]!

  const meter = (name: string, pct: number, detail: string, delta = '') => {
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
      delta ? <Text color={C.muted} dimColor>{gap(` ${delta}`)}</Text> : null,
    ]
  }
  // the delta goes with the reset time on a narrow terminal
  const quotaMeters = quotas.map(q => meter(q.name, q.pct, fit.resets ? q.detail : '', fit.resets ? q.delta : ''))
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

  return { line0, line1, line2, line3, ports }
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
    const id = e.agentId
    if (id === undefined) {
      if (e.effort !== undefined) await update($, effort, () => String(e.effort))
      return yield* next(e)
    }
    const step = yield* next(e)
    const u = step.usage
    await patch($, id, l => ({
      ...l,
      model: e.model,
      effort: e.effort === undefined ? undefined : String(e.effort),
      ctx: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens : l.ctx,
      out: (l.out ?? 0) + (u?.output_tokens ?? 0),
    }))

    return step
  })

  // no session.append hook for /effort's output row: cc-plugin-sec-default continues that event past user mods
  // on a Team plan, so a new /effort level shows from the next turn.step

  // ponytail: only an explicit cwd is known; a worktree-isolated agent's path is not given while it runs
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const id = spawned.agentId
    const { cwd } = e
    if (id) {
      const [started, br] = await Promise.all([$.clock.now(), cwd ? branchAt($, cwd) : null])
      await patch($, id, l => ({ ...l, started, ...(cwd ? { cwd, branch: br ?? undefined } : {}) }))
    }

    return spawned
  }).catch(($, e, next) => next(e))

  // the running tool shows live ("Bash running 3s"); once done it counts and stays as the last one, per loop
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? ''
    const at = await $.clock.now()
    await patch($, id, l => ({ ...l, active: { name: e.tool, at, n: (l.active?.n ?? 0) + 1 } }))
    try {
      const ran = await next(e)
      const done = await $.clock.now()
      await patch($, id, l => ({ ...l, tools: { count: (l.tools?.count ?? 0) + 1, name: e.tool, at: done } }))

      return ran
    } finally {
      await patch($, id, ({ active: a, ...l }) => (a && a.n > 1 ? { ...l, active: { ...a, n: a.n - 1 } } : l))
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshBranch($)
    const id = e.agentId
    if (id !== undefined) {
      const ended = await $.clock.now()
      await patch($, id, l => ({ ...l, ended }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const isCli = e.surface === 'terminal'
    const view = { isCli, columns: e.props.bodyColumns, agentId: e.props.view.agentId }
    const { line0, line1, line2, line3, ports } = await hudLines($, els, view)
    // what other mods draw in the band (savvy-progress's bar) stays, under the hud
    const below = await next(e)

    // desktop: folder, branch and tools, then the usage bars (no rule, no update line)
    if (!isCli) {
      return (
        <Box flexDirection="column">
          {line0}
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
        {line0}
        {line1}
        {line2}
        {line3}
        {below}
      </Box>
    )
  })
}
