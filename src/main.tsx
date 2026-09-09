import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './presentation/App'
import { container } from './shared/container'
import './presentation/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={container.queryClient}>
      {/* BASE_URL mirrors vite.config.ts's `base` (import.meta.env.BASE_URL is Vite's own
          derived value) — "/" locally, "/tenant-invoice/" once built for GitHub Pages.
          Without a matching basename, every route below would fail to match once deployed:
          the router would try to match the full "/tenant-invoice/auth" against a route
          defined as "/auth" and always land on the catch-all redirect. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
