export type Mode = 'image' | 'raster'

declare module 'claude-code' {
  interface PluginState {
    pinata: { mode: Shaped<Mode>; label: Shaped<string> }
  }
}
