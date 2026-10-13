export type HudTools = { count: number; name: string; at: number }
export type HudActive = { name: string; at: number; n: number }
export type HudUpgrade = 'idle' | 'running' | 'done'
// one model loop's figures: the main conversation's under '', an agent's under its id
export type HudLoop = {
  tools?: HudTools
  active?: HudActive
  model?: string
  effort?: string
  ctx?: number
  cwd?: string
  branch?: string
  // an agent's: when it was spawned, when its last turn ended, the tokens it generated
  started?: number
  ended?: number
  out?: number
}

declare module 'claude-code' {
  interface PluginState {
    'mod-hud': {
      loops: Record<string, HudLoop>
      effort: string | null
      branch: string | null
      latest: string | null
      upgrade: HudUpgrade
    }
  }
}
