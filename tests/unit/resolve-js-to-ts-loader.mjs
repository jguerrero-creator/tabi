// Test-only ESM resolver hook. api/ is written with NodeNext-style `./foo.js` import
// specifiers for files that only exist as `foo.ts` (Vercel's own bundler resolves these;
// see CLAUDE.md's "api/ isn't covered by tsc -b" gotcha for why this mismatch exists at
// all). Node's native TypeScript support resolves specifiers literally, so a bare `node
// --test` run can't follow those imports without this: rewrite `./foo.js` to `./foo.ts`
// whenever the `.ts` sibling exists and the `.js` file doesn't. Lets unit tests import
// real api/ modules directly, without vercel dev or any build step.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
    const candidateUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)
    if (existsSync(fileURLToPath(candidateUrl))) {
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context)
    }
  }
  return nextResolve(specifier, context)
}
