import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Link, Row, RowState, Section } from '../types'

const PANE = 'ports'
// null until the first scan
const rows = atom({ plugin: 'mod-ports', key: 'rows' } as const, null)
// /clear wipes all of $.state, and classic.SessionStart never reaches a user mod on a Team plan
// (cc-plugin-sec-default bypasses it): an open pane keeps the last rows seen until the next scan (5 s at most)
let rowsSeen: Row[] | null = null
// the action (its command line) waiting for its confirming press, so a rescan reordering the rows cannot retarget it
const armed = atom({ plugin: 'mod-ports', key: 'armed' } as const, null)

const SECTIONS: readonly Section[] = ['Docker', 'Kubernetes', 'Process']
// one bullet, its color (a theme key) says the state
const COLOR: Record<RowState, string> = { up: 'success', partial: 'warning', down: 'error', unknown: 'inactive' }

// stdout whatever the exit code (lsof exits 1 when one pid of several is gone), '' when it cannot run
const run = ($: EngineInterface, argv: readonly string[], timeoutMs = 10_000) =>
  $.process.run(argv, { timeoutMs }).then(r => r.stdout, () => '')

const json = <T,>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

const inside = (path: string, root: string) => path === root || path.startsWith(`${root}/`)
// Docker Desktop spells host paths /host_mnt/Users/... in swarm specs
const hostPath = (source: string) => source.replace(/^\/host_mnt(?=\/)/, '')
const mountsIn = (mounts: readonly { Source?: string }[] | null | undefined, root: string) =>
  (mounts ?? []).some(m => m.Source && inside(hostPath(m.Source), root))

const replicaState = (ready: number, desired: number): RowState =>
  !desired || !ready ? 'down' : ready < desired ? 'partial' : 'up'

// a database port: its url has its scheme, copied, never opened in the browser
const SCHEME: Record<number, string> = { 3306: 'mysql', 5432: 'postgres', 6379: 'redis', 27017: 'mongodb' }
const portLinks = (ports: readonly number[]): Link[] =>
  ports.filter(p => p > 0).map(p => ({ label: `localhost:${p}`, url: `${SCHEME[p] ?? 'http'}://localhost:${p}` }))

// traefik.http.routers.<r>.rule = Host(`a`) || Host(`b`, `c`): https when a router of that host has tls
const traefikLinks = (labels: Readonly<Record<string, string>> | null | undefined): Link[] => {
  const hosts = new Map<string, boolean>()
  for (const [key, rule] of Object.entries(labels ?? {})) {
    const router = key.match(/^traefik\.http\.routers\.(.+)\.rule$/)?.[1]
    if (!router) continue
    const isTls = ['1', 'true'].includes(labels?.[`traefik.http.routers.${router}.tls`] ?? '')
    for (const [, args = ''] of rule.matchAll(/Host\(([^)]*)\)/g)) {
      for (const [, host] of args.matchAll(/`([^`]+)`/g)) if (host) hosts.set(host, isTls || (hosts.get(host) ?? false))
    }
  }
  return [...hosts].map(([host, isTls]) => ({ label: host, url: `${isTls ? 'https' : 'http'}://${host}` }))
}

// processes listening on TCP whose working directory is the project or below it: one row each
const processes = async ($: EngineInterface, root: string): Promise<Row[]> => {
  const procs = new Map<string, { name: string; ports: Set<number> }>()
  let pid = ''
  // lsof -F: one field per line, p<pid> then c<command> then n<address:port> per socket
  for (const line of (await run($, ['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])).split('\n')) {
    const value = line.slice(1)
    if (line[0] === 'p') procs.set((pid = value), { name: '', ports: new Set() })
    const proc = procs.get(pid)
    if (proc && line[0] === 'c') proc.name = value
    const port = Number(value.match(/:(\d+)$/)?.[1])
    if (proc && line[0] === 'n' && port) proc.ports.add(port)
  }
  if (!procs.size) return []

  const found: Row[] = []
  for (const line of (await run($, ['lsof', '-a', '-d', 'cwd', '-p', [...procs.keys()].join(','), '-Fpn'])).split('\n')) {
    if (line[0] === 'p') pid = line.slice(1)
    const proc = procs.get(pid)
    if (proc && line[0] === 'n' && inside(line.slice(1), root)) {
      found.push({
        section: 'Process',
        name: proc.name,
        state: 'up',
        detail: `pid ${pid}`,
        links: portLinks([...proc.ports].sort((a, b) => a - b)),
        stop: ['kill', pid],
      })
    }
  }
  return found
}

type SwarmListed = { Name: string; Replicas: string }
type SwarmService = {
  Spec: {
    Name: string
    Labels?: Record<string, string>
    TaskTemplate?: { ContainerSpec?: { Mounts?: { Source?: string }[] } }
  }
  Endpoint?: { Ports?: { PublishedPort?: number }[] }
}

// swarm services mounting the project: their replicas, traefik hosts and published ports
const swarm = async ($: EngineInterface, root: string): Promise<Row[]> => {
  const listed = (await run($, ['docker', 'service', 'ls', '--format', 'json']))
    .split('\n')
    .flatMap(line => (line ? [json<SwarmListed | null>(line, null)] : []))
    .filter(s => s !== null)
  if (!listed.length) return []

  const services = json<SwarmService[]>(await run($, ['docker', 'service', 'inspect', ...listed.map(s => s.Name)]), [])
  return services.flatMap(({ Spec, Endpoint }) => {
    if (!mountsIn(Spec.TaskTemplate?.ContainerSpec?.Mounts, root)) return []
    const replicas = listed.find(s => s.Name === Spec.Name)?.Replicas ?? ''
    const [, ready = 0, desired = 0] = (replicas.match(/^(\d+)\/(\d+)/) ?? []).map(Number)
    const state = replicaState(ready, desired)
    return [
      {
        section: 'Docker',
        name: Spec.Name,
        state,
        detail: state === 'up' ? undefined : `${ready}/${desired}`,
        links: [...traefikLinks(Spec.Labels), ...portLinks((Endpoint?.Ports ?? []).map(p => p.PublishedPort ?? 0))],
        restart: ['docker', 'service', 'update', '--force', '--detach', Spec.Name],
      } satisfies Row,
    ]
  })
}

type Container = {
  Name: string
  State?: { Status?: string; Health?: { Status?: string } }
  Mounts?: { Source?: string }[]
  Config?: { Labels?: Record<string, string> | null }
  NetworkSettings?: { Ports?: Record<string, { HostPort?: string }[] | null> | null }
}

// running containers of the project, and its compose ones stopped too (a stopped `docker run` is left out)
const containers = async ($: EngineInterface, root: string): Promise<Row[]> => {
  const lists = await Promise.all([
    run($, ['docker', 'ps', '-q']),
    run($, ['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project']),
  ])
  const ids = [...new Set(lists.join('\n').split('\n'))].filter(Boolean)
  if (!ids.length) return []

  return json<Container[]>(await run($, ['docker', 'inspect', ...ids]), []).flatMap(c => {
    const labels = c.Config?.Labels ?? {}
    // a swarm task: its service is the row
    if (labels['com.docker.swarm.service.id']) return []
    const dir = labels['com.docker.compose.project.working_dir']
    if (!(dir && inside(dir, root)) && !mountsIn(c.Mounts, root)) return []
    const status = c.State?.Status ?? ''
    const health = c.State?.Health?.Status
    const state: RowState =
      status === 'running' ? (health && health !== 'healthy' ? 'partial' : 'up') : status === 'restarting' ? 'partial' : 'down'
    const name = c.Name.replace(/^\//, '')
    const published = Object.values(c.NetworkSettings?.Ports ?? {}).flatMap(binds => (binds ?? []).map(b => Number(b.HostPort)))
    return [
      {
        section: 'Docker',
        name: labels['com.docker.compose.service'] ?? name,
        state,
        detail: state === 'up' ? undefined : (health ?? status),
        links: [...traefikLinks(labels), ...portLinks(published)],
        restart: ['docker', 'restart', name],
      } satisfies Row,
    ]
  })
}

type K8sItem = {
  kind: string
  metadata: { name: string; namespace?: string }
  spec?: {
    selector?: Record<string, unknown>
    replicas?: number
    template?: { metadata?: { labels?: Record<string, string> } }
    tls?: { hosts?: string[] }[]
    rules?: { host?: string; http?: { paths?: { backend?: { service?: { name?: string } } }[] } }[]
  }
  status?: { readyReplicas?: number; numberReady?: number; desiredNumberScheduled?: number }
}

const WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet']

// the project's own cluster only (its .kube/config, as direnv sets it): one row per service,
// its state its workload's ready replicas, its links the ingress hosts routing to it
const kubernetes = async ($: EngineInterface, root: string): Promise<Row[]> => {
  const config = `${root}/.kube/config`
  const text = await $.fs.read(config).catch(() => null)
  if (text === null) return []
  const kube = ['kubectl', '--kubeconfig', config, '--request-timeout=3s']
  const items = json<{ items?: K8sItem[] }>(await run($, [...kube, 'get', 'svc,ingress,deploy,sts,ds', '-A', '-o', 'json']), {}).items
  if (!items) {
    const context = text.match(/^current-context:\s*"?([^"\n]+)"?/m)?.[1]
    return [{ section: 'Kubernetes', name: context ?? 'cluster', state: 'down', detail: 'unreachable', links: [] }]
  }

  const services = items.filter(
    i => i.kind === 'Service' && !/^kube-/.test(i.metadata.namespace ?? '') && !(i.metadata.namespace === 'default' && i.metadata.name === 'kubernetes'),
  )
  return services.map(svc => {
    const { name, namespace: ns = 'default' } = svc.metadata
    const selector = Object.entries(svc.spec?.selector ?? {})
    const workload = selector.length
      ? items.find(
          w =>
            WORKLOADS.includes(w.kind) &&
            w.metadata.namespace === ns &&
            selector.every(([k, v]) => w.spec?.template?.metadata?.labels?.[k] === v),
        )
      : undefined
    const links = items
      .filter(i => i.kind === 'Ingress' && i.metadata.namespace === ns)
      .flatMap(ing =>
        (ing.spec?.rules ?? []).flatMap(rule => {
          const host = rule.host
          if (!host || !rule.http?.paths?.some(p => p.backend?.service?.name === name)) return []
          const isTls = (ing.spec?.tls ?? []).some(t => t.hosts?.includes(host))
          return [{ label: host, url: `${isTls ? 'https' : 'http'}://${host}` }]
        }),
      )
    if (!workload) return { section: 'Kubernetes', name, state: 'unknown', detail: ns, links } satisfies Row

    const [ready, desired] =
      workload.kind === 'DaemonSet'
        ? [workload.status?.numberReady ?? 0, workload.status?.desiredNumberScheduled ?? 0]
        : [workload.status?.readyReplicas ?? 0, workload.spec?.replicas ?? 1]
    const state = replicaState(ready, desired)
    return {
      section: 'Kubernetes',
      name,
      state,
      detail: state === 'up' ? ns : `${ns} ${ready}/${desired}`,
      links,
      restart: [...kube, 'rollout', 'restart', `${workload.kind.toLowerCase()}/${workload.metadata.name}`, '-n', ns],
    } satisfies Row
  })
}

let scanning = false
// a scan asked while one runs: the running one goes round again, so a restart sees its outcome
let again = false
const scan = async ($: EngineInterface) => {
  if (scanning) return void (again = true)
  scanning = true
  try {
    do {
      again = false
      // the git repository, so a session in a subfolder still sees the project's compose and cluster
      const root = (await run($, ['git', 'rev-parse', '--show-toplevel'])).trim() || (await $.session.cwd())
      const found = (await Promise.all([swarm($, root), containers($, root), kubernetes($, root), processes($, root)])).flat()
      const unique = found.map(r => ({ ...r, links: [...new Map(r.links.map(l => [l.url, l])).values()] }))
      await update($, rows, () => unique.sort((a, b) => a.name.localeCompare(b.name)))
    } while (again)
  } finally {
    scanning = false
  }
}

const VERB = {
  restart: { ing: 'Restarting', ed: 'restarted', noun: 'Restart' },
  stop: { ing: 'Stopping', ed: 'stopped', noun: 'Stop' },
} as const

const act = async ($: EngineInterface, row: Row, argv: readonly string[], verb: keyof typeof VERB) => {
  const { ing, ed, noun } = VERB[verb]
  $.ui.toast(`${ing} ${row.name}…`)
  const r = await $.process.run(argv, { timeoutMs: 120_000 }).catch((err: unknown) => ({ exitCode: 1, stderr: String(err) }))
  $.ui.toast(
    r.exitCode === 0 ? `${row.name} ${ed}` : `${noun} of ${row.name} failed: ${r.stderr.trim().split('\n').pop() ?? ''}`,
    { timeoutMs: 8000 },
  )
  await scan($)
}

// a destructive press: the first arms its button for 3 s, the second runs it
const confirm = async ($: EngineInterface, key: string, go: () => Promise<void>) => {
  if ((await read($, armed)) === key) {
    await update($, armed, () => null)
    return go()
  }
  await update($, armed, () => key)
  $.ui.toast('Press again to confirm')
  $.clock.after(3000, () => void update($, armed, k => (k === key ? null : k)))
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // ponytail: polls every 5 s while the pane is open, a file watcher if the cost ever shows
    $.clock.every(5000, async () => {
      if (await isOpen($)) await scan($)
    })

    return next(e)
  })

  // the hud draws the icon (its Button `ports`): the press toggles this plugin's pane
  on('ui.press', { plugin: 'mod-hud', element: 'ports' }, async ($, e) => {
    if (await isOpen($)) await $.ui.close({ id: PANE })
    else {
      await $.ui.open({ id: PANE, title: 'Ports', columns: 40 })
      void scan($)
    }

    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    rowsSeen = (await read($, rows)) ?? rowsSeen
    const all = rowsSeen
    if (!all) return <Text dimColor>Scanning…</Text>

    if (!all.length) return <Text dimColor>Nothing running in this folder</Text>

    const isArmed = await read($, armed)
    // ⟳ or ⏹, drawn in warning while it waits for its confirming press
    const action = (row: Row, key: string, argv: readonly string[] | undefined, verb: keyof typeof VERB, glyph: string) =>
      argv ? (
        <Button key={key} plain onPress={() => void confirm($, argv.join(' '), () => act($, row, argv, verb))}>
          <Text color={isArmed === argv.join(' ') ? 'warning' : 'inactive'}>{glyph}</Text>
        </Button>
      ) : null

    const view = (row: Row, id: string) => (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate">
            <Text color={COLOR[row.state]}>● </Text>
            {row.name}
            {row.detail ? <Text dimColor>{` ${row.detail}`}</Text> : null}
          </Text>
          <Box gap={1}>
            {action(row, `restart:${id}`, row.restart, 'restart', '⟳')}
            {action(row, `stop:${id}`, row.stop, 'stop', '⏹')}
          </Box>
        </Box>
        {row.links.map((link, j) => (
          <Box justifyContent="space-between" paddingLeft={2}>
            {link.url.startsWith('http') ? (
              <Button key={`open:${id}:${j}`} plain onPress={() => void $.process.run(['open', link.url])}>
                <Text color="claude">{link.label}</Text>
              </Button>
            ) : (
              <Text>{link.label}</Text>
            )}
            <Button
              key={`copy:${id}:${j}`}
              plain
              onPress={press =>
                void $.ui
                  .copy({ text: link.url, surface: press.surface })
                  .then(r => $.ui.toast(r.isCopied ? `Copied ${link.url}` : `Copy failed: ${r.reason}`))
              }
            >
              <Text color="inactive">⧉</Text>
            </Button>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {SECTIONS.filter(section => all.some(r => r.section === section)).flatMap((section, n) => [
          <Box marginTop={n ? 1 : 0}>
            <Text bold>{section}</Text>
          </Box>,
          ...all.filter(r => r.section === section).map((row, i) => view(row, `${section}:${i}`)),
        ])}
      </Box>
    )
  })
}
