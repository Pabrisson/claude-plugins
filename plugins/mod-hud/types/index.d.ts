export type HudTools = { count: number; name: string; at: number }
export type HudActive = { name: string; at: number; n: number }
export type HudUpgrade = 'idle' | 'running' | 'done'

declare module 'claude-code' {
  interface PluginState {
    'mod-hud': {
      tools: HudTools | null
      active: HudActive | null
      effort: string | null
      branch: string | null
      latest: string | null
      upgrade: HudUpgrade
    }
  }
}
