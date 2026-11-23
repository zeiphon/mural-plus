import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'
import fs from 'fs'

// The web demo: the real UI in app.html, talking to a simulated
// Mural, beside a panel showing what that Mural is doing (index.html).
// Separate from the firmware's UI build, which this doesn't touch.
//
// From ui/, after building the worker (cd ../worker && npm run build):
//   npx tsc -p demo                          type-check
//   npx vite --config demo/vite.config.ts    run it locally
//   npx vite build --config demo/vite.config.ts [--outDir DIR]
// MURAL_VERSION sets the version it shows (scripts/package_release.py passes it).

const here = __dirname
const workerDir = path.resolve(here, '../../worker/dist_packed')
// Where the app looks for the worker (ui/src/hooks/useWorkerRenderer.ts), and its source in worker/dist_packed/
const workerFiles: Record<string, string> = {
  'worker/worker.js': 'main.js',
  'worker/oneline.js': 'oneline.js',
  'worker/oneline.wasm': 'oneline.wasm',
}

function worker(): Plugin {
  return {
    name: 'demo-worker',
    configureServer(server) {
      for (const [route, file] of Object.entries(workerFiles)) {
        server.middlewares.use(`/${route}`, (_req, res, next) => {
          const source = path.join(workerDir, file)
          if (!fs.existsSync(source)) return next()
          res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript')
          res.end(fs.readFileSync(source))
        })
      }
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(workerFiles)) {
        const source = path.join(workerDir, file)
        if (!fs.existsSync(source)) {
          this.error(`worker/dist_packed/${file} is missing. Build the worker first: cd worker && npm run build`)
        }
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(source) })
      }
    },
  }
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), worker()],
  define: {
    __MURAL_VERSION__: JSON.stringify(process.env.MURAL_VERSION || 'dev'),
    __MURAL_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  css: {
    postcss: {
      plugins: [
        // The app's classes and the demo's own
        tailwindcss({
          content: [
            path.join(here, '*.html'),
            path.join(here, 'src/**/*.{ts,tsx}'),
            path.resolve(here, '../src/**/*.{ts,tsx}'),
          ],
          theme: { extend: {} },
        }),
        autoprefixer(),
      ],
    },
  },
  server: {
    fs: { allow: [path.resolve(here, '..')] },
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.join(here, 'index.html'),
        app: path.join(here, 'app.html'),
      },
    },
  },
})
