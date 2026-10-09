// Test-only ESM resolver hook. api/ is written with NodeNext-style `./foo.js` import
// specifiers for files that only exist as `foo.ts` (Vercel's own bundler resolves these;
// see CLAUDE.md's "api/ isn't covered by tsc -b" gotcha for why this mismatch exists at
// all). Node's native TypeScript support resolves specifiers literally, so a bare `node
// --test` run can't follow those imports without this: rewrite `./foo.js` to `./foo.ts`
// whenever the `.ts` sibling exists and the `.js` file doesn't. Lets unit tests import
// real api/ modules directly, without vercel dev or any build step.
//
// src/ is written Vite-style instead — bare extensionless specifiers (`./foo`), which
// Vite's bundler resolves but Node's native loader can't. Same fix, different shape:
// append `.ts`/`.tsx` whenever a relative specifier has no extension and a matching
// sibling file exists. First src/ unit test (tripPeriod.test.ts) needed this.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
    const candidateUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)
    if (existsSync(fileURLToPath(candidateUrl))) {
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context)
    }
  }
  if (/^\.\.?\//.test(specifier) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    for (const ext of ['.ts', '.tsx']) {
      const candidateUrl = new URL(specifier + ext, context.parentURL)
      if (existsSync(fileURLToPath(candidateUrl))) {
        return nextResolve(specifier + ext, context)
      }
    }
  }
  return nextResolve(specifier, context)
}
