import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// Builds src/gui.tsx into dist/gui-experimental.cjs, the single CommonJS bundle
// the desktop app loads for the plugin's `./gui-experimental` export. The preset
// compiles Solid JSX and keeps the modules the app provides external.
export default defineConfig({
  plugins: [gui()],
})
