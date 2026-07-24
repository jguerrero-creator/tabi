import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { App } from './App.tsx'
import { RootErrorBoundary } from './components/ui/RootErrorBoundary.tsx'
import { ensureAnonSession } from './lib/supabase.ts'

/**
 * TABI-168 test hook: forces a render-phase throw so e2e can verify
 * RootErrorBoundary's fallback without a naturally occurring crash — same
 * approach as TABI-167's gm_authFailure simulation. import.meta.env.DEV is a
 * compile-time constant, so this is dead code stripped from production builds.
 */
function ThrowForE2ETest() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2eThrowInRoot')) {
    throw new Error('e2e forced root render error')
  }
  return null
}

ensureAnonSession().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootErrorBoundary>
        <ThrowForE2ETest />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>,
  )
})
