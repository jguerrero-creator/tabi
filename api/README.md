# /api — Vercel Functions (server-side only)

Any call to a third-party API that requires a secret key (Claude API, Google
Maps/Places, Resend, etc.) is made from a function in this directory, never
from `src/`.

Rules:
- Secret keys are read from `process.env.*` (server-only env vars, no
  `VITE_` prefix). They are configured in Vercel project settings, never
  committed.
- The browser bundle only ever talks to `/api/*` endpoints, and only ever
  sees `VITE_`-prefixed env vars (see `.env.local.example`).
- No secret key is ever passed to or logged from client-reachable code.

See the Decision Log entry "Clés API jamais exposées côté client" for the
full reasoning.
