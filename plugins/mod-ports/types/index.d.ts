export type Section = 'Docker' | 'Kubernetes' | 'Process'
// up: all running; partial: starting, some replicas, unhealthy; down: stopped; unknown: no state to read
export type RowState = 'up' | 'partial' | 'down' | 'unknown'
export type Link = { label: string; url: string }
export type Row = {
  section: Section
  name: string
  state: RowState
  detail?: string
  links: Link[]
  // the command restarting it; none for a local process
  restart?: string[]
  // the command stopping it; a local process only
  stop?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    // armed: the command line of the action waiting for its confirming press
    'mod-ports': { rows: Row[] | null; armed: string | null }
  }
}
