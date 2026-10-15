/** What the pane's client draws: one page, already wrapped by the hooks module. */
export type Page = {
  /** The lines of this page, one per row, already wrapped to the pane's width. */
  lines: string[]
  /** Rows to draw, so a short last page still puts the footer at the bottom. */
  rows: number
  /** Where the page sits: `第 12/78 页 · 43%`. */
  progress: string
  /** The keys, for the footer. */
  keys: string
}

declare module 'claude-code' {
  interface PluginState {
    'novel-pane': {
      /** Whether the pane is open. The places and the last book live in `$.store`. */
      isOpen: boolean
    }
  }
}
