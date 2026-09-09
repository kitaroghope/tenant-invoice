import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Root ("/") is correct for Apache/DirectAdmin at a domain root and for local dev.
  // GitHub Pages serves this app under /tenant-invoice/ instead, so its build (see
  // .github/workflows/deploy.yml) sets DEPLOY_BASE explicitly — same source, two targets,
  // no manual edit here between them. main.tsx's BrowserRouter basename reads Vite's own
  // import.meta.env.BASE_URL, so it follows whichever base was set at build time.
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
