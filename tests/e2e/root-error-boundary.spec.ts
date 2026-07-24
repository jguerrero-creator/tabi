import { expect, test } from '@playwright/test'

// TABI-168 — RootErrorBoundary is the last-resort catch-all around <App>:
// MapErrorBoundary (TABI-161/167) only confines Maps SDK failures to the map
// area, so any other uncaught render error would otherwise white-screen the
// whole app. Forces a child to throw via the dev-only query-param hook in
// main.tsx rather than hunting for a real, naturally occurring crash — same
// approach as TABI-167's gm_authFailure simulation.

test('a child render error is caught by the root boundary, showing the fallback and a reload button', async ({
  page,
}) => {
  await page.goto('/?e2eThrowInRoot=1')

  await expect(page.getByText('Something went wrong.')).toBeVisible()
  await expect(
    page.getByText('Reload the page to keep going — anything you already saved is safe.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
})
