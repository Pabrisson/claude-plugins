import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const BAND = {
  plugin: 'mod-hud',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 323_000, window: 1_000_000, percent: 32 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-10T14:13:00Z' },
    { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-13T16:00:00Z' },
  ],
  cost: { usd: 1.234 },
}

const runs: string[][] = []

const engine = (on: On, usage: SessionUsage = USAGE) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/Users/pab/.claude' }))
  on('session.version', () => ({ value: { version: '2.1.294', base: '2.1.294' } }))
  on('session.usage', () => ({ value: usage }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } as never }))
  // the engine's own band, empty: the hud draws over it
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"2.1.300"}' } }))
  // the branch is read from .git/HEAD (no git process: $.process is CLI only); /work/wt is an agent's worktree
  const heads: Record<string, string> = {
    '/Users/pab/.claude/.git/HEAD': 'ref: refs/heads/master\n',
    '/work/wt/.git/HEAD': 'ref: refs/heads/agent-fix\n',
  }
  on('fs.read', ($, e) => {
    const head = heads[e.path]
    return head ? { value: head } : { deny: 'ENOENT' }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return clock
}

const START = { cwd: '/Users/pab/.claude', surface: 'terminal', isInteractive: true } as const

test('terminal: one rule above, the 3 lines with theme colors, 1M tokens, cost, and the update', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const ui = await $.ui.mount(BAND)
  // the rule leaves 4 cells at its end for the ports toggle, beside the engine's [-]
  expect(await ui.findAll({ type: 'Text', text: /^─{116}$/ })).toHaveLength(1)
  // the ports mod's toggle, end of the rule: `[⇄]` styled like the engine's `[-]`, dim, inverse hovered
  expect((await ui.find({ key: 'ports' }))?.props).toEqual({ key: 'ports', label: '[⇄]', plain: true, dimColor: true })
  for (const text of [
    /Opus 5\.5/,
    /xHigh/,
    /\.claude/,
    /master/,
    /5h ━{4}─{6} 42% \(2h 13m\)/,
    /7d ━{2}─{8} 18% \(3d 4h\)/,
    /ctx ━{3}─{7} 32% \(323k\/1M\) \| \$1\.23/,
    /2\.1\.294 → 2\.1\.300/,
  ]) {
    expect(await ui.find({ text })).toBeDefined()
  }
  // text follows the theme; 42% fills 4 of 10 cells with a thin line, olive under 50%, the rest a track
  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: /^━{4}$/ }))?.props.color).toBe('#788c5d')
  expect((await ui.find({ type: 'Text', text: /^─{6}$/ }))?.props.color).toBe('#3d3d3a')
  expect((await ui.find({ type: 'Text', text: /^ 42%$/ }))?.props.color).toBe('#788c5d')
  // no background anywhere, so the bars never touch the rows around
  expect((await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor)).toEqual([])

  await ui.press({ key: 'upgrade' })
  expect(runs).toContainEqual(['brew', 'upgrade', 'claude-code@latest'])
  expect(await ui.find({ text: /2\.1\.300 installed/ })).toBeDefined()
  await ui.unmount()
})

test('terminal fullscreen and narrow: folder and branch stay, line 2 drops resets then cost', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 70 },
    viewport: { columns: 75, rows: 30, isFullscreen: true },
  })
  for (const text of [/\(2h 13m\)/, /\$1\.23/]) {
    expect(await ui.find({ text })).toBeUndefined()
  }
  for (const text of [/Opus 5\.5 • ◉ xHigh \| \.claude • master/, /\(323k\/1M\)/]) {
    expect(await ui.find({ text })).toBeDefined()
  }
  await ui.unmount()
})

// a stand-in ports mod: it answers the toggle's press (with its pane)
const PORTS = {
  name: 'mod-ports',
  register(on: On) {
    on('ui.press', { plugin: 'mod-hud', element: 'ports' }, ($, e) => ({ element: e.element }))
  },
}

for (const withPorts of [true, false]) {
  test(`the ports toggle is always drawn: ${withPorts ? 'the ports mod answers its press' : 'a toast without the ports mod'}`, { plugins: withPorts ? [PORTS] : [] }, async ($, on) => {
    engine(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    await $.session.start(START)
    const ui = await $.ui.mount(BAND)

    await ui.press({ key: 'ports' })
    expect(toasts).toEqual(withPorts ? [] : ['ports: mod not loaded'])
    await ui.unmount()
  })
}

// /clear wipes the hud's effort and branch too, and classic.SessionStart never reaches it on a Team plan
test('the effort and the branch survive a /clear', async ($, on) => {
  engine(on)
  let cleared = false
  on('state.get', ($, e, next) =>
    cleared && e.plugin === 'mod-hud' && (e.key === 'effort' || e.key === 'branch') ? { value: { value: null, version: 0 } } : next(e),
  )
  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /xHigh/ })).toBeDefined()
  await ui.unmount()

  cleared = true
  const after = await $.ui.mount(BAND)
  for (const text of [/xHigh/, /master/]) expect(await after.find({ text })).toBeDefined()
  await after.unmount()
})

test('a running tool shows live, then counts as the last one', async ($, on) => {
  const clock = engine(on)
  let release = () => {}
  on('tool.call', () => new Promise(done => (release = () => done({ result: 'ok' } as never))))
  await $.session.start(START)

  const ui = await $.ui.mount(BAND)
  const call = $.tool.call({ tool: 'mcp__srv__fn' } as never)
  await clock.advance(3000)
  expect(await ui.find({ text: /⚡ 0 fn \(srv\) running 3s/ })).toBeDefined()
  release()
  await call
  expect(await ui.find({ text: /⚡ 1 fn \(srv\) 0s/ })).toBeDefined()
  expect(await ui.find({ text: /running/ })).toBeUndefined()
  await ui.unmount()
})

test('threshold alerts toast once per crossing', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, {
    ...USAGE,
    context: { tokens: 870_000, window: 1_000_000, percent: 87 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-10T13:03:30Z' }],
  })
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  await $.session.start(START)

  await clock.advance(1000)
  await clock.advance(1000)
  expect(toasts).toEqual(['Context at 87%: consider /compact', '5h usage at 92%, resets in 1h 3m'])
})

test('desktop shows the folder, branch and tools, then the usage bars', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start({ ...START, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash' } as never)

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pills = await desktop.findAll({ type: 'Svg' })
  expect(pills.map(p => p.props.alt)).toEqual(['5h 42%', '7d 18%', 'ctx 32%'])
  const svg = String(pills[0]?.props.source)
  expect(svg).toContain('rx="8"')
  expect(svg).toContain('fill="#788c5d" width="35.28"')
  // spaces doubled and non-breaking on the desktop
  expect(await desktop.find({ type: 'Text', text: /^5h  $/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^  \(2h 13m\)$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^  •  $/ })).toBeDefined()
  // line 1: folder • branch • ⚡ tools, spaces doubled too
  expect(await desktop.find({ type: 'Text', text: /^\.claude$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^master$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^⚡ 1  $/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^Bash  $/ })).toBeDefined()
  for (const text of [/^─+$/, /Opus 5\.5/, /xHigh/, /2\.1\.300/, //]) {
    expect(await desktop.find({ text })).toBeUndefined()
  }
  expect(await desktop.find({ key: 'upgrade' })).toBeUndefined()
  expect(await desktop.find({ key: 'ports' })).toBeDefined()
  await desktop.unmount()
})

const effortRow = (level: string) => ({
  type: 'user' as const,
  role: 'user' as const,
  content: [{ type: 'text' as const, text: `<local-command-stdout>Set effort level to ${level} (this session only): …</local-command-stdout>` }],
})

test('/effort output updates the effort shown, quotes elsewhere do not', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: /xHigh/ })).toBeDefined()
  await $.session.append({ message: effortRow('max'), door: 'command', origin: { kind: 'composer' }, uuid: 'row-1' })
  expect(await ui.find({ text: /◈ Max/ })).toBeDefined()
  // the same words in a tool result (a grep of the transcript) change nothing
  await $.session.append({ message: effortRow('low'), door: 'tool-result', origin: { kind: 'tool', tool: 'Bash' }, uuid: 'row-2' })
  expect(await ui.find({ text: /◈ Max/ })).toBeDefined()
  await ui.unmount()
})

// a stand-in band mod that draws its own row without next (savvy-progress's bar does)
const BAR = {
  name: 'bar',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['savvy-bar'] }))
  },
}

test('the band keeps what other mods draw under it', { plugins: [BAR] }, async ($, on) => {
  engine(on)
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /master/ })).toBeDefined()
    expect(await ui.find({ text: 'savvy-bar' })).toBeDefined()
    await ui.unmount()
  }
})


test('an agent in view: its line, model, effort, folder, branch, tools and context; main keeps its own', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5-5', agentId: e.cwd ? 'a1' : 'a2' }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'Explore', description: 'scan', status: 'running' },
      { id: 'a2', type: 'general-purpose', name: 'helper', description: 'help', status: 'completed' },
    ],
  }))
  // the model answers each step over 40k input tokens and writes 5k
  on('turn.step', async function* () {
    const usage = { model: 'm', input_tokens: 1_000, cache_read_input_tokens: 39_000, cache_creation_input_tokens: 0, output_tokens: 5_000 }
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'scan', subagentType: 'Explore', cwd: '/work/wt' } as never)
  await $.agent.spawn({ prompt: 'help', subagentType: 'general-purpose' } as never)
  for (const [agentId, model] of [['a1', 'claude-haiku-5-5'], ['a2', 'claude-opus-5-5']] as const) {
    // a stream: read to its end, as the query loop does
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort: 'low', messageCount: 3, agentId }));
  }
  await $.tool.call({ tool: 'Grep', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash' } as never)
  await $.tool.call({ tool: 'Read' } as never)
  // a2 ends a minute in, a1 runs on: a2's time stops there
  await clock.advance(60_000)
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', agentId: 'a2', reason: 'answer' } as never)
  await clock.advance(120_000)

  const view = (agentId?: string) => $.ui.mount({ ...BAND, props: { ...BAND.props, view: agentId ? { agentId } : {} } })

  // a model other than the session's: its window is guessed (200k)
  const a1 = await view('a1')
  expect((await a1.find({ type: 'Text', text: /^ ● running$/ }))?.props.color).toBe('warning')
  for (const text of [/^▸ Explore ● running • ◷ 3m • Σ 5k tok • ⧉ 1\/2 • ✎ scan$/, /^Haiku 5\.5 • ○ Low \| wt • agent-fix • ⚡ 1 Grep/, /ctx ━{2}─{8} 23% \(45k\/200k\)/, /5h ━{4}/]) {
    expect(await a1.find({ text })).toBeDefined()
  }
  await a1.unmount()

  // the session's model: the session's window; no cwd of its own: the session's folder and branch
  const a2 = await view('a2')
  expect((await a2.find({ type: 'Text', text: /^ ✓ completed$/ }))?.props.color).toBe('success')
  for (const text of [/^▸ helper ✓ completed • ◷ 1m • Σ 5k tok • ⧉ 2\/2 • ✎ help$/, /^Opus 5\.5 • ○ Low \| \.claude • master$/, /ctx ─{10} 5% \(45k\/1M\)/]) {
    expect(await a2.find({ text })).toBeDefined()
  }
  await a2.unmount()

  // main: the session's figures, and only its own tools
  const main = await view()
  for (const text of [/^Opus 5\.5 • ◉ xHigh \| \.claude • master • ⚡ 2 Read/, /ctx ━{3}─{7} 32% \(323k\/1M\)/]) {
    expect(await main.find({ text })).toBeDefined()
  }
  expect(await main.find({ text: /▸/ })).toBeUndefined()
  await main.unmount()
})
