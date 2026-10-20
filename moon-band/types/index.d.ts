declare module 'claude-code' {
  interface PluginState {
    'moon-band': {
      /** Whether `/moon` has taken the line away. */
      isHidden: boolean
      /** 详解面板：只对当前这一句有效（`line` 是它的键）。 */
      panel: {
        line: string
        busy: boolean
        about: {
          dynasty: string | null
          year: string | null
          meaning: string
          background: string
          atMs: number
        } | null
      } | null
    }
  }
}
