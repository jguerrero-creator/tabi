import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-33 — "Modèle de données Voyage: un utilisateur (anonyme ou non) peut
// avoir plusieurs voyages". Verifies both halves of that spec end-to-end:
// (1) one user can create and see several trips, and (2) a different
// (anonymous) user never sees another user's trips — trips are scoped to the
// user identity, not global.

test('a user can create multiple trips, and another user never sees them', async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tripAlpha = `E2E Alpha ${runId}`
  const tripBeta = `E2E Beta ${runId}`

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const createdTripIds: string[] = []

  const pageA = await contextA.newPage()
  await pageA.goto('/')
  await expect(pageA.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const clientA = await authenticatedClientFor(pageA)

  try {
    const idAlpha = await createTrip(pageA, tripAlpha)
    const idBeta = await createTrip(pageA, tripBeta)
    createdTripIds.push(idAlpha, idBeta)

    // Same user, both trips visible together — multi-trip support.
    await expect(pageA.getByText(tripAlpha)).toBeVisible()
    await expect(pageA.getByText(tripBeta)).toBeVisible()

    // A second, independent anonymous user must start with zero trips and
    // never see user A's trips — proves trips are attached to the user
    // identity, not shared/global.
    const pageB = await contextB.newPage()
    await pageB.goto('/')
    await expect(pageB.getByRole('heading', { name: 'My Trips' })).toBeVisible()
    await expect(pageB.getByText('No trips yet')).toBeVisible()
    await expect(pageB.getByText(tripAlpha)).toHaveCount(0)
    await expect(pageB.getByText(tripBeta)).toHaveCount(0)
  } finally {
    if (createdTripIds.length > 0) {
      const { error } = await clientA.from('trips').delete().in('id', createdTripIds)
      if (error) throw error
    }
    await contextA.close()
    await contextB.close()
  }
})

async function createTrip(page: Page, name: string): Promise<string> {
  await page.locator('header').getByRole('button', { name: 'New Trip' }).click()
  await page.getByLabel('Trip name').fill(name)

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/rest/v1/trips') && res.request().method() === 'POST'),
    page.getByRole('button', { name: 'Create Trip' }).click(),
  ])

  const created = (await response.json()) as { id: string }
  await expect(page.getByText(name)).toBeVisible()
  return created.id
}
