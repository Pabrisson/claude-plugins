import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const PANE = {
  plugin: 'mod-ports',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'ports',
  props: { title: 'Ports', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// node serves vite in the project (IPv4 and IPv6), python3 runs elsewhere
const LISTEN = 'p100\ncnode\nf20\nn*:5173\nf21\nn[::1]:5173\np200\ncpython3\nf3\nn127.0.0.1:8000\n'
const CWDS = 'p100\nfcwd\nn/proj/web\np200\nfcwd\nn/elsewhere\n'

// swarm: proj_web mounts the project behind traefik (an http and an https router), other_db mounts elsewhere
const SERVICES = '{"ID":"a1","Name":"proj_web","Replicas":"1/1"}\n{"ID":"b2","Name":"other_db","Replicas":"0/1"}\n'
const SERVICE_SPECS = JSON.stringify([
  {
    Spec: {
      Name: 'proj_web',
      Labels: {
        'traefik.http.routers.web.rule': 'Host(`web.proj.test`)',
        'traefik.http.routers.web-https.rule': 'Host(`web.proj.test`)',
        'traefik.http.routers.web-https.tls': '1',
      },
      TaskTemplate: { ContainerSpec: { Mounts: [{ Source: '/host_mnt/proj/src' }] } },
    },
    Endpoint: { Ports: [{ PublishedPort: 6379 }] },
  },
  { Spec: { Name: 'other_db', TaskTemplate: { ContainerSpec: { Mounts: [{ Source: '/host_mnt/elsewhere' }] } } } },
])
// a compose container of the project still starting, and a swarm task (its service is the row), both running
const CONTAINERS = JSON.stringify([
  {
    Name: '/proj-worker-1',
    State: { Status: 'running', Health: { Status: 'starting' } },
    Config: { Labels: { 'com.docker.compose.project.working_dir': '/proj', 'com.docker.compose.service': 'worker' } },
    NetworkSettings: { Ports: { '8080/tcp': [{ HostPort: '8080' }, { HostPort: '8080' }], '9000/tcp': null } },
  },
  { Name: '/proj_web.1.x', State: { Status: 'running' }, Config: { Labels: { 'com.docker.swarm.service.id': 'a1' } }, Mounts: [{ Source: '/proj/src' }] },
])
// kubernetes: whoami 1 of 2 ready behind an https ingress; system services left out
const KUBE = JSON.stringify({
  items: [
    { kind: 'Service', metadata: { name: 'whoami', namespace: 'demo' }, spec: { selector: { app: 'whoami' } } },
    { kind: 'Service', metadata: { name: 'kubernetes', namespace: 'default' }, spec: {} },
    { kind: 'Service', metadata: { name: 'kube-dns', namespace: 'kube-system' }, spec: { selector: { k8s: 'dns' } } },
    { kind: 'Deployment', metadata: { name: 'whoami', namespace: 'demo' }, spec: { replicas: 2, template: { metadata: { labels: { app: 'whoami', tier: 'web' } } } }, status: { readyReplicas: 1 } },
    {
      kind: 'Ingress',
      metadata: { name: 'whoami', namespace: 'demo' },
      spec: {
        tls: [{ hosts: ['whoami.lab.internal'] }],
        rules: [{ host: 'whoami.lab.internal', http: { paths: [{ backend: { service: { name: 'whoami' } } }] } }],
      },
    },
  ],
})
const KUBECTL = ['kubectl', '--kubeconfig', '/proj/.kube/config', '--request-timeout=3s']

// the hud's icon, drawn by a stand-in hud whose own press would toast
const HUD = {
  name: 'mod-hud',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Button } = $.ui.resolve(e)
      return h(Button, { key: 'ports', label: 'P', onPress: () => $.ui.toast('ports: mod not loaded') }) as RenderElement
    })
  },
}

const BAND = {
  plugin: 'mod-hud',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const engine = (on: On, { docker = true, kube = KUBE as string | null, kubeconfig = true, cwd = '/proj', git = '' } = {}) => {
  const clock = mock.clock(on, { now: 0 })
  const runs: string[][] = []
  const toasts: string[] = []
  const copies: string[] = []
  const panes = new Set<string>()
  const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.read', ($, e) =>
    kubeconfig && e.path === '/proj/.kube/config' ? { value: 'current-context: lab\n' } : { deny: 'ENOENT' },
  )
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const cmd = e.argv.join(' ')
    if (cmd === 'git rev-parse --show-toplevel') return out(git)
    if (cmd.startsWith('lsof -nP')) return out(LISTEN)
    if (cmd.startsWith('lsof -a -d cwd -p 100,200')) return out(CWDS)
    if (cmd.startsWith('docker') && !docker) return { deny: 'ENOENT' }
    if (cmd === 'docker service ls --format json') return out(SERVICES)
    if (cmd === 'docker service inspect proj_web other_db') return out(SERVICE_SPECS)
    if (cmd === 'docker ps -q') return out('c1\nc2\n')
    if (cmd === 'docker ps -aq --filter label=com.docker.compose.project') return out('c1\n')
    if (cmd === 'docker inspect c1 c2') return out(CONTAINERS)
    if (cmd.startsWith(`${KUBECTL.join(' ')} get`)) return out(kube ?? '')
    return out('')
  })
  on('ui.open', ($, e) => (panes.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($, e) => (panes.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({
    value: [...panes].map(id => ({ id, title: 'Ports', isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.copy', ($, e) => (copies.push(e.text), { value: { isCopied: true } }))
  return { clock, runs, toasts, copies, panes }
}

const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as const

test('the hud icon toggles the pane: docker, kubernetes and process rows with colored bullets and links', { plugins: [HUD] }, async ($, on) => {
  // the session in a subfolder: the git root is the project
  const { clock, runs, toasts, copies, panes } = engine(on, { cwd: '/proj/web', git: '/proj\n' })
  await $.session.start(START)
  expect(panes.size).toBe(0)

  const band = await $.ui.mount(BAND)
  await band.press({ plugin: 'mod-hud', key: 'ports' })
  expect([...panes]).toEqual(['ports'])

  const pane = await $.ui.mount(PANE)
  // sections in order, rows by name; other_db, python3 and the system services stay out
  expect((await pane.findAll({ type: 'Text', text: /^(Docker|Kubernetes|Process)$/ })).map(t => t.text)).toEqual([
    'Docker',
    'Kubernetes',
    'Process',
  ])
  expect((await pane.findAll({ type: 'Text', text: /^● (proj_web|worker|whoami|node|other_db|python3|kube-dns|kubernetes)/ })).map(t => t.text)).toEqual([
    '● proj_web',
    '● worker starting',
    '● whoami demo 1/2',
    '● node pid 100',
  ])
  // only running containers and compose ones are inspected
  expect(runs.some(r => r.join(' ') === 'docker ps -aq')).toBe(false)
  // one bullet glyph, its color the state: up, partial (health starting), partial (1/2 ready), up
  expect((await pane.findAll({ type: 'Text', text: /^● $/ })).map(t => t.props.color)).toEqual(['success', 'warning', 'warning', 'success'])
  // no totals line
  expect(await pane.find({ type: 'Text', text: /^● \d/ })).toBeUndefined()
  // links: the traefik host in https once, published ports once each, the ingress host, the process port;
  // redis is no browser link
  expect((await pane.findAll({ type: 'Text' })).filter(t => t.props.color === 'claude').map(t => t.text)).toEqual([
    'web.proj.test',
    'localhost:8080',
    'whoami.lab.internal',
    'localhost:5173',
  ])

  await pane.press({ key: 'open:Docker:0:0' })
  expect(runs).toContainEqual(['open', 'https://web.proj.test'])
  await pane.press({ key: 'copy:Kubernetes:0:0' })
  expect(toasts).toContain('Copied https://whoami.lab.internal')
  expect(await pane.find({ key: 'open:Docker:0:1' })).toBeUndefined()
  await pane.press({ key: 'copy:Docker:0:1' })
  expect(copies).toEqual(['https://whoami.lab.internal', 'redis://localhost:6379'])

  // a restart asks a second press: the first only arms the button
  const restarting = ['docker', 'service', 'update', '--force', '--detach', 'proj_web']
  await pane.press({ key: 'restart:Docker:0' })
  expect(runs).not.toContainEqual(restarting)
  expect(toasts).toContain('Press again to confirm')
  expect((await pane.findAll({ type: 'Text', text: '⟳' })).map(t => t.props.color)).toEqual(['warning', 'inactive', 'inactive'])
  await pane.press({ key: 'restart:Docker:0' })
  expect(runs).toContainEqual(restarting)
  await pane.press({ key: 'restart:Docker:1' })
  await pane.press({ key: 'restart:Docker:1' })
  expect(runs).toContainEqual(['docker', 'restart', 'proj-worker-1'])
  // armed 3 s only: past them a press arms again
  const rollout = [...KUBECTL, 'rollout', 'restart', 'deployment/whoami', '-n', 'demo']
  await pane.press({ key: 'restart:Kubernetes:0' })
  await clock.advance(3000)
  await pane.press({ key: 'restart:Kubernetes:0' })
  expect(runs).not.toContainEqual(rollout)
  await pane.press({ key: 'restart:Kubernetes:0' })
  expect(runs).toContainEqual(rollout)
  expect(toasts).toContain('whoami restarted')
  // a local process has no restart, it stops
  expect(await pane.find({ key: 'restart:Process:0' })).toBeUndefined()
  await pane.press({ key: 'stop:Process:0' })
  await pane.press({ key: 'stop:Process:0' })
  expect(runs).toContainEqual(['kill', '100'])
  expect(toasts).toContain('node stopped')
  await pane.unmount()

  await band.press({ plugin: 'mod-hud', key: 'ports' })
  expect(panes.size).toBe(0)
  await band.unmount()
})

test('without docker nor kubeconfig the folder processes show, rescanned every 5 s', { plugins: [HUD] }, async ($, on) => {
  const { clock, runs } = engine(on, { docker: false, kubeconfig: false })
  await $.session.start(START)
  const band = await $.ui.mount(BAND)
  await band.press({ plugin: 'mod-hud', key: 'ports' })
  runs.length = 0

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.findAll({ type: 'Text', text: /^(Docker|Kubernetes|Process)$/ })).map(t => t.text)).toEqual(['Process'])
    expect(await pane.find({ key: 'open:Process:0:0' })).toBeDefined()
    await pane.unmount()
  }
  await clock.advance(5000)
  expect(runs.filter(r => r[0] === 'lsof')).toHaveLength(2)
  // no kubeconfig in the project: no cluster is asked
  expect(runs.some(r => r[0] === 'kubectl')).toBe(false)
  await band.unmount()
})

test('a project kubeconfig whose cluster does not answer shows it unreachable', { plugins: [HUD] }, async ($, on) => {
  engine(on, { docker: false, kube: null })
  await $.session.start(START)
  const band = await $.ui.mount(BAND)
  await band.press({ plugin: 'mod-hud', key: 'ports' })

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^● lab unreachable$/ })).toBeDefined()
  expect((await pane.findAll({ type: 'Text', text: /^● $/ })).map(t => t.props.color)).toEqual(['error', 'success'])
  await pane.unmount()
  await band.unmount()
})

// /clear wipes the rows, and classic.SessionStart never reaches the mod on a Team plan
test('after a /clear the open pane keeps its rows until the next scan', { plugins: [HUD] }, async ($, on) => {
  engine(on, { docker: false, kubeconfig: false })
  let cleared = false
  on('state.get', ($, e, next) => (cleared && e.plugin === 'mod-ports' && e.key === 'rows' ? { value: { value: null, version: 0 } } : next(e)))
  await $.session.start(START)
  const band = await $.ui.mount(BAND)
  await band.press({ plugin: 'mod-hud', key: 'ports' })
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Process' })).toBeDefined()
  await pane.unmount()

  cleared = true
  const after = await $.ui.mount(PANE)
  expect(await after.find({ type: 'Text', text: /Scanning/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: 'Process' })).toBeDefined()
  await after.unmount()
  await band.unmount()
})
